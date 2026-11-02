import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

type SourceInput = {
  provider: "greenhouse" | "lever";
  boardSlug: string;
  companyName: string;
};

function isSourceInput(value: unknown): value is SourceInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return (
    (input.provider === "greenhouse" || input.provider === "lever") &&
    typeof input.boardSlug === "string" &&
    /^[A-Za-z0-9_-]{1,100}$/.test(input.boardSlug) &&
    typeof input.companyName === "string" &&
    input.companyName.trim().length > 0 &&
    input.companyName.trim().length <= 120
  );
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to view your job sources." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("job_sources")
    .select("id, provider, board_slug, company_name, active, created_at")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Could not load job sources.", error.message);
    return NextResponse.json({ error: "Could not load job sources." }, { status: 500 });
  }

  return NextResponse.json({ sources: data });
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to add a job source." }, { status: 401 });
  }

  const { count, error: countError } = await supabase
    .from("job_sources")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("active", true);
  if (countError) {
    console.error("Could not check the job-source limit.", countError.message);
    return NextResponse.json({ error: "Could not check the job-source limit." }, { status: 500 });
  }
  if ((count || 0) >= 10) {
    return NextResponse.json({ error: "You can connect up to 10 active job boards." }, { status: 409 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isSourceInput(input)) {
    return NextResponse.json({ error: "Enter a supported board and a valid board slug." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("job_sources")
    .insert({
      user_id: user.id,
      provider: input.provider,
      board_slug: input.boardSlug,
      company_name: input.companyName.trim(),
    })
    .select("id, provider, board_slug, company_name, active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "That job board is already in your sources." }, { status: 409 });
    }
    console.error("Could not add job source.", error.message);
    return NextResponse.json({ error: "Could not add job source." }, { status: 500 });
  }

  return NextResponse.json({ source: data }, { status: 201 });
}
