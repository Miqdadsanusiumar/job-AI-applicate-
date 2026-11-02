import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  request: NextRequest,
  context: RouteContext<"/api/sources/[id]">,
) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to manage job sources." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("job_sources")
    .update({ active: false })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("active", true)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Could not pause job source.", error.message);
    return NextResponse.json({ error: "Could not pause job source." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Active job source not found." }, { status: 404 });
  }

  return NextResponse.json({ source: data });
}
