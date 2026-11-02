import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

type ProfileInput = {
  fullName: string;
  targetRole: string;
  location: string;
  linkedinUrl: string;
  portfolioUrl: string;
  keywords: string[];
  emailNotifications: boolean;
  scansEnabled: boolean;
  resumePath: string | null;
};

function isProfileInput(value: unknown): value is ProfileInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  const boundedString = (entry: unknown, max: number) =>
    typeof entry === "string" && entry.length <= max;
  return (
    boundedString(input.fullName, 120) &&
    boundedString(input.targetRole, 160) &&
    boundedString(input.location, 160) &&
    boundedString(input.linkedinUrl, 500) &&
    boundedString(input.portfolioUrl, 500) &&
    Array.isArray(input.keywords) &&
    input.keywords.length <= 40 &&
    input.keywords.every((keyword) => typeof keyword === "string" && keyword.trim().length <= 60) &&
    typeof input.emailNotifications === "boolean" &&
    typeof input.scansEnabled === "boolean" &&
    (input.resumePath === null || (typeof input.resumePath === "string" && input.resumePath.length <= 500))
  );
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to view your profile." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, target_role, location, linkedin_url, portfolio_url, keywords, resume_path, email_notifications, scans_enabled, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Could not load profile.", error.message);
    return NextResponse.json({ error: "Could not load your profile." }, { status: 500 });
  }

  return NextResponse.json({
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at),
    profile: data,
  });
}

export async function PUT(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to update your profile." }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isProfileInput(input)) {
    return NextResponse.json({ error: "Profile details are invalid or too long." }, { status: 400 });
  }

  if (input.resumePath && !input.resumePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: "The resume must belong to your account." }, { status: 400 });
  }

  const urls = [input.linkedinUrl, input.portfolioUrl].filter(Boolean);
  if (urls.some((value) => {
    try {
      return new URL(value).protocol !== "https:";
    } catch {
      return true;
    }
  })) {
    return NextResponse.json({ error: "Profile links must be valid HTTPS URLs." }, { status: 400 });
  }

  if (input.emailNotifications && !user.email_confirmed_at) {
    return NextResponse.json({ error: "Verify your sign-in email before enabling alerts." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: user.id,
        full_name: input.fullName.trim(),
        target_role: input.targetRole.trim(),
        location: input.location.trim(),
        linkedin_url: input.linkedinUrl.trim(),
        portfolio_url: input.portfolioUrl.trim(),
        keywords: input.keywords.map((keyword) => keyword.trim()).filter(Boolean),
        resume_path: input.resumePath,
        email_notifications: input.emailNotifications,
        scans_enabled: input.scansEnabled,
      },
      { onConflict: "user_id" },
    )
    .select("full_name, target_role, location, linkedin_url, portfolio_url, keywords, resume_path, email_notifications, scans_enabled, updated_at")
    .single();

  if (error) {
    console.error("Could not save profile.", error.message);
    return NextResponse.json({ error: "Could not save your profile." }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}
