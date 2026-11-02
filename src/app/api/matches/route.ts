import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to view job matches." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("job_matches")
    .select("id, source_id, external_id, company_name, title, location, employment_type, job_url, description, match_score, match_reason, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Could not load job matches.", error.message);
    return NextResponse.json({ error: "Could not load job matches." }, { status: 500 });
  }

  return NextResponse.json({ matches: data });
}
