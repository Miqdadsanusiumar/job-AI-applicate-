import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/matches/[id]">,
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const status = body && typeof body === "object" && "status" in body
    ? body.status
    : null;
  if (status !== "approved" && status !== "dismissed") {
    return NextResponse.json({ error: "Choose an approval or dismissal status." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to update a job match." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("job_matches")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("Could not update job match.", error.message);
    return NextResponse.json({ error: "Could not update this job match." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Job match not found." }, { status: 404 });
  }

  return NextResponse.json({ match: data });
}
