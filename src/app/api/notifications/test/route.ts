import { NextResponse, type NextRequest } from "next/server";

import { sendTestEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Sign in to send a test notification." }, { status: 401 });
  }

  if (!user.email || !user.email_confirmed_at) {
    return NextResponse.json({ error: "Verify your sign-in email before sending notifications." }, { status: 403 });
  }
  if (!process.env.GMAIL_WEB_APP_URL || !process.env.GMAIL_WEB_APP_TOKEN) {
    return NextResponse.json({ error: "Email delivery is not configured on this deployment." }, { status: 503 });
  }

  try {
    const { data: canSend, error: limitError } = await supabase.rpc("claim_email_test_window");
    if (limitError) {
      console.error("Could not check the notification test limit.", limitError.message);
      return NextResponse.json({ error: "Could not check notification limits." }, { status: 500 });
    }
    if (!canSend) {
      return NextResponse.json({ error: "A test email was already sent recently. Try again in 10 minutes." }, { status: 429 });
    }

    const result = await sendTestEmail(
      user.email,
      typeof user.user_metadata.full_name === "string" ? user.user_metadata.full_name : "",
    );
    return NextResponse.json({ sent: true, id: result.id });
  } catch (sendError) {
    console.error("Test notification failed.", sendError);
    return NextResponse.json(
      { error: sendError instanceof Error ? sendError.message : "The test notification could not be sent." },
      { status: 502 },
    );
  }
}
