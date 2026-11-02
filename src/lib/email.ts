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
}) {
  const endpoint = process.env.GMAIL_WEB_APP_URL;
  const token = process.env.GMAIL_WEB_APP_TOKEN;
  if (!endpoint || !token) {
    throw new Error("Gmail delivery is not configured. Set GMAIL_WEB_APP_URL and GMAIL_WEB_APP_TOKEN.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, ...payload }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => null) as
    | { sent?: boolean; id?: string; error?: string }
    | null;
  if (!response.ok || !result?.sent || !result.id) {
    console.error("Gmail mailer rejected a notification.", {
      status: response.status,
      error: result?.error,
    });
    throw new Error(result?.error || "The Gmail mailer could not send the notification.");
  }
  return { id: result.id };
}

export async function sendTestEmail(recipient: string, name: string) {
  return sendEmail({
    to: recipient,
    subject: "Your Jobpilot email alerts are working",
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#263329"><h1 style="font-size:22px">Email notifications are ready</h1><p>Hello ${escapeHtml(name || "there")},</p><p>This test confirms Jobpilot can send messages to your verified sign-in email. You control which job alerts are enabled in your account.</p><p style="color:#718071;font-size:13px">No applications were submitted.</p></div>`,
  });
}

export async function sendMatchEmail(input: MatchEmail) {
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
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:32px auto;color:#263329"><h1 style="font-size:22px">A new opportunity, ${name}</h1><p>These roles match the preferences in your Jobpilot profile:</p><ul>${roles}</ul><p style="color:#718071;font-size:13px">Review every opportunity in Jobpilot. Nothing is submitted without your approval.</p></div>`,
  });
}
