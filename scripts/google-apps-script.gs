function doPost(event) {
  const properties = PropertiesService.getScriptProperties();
  const expectedToken = properties.getProperty("JOBPILOT_TOKEN");
  const allowedRecipient = properties.getProperty("ALLOWED_RECIPIENT");

  if (!expectedToken || !allowedRecipient) {
    return jsonResponse({ sent: false, error: "Mailer setup is incomplete." });
  }

  let payload;
  try {
    payload = JSON.parse(event.postData.contents);
  } catch {
    return jsonResponse({ sent: false, error: "Invalid request body." });
  }

  if (!payload || !constantTimeEqual(payload.token, expectedToken)) {
    return jsonResponse({ sent: false, error: "Unauthorized." });
  }
  if (payload.to !== allowedRecipient) {
    return jsonResponse({ sent: false, error: "Recipient is not allowed." });
  }
  if (
    typeof payload.subject !== "string" ||
    payload.subject.length < 1 ||
    payload.subject.length > 200 ||
    typeof payload.html !== "string" ||
    payload.html.length > 50000
  ) {
    return jsonResponse({ sent: false, error: "Invalid email content." });
  }

  try {
    GmailApp.sendEmail(payload.to, payload.subject, "Please view this message in an HTML-capable email client.", {
      htmlBody: payload.html,
      name: "Jobpilot",
    });
    return jsonResponse({ sent: true, id: Utilities.getUuid() });
  } catch (error) {
    console.error("Gmail delivery failed.", error);
    return jsonResponse({ sent: false, error: "Gmail could not send the message." });
  }
}

function constantTimeEqual(actual, expected) {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
