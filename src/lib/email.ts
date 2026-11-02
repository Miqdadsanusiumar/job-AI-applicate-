import "server-only";

type MatchEmail = {
  recipient: string;
  name: string;
  roles: { company: string; title: string; url: string; score: number }[];
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

async function sendEmail(payload: {
  to: string;
  subject: string;
  html: string;
  idempotencyKey?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(payload.idempotencyKey
        ? { "Idempotency-Key": payload.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    await response.body?.cancel();
    console.error("Email provider rejected a notification.", {
      status: response.status,
    });
    throw new Error("The email provider could not send the notification.");
  }

  return response.json() as Promise<{ id: string }>;
}

export async function sendTestEmail(recipient: string, name: string) {
  return sendEmail({
    to: recipient,
    subject: "Your Jobpilot email alerts are working",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#263329"><h1 style="font-size:22px">Email notifications are ready</h1><p>Hello ${escapeHtml(name || "there")},</p><p>This test confirms Jobpilot can send messages to your verified sign-in email. You control which job alerts are enabled in your account.</p><p style="color:#718071;font-size:13px">No applications were submitted.</p></div>`,
  });
}

export async function sendMatchEmail(input: MatchEmail, idempotencyKey: string) {
  const name = escapeHtml(input.name || "there");
  const roles = input.roles
    .map(
      (role) =>
        `<li style="margin:0 0 16px"><a href="${escapeHtml(role.url)}" style="color:#286b4c;font-weight:bold">${escapeHtml(role.title)}</a> at ${escapeHtml(role.company)} <span style="color:#66806b">(${role.score}% match)</span></li>`,
    )
    .join("");

  return sendEmail({
    to: input.recipient,
    subject:
      input.roles.length === 1
        ? `A new job match: ${input.roles[0].title} at ${input.roles[0].company}`
        : `${input.roles.length} new job matches for you`,
    idempotencyKey,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#263329"><h1 style="font-size:22px">A new opportunity, ${name}</h1><p>These roles match the preferences in your Jobpilot profile:</p><ul>${roles}</ul><p style="color:#718071;font-size:13px">Review every opportunity in Jobpilot. Nothing is submitted without your approval.</p></div>`,
  });
}
