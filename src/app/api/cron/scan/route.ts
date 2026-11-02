import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { sendMatchEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

type Source = {
  id: string;
  user_id: string;
  provider: "greenhouse" | "lever";
  board_slug: string;
  company_name: string;
};

type Profile = {
  user_id: string;
  full_name: string;
  target_role: string;
  location: string;
  keywords: string[];
  email_notifications: boolean;
};

type ProviderJob = {
  id: string | number;
  title?: string;
  text?: string;
  location?: { name?: string };
  categories?: { location?: string; commitment?: string };
  absolute_url?: string;
  hostedUrl?: string;
  content?: string;
  descriptionPlain?: string;
  description?: string;
};

type NormalizedJob = {
  externalId: string;
  title: string;
  location: string;
  employmentType: string;
  url: string;
  description: string;
};

function isAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function plainText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}

function normalizeJob(provider: Source["provider"], job: ProviderJob): NormalizedJob | null {
  const title = (job.title || job.text || "").trim();
  const candidateUrl = job.absolute_url || job.hostedUrl || "";
  let url: URL;
  try {
    url = new URL(candidateUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !title || job.id === undefined || job.id === null) {
    return null;
  }
  return {
    externalId: String(job.id),
    title: title.slice(0, 300),
    location: (job.location?.name || job.categories?.location || "").slice(0, 200),
    employmentType: (job.categories?.commitment || "").slice(0, 100),
    url: url.toString(),
    description: plainText(job.content || job.descriptionPlain || job.description || ""),
  };
}

async function getBoardJobs(source: Source) {
  const endpoint =
    source.provider === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board_slug)}/jobs?content=true`
      : `https://api.lever.co/v0/postings/${encodeURIComponent(source.board_slug)}?mode=json`;
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "User-Agent": "Jobpilot job-search assistant" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${source.provider} returned HTTP ${response.status}`);
  }
  const body: unknown = await response.json();
  const rawJobs = Array.isArray(body)
    ? body
    : body && typeof body === "object" && "jobs" in body && Array.isArray(body.jobs)
      ? body.jobs
      : null;
  if (!rawJobs) throw new Error(`${source.provider} returned an unexpected response`);
  return rawJobs
    .slice(0, 100)
    .map((job) => normalizeJob(source.provider, job as ProviderJob))
    .filter((job): job is NormalizedJob => job !== null);
}

function scoreJob(job: NormalizedJob, profile: Profile) {
  const tokenize = (value: string) =>
    value.toLowerCase().match(/[a-z0-9+#.]+/g)?.filter((term) => term.length > 1) || [];
  const targetTerms = [...new Set(tokenize(profile.target_role))];
  const keywordTerms = [...new Set(profile.keywords.flatMap(tokenize))];
  const titleTerms = new Set(tokenize(job.title));
  const searchableTerms = new Set(tokenize(`${job.title} ${job.location} ${job.description}`));
  const locationTerms = [...new Set(tokenize(profile.location))];
  const jobLocationTerms = new Set(tokenize(job.location));
  if (!targetTerms.length && !keywordTerms.length) return null;

  const roleHits = targetTerms.filter((term) => titleTerms.has(term)).length;
  const keywordHits = keywordTerms.filter((term) => searchableTerms.has(term)).length;
  const locationHits = locationTerms.filter((term) => jobLocationTerms.has(term)).length;
  const roleScore = targetTerms.length ? (roleHits / targetTerms.length) * 55 : 0;
  const keywordScore = keywordTerms.length ? (keywordHits / keywordTerms.length) * 35 : 0;
  const locationScore = locationTerms.length ? (locationHits / locationTerms.length) * 10 : 0;
  const score = Math.round(Math.min(100, roleScore + keywordScore + locationScore));
  if (score < 20) return null;

  return {
    score,
    reason: [
      roleHits ? `${roleHits} target-role term${roleHits === 1 ? "" : "s"} in the job title` : "",
      keywordHits ? `${keywordHits} matching skill${keywordHits === 1 ? "" : "s"}` : "",
      locationHits ? `location terms match` : "",
    ].filter(Boolean).join("; "),
  };
}

async function processSource(
  admin: ReturnType<typeof createAdminClient>,
  source: Source,
  profile: Profile,
) {
  const jobs = await getBoardJobs(source);
  const candidates = jobs.flatMap((job) => {
    const match = scoreJob(job, profile);
    if (!match) return [];
    return [{
      user_id: source.user_id,
      source_id: source.id,
      external_id: job.externalId,
      company_name: source.company_name,
      title: job.title,
      location: job.location,
      employment_type: job.employmentType,
      job_url: job.url,
      description: job.description,
      match_score: match.score,
      match_reason: match.reason,
    }];
  });
  if (!candidates.length) return 0;

  const { data: inserted, error } = await admin.rpc(
    "insert_job_matches_and_queue_notifications",
    {
      p_matches: candidates,
      p_queue_notifications: profile.email_notifications,
    },
  );
  if (error) throw new Error(`Could not save matches for source ${source.id}: ${error.message}`);
  return inserted?.length || 0;
}

async function sendPendingNotifications(admin: ReturnType<typeof createAdminClient>) {
  const { data: pending, error } = await admin
    .from("email_deliveries")
    .select("id, user_id, match_id, attempts")
    .eq("status", "pending")
    .lt("attempts", 8)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Could not load queued notifications: ${error.message}`);

  const pendingUserIds = [...new Set((pending || []).map((delivery) => delivery.user_id))];
  const { data: profiles, error: profileError } = pendingUserIds.length
    ? await admin
      .from("profiles")
      .select("user_id, full_name, email_notifications")
      .in("user_id", pendingUserIds)
    : { data: [], error: null };
  if (profileError) throw new Error(`Could not load notification preferences: ${profileError.message}`);
  const profileByUser = new Map((profiles || []).map((profile) => [profile.user_id, profile]));

  const groups = new Map<string, typeof pending>();
  for (const delivery of pending || []) {
    const group = groups.get(delivery.user_id) || [];
    group.push(delivery);
    groups.set(delivery.user_id, group);
  }

  let sent = 0;
  const failures: string[] = [];
  const batches: {
    userId: string;
    recipient: string;
    name: string;
    deliveries: NonNullable<typeof pending>;
  }[] = [];

  for (const [userId, deliveries] of groups) {
    const profile = profileByUser.get(userId);
    if (!profile?.email_notifications) {
      const { error: cancelError } = await admin
        .from("email_deliveries")
        .update({ status: "cancelled" })
        .in("id", deliveries.map((delivery) => delivery.id));
      if (cancelError) failures.push(`Could not cancel opted-out notifications for account ${userId}`);
      continue;
    }

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
    const recipient = authData.user?.email;
    if (authError || !recipient || !authData.user?.email_confirmed_at) {
      failures.push(`No verified email for account ${userId}`);
      continue;
    }

    for (let offset = 0; offset < deliveries.length; offset += 5) {
      batches.push({
        userId,
        recipient,
        name: profile.full_name || authData.user.user_metadata.full_name || "",
        deliveries: deliveries.slice(offset, offset + 5),
      });
    }
  }

  for (let offset = 0; offset < batches.length; offset += 5) {
    const results = await Promise.all(batches.slice(offset, offset + 5).map(async (batch) => {
      const deliveryIds = batch.deliveries.map((delivery) => delivery.id);
      const { data: matches, error: matchError } = await admin
        .from("job_matches")
        .select("id, company_name, title, job_url, match_score")
        .in("id", batch.deliveries.map((delivery) => delivery.match_id));
      if (matchError || !matches) {
        return { sent: 0, failure: `Could not load matches for account ${batch.userId}` };
      }

      try {
        await sendMatchEmail(
          {
            recipient: batch.recipient,
            name: batch.name,
            roles: matches.map((match) => ({
              company: match.company_name,
              title: match.title,
              url: match.job_url,
              score: match.match_score,
            })),
          },
        );
        const { error: updateError } = await admin
          .from("email_deliveries")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .in("id", deliveryIds);
        if (updateError) {
          return { sent: 0, failure: `Email sent but delivery status could not be updated for account ${batch.userId}` };
        }
        return { sent: batch.deliveries.length, failure: null };
      } catch (sendError) {
        const message = sendError instanceof Error ? sendError.message : "Email delivery failed";
        const attemptResults = await Promise.all(batch.deliveries.map((delivery) => {
          const attempts = delivery.attempts + 1;
          return admin
            .from("email_deliveries")
            .update({
              attempts,
              ...(attempts >= 8 ? { status: "failed" } : {}),
            })
            .eq("id", delivery.id);
        }));
        if (attemptResults.some((result) => result.error)) {
          console.error("Could not increment notification retry count.", { userId: batch.userId });
        }
        return { sent: 0, failure: `${batch.userId}: ${message}` };
      }
    }));

    for (const result of results) {
      sent += result.sent;
      if (result.failure) failures.push(result.failure);
    }
  }

  return { sent, failures };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: scanState, error: stateError } = await admin
      .from("scan_state")
      .select("cursor_id")
      .eq("scan_name", "job-sources")
      .maybeSingle();
    if (stateError) throw new Error(`Could not load scan cursor: ${stateError.message}`);

    let sourceQuery = admin
      .from("job_sources")
      .select("id, user_id, provider, board_slug, company_name")
      .eq("active", true)
      .order("id")
      .limit(20);
    if (scanState?.cursor_id) sourceQuery = sourceQuery.gt("id", scanState.cursor_id);
    const { data: firstSources, error: sourceError } = await sourceQuery;
    let sources = firstSources;
    if (sourceError) throw new Error(`Could not load job sources: ${sourceError.message}`);
    if (scanState?.cursor_id && !sources?.length) {
      const { data, error } = await admin
        .from("job_sources")
        .select("id, user_id, provider, board_slug, company_name")
        .eq("active", true)
        .order("id")
        .limit(20);
      if (error) throw new Error(`Could not restart job-source scan: ${error.message}`);
      sources = data;
    }

    const sourceOwners = [...new Set((sources || []).map((source) => source.user_id))];
    const { data: profiles, error: profileError } = sourceOwners.length
      ? await admin
        .from("profiles")
        .select("user_id, full_name, target_role, location, keywords, email_notifications")
        .eq("scans_enabled", true)
        .in("user_id", sourceOwners)
      : { data: [], error: null };
    if (profileError) throw new Error(`Could not load profiles: ${profileError.message}`);

    const profileByUser = new Map((profiles || []).map((profile) => [profile.user_id, profile as Profile]));
    let scanned = 0;
    let newMatches = 0;
    const failures: string[] = [];

    for (let offset = 0; offset < (sources || []).length; offset += 10) {
      const batch = (sources || []).slice(offset, offset + 10) as Source[];
      const results = await Promise.all(batch.map(async (source) => {
        const profile = profileByUser.get(source.user_id);
        if (!profile || (!profile.target_role && !profile.keywords.length)) {
          return { scanned: 0, matches: 0, failure: null as string | null };
        }
        try {
          const matches = await processSource(admin, source, profile);
          return { scanned: 1, matches, failure: null as string | null };
        } catch (scanError) {
          const message = scanError instanceof Error ? scanError.message : "Unknown board scan error";
          console.error("Job source scan failed.", { sourceId: source.id, message });
          return {
            scanned: 0,
            matches: 0,
            failure: `${source.provider}/${source.board_slug}: ${message}`,
          };
        }
      }));
      for (const result of results) {
        scanned += result.scanned;
        newMatches += result.matches;
        if (result.failure) failures.push(result.failure);
      }
    }

    if (sources?.length) {
      const { error: cursorError } = await admin
        .from("scan_state")
        .upsert(
          { scan_name: "job-sources", cursor_id: sources[sources.length - 1].id },
          { onConflict: "scan_name" },
        );
      if (cursorError) throw new Error(`Could not advance scan cursor: ${cursorError.message}`);
    }

    const notifications = await sendPendingNotifications(admin);
    failures.push(...notifications.failures);
    return NextResponse.json({
      scanned,
      newMatches,
      notificationsSent: notifications.sent,
      failures,
    });
  } catch (error) {
    console.error("Scheduled job scan failed.", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scheduled scan failed." },
      { status: 500 },
    );
  }
}
