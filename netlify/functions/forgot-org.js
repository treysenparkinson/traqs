import { readJson, listOrgCodes } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
// One SES client and one sender for the whole codebase -- see _utils/mail.js.
// The default that used to sit here was no-reply@traqs.app, a domain that
// belongs to someone else, so an unset SEND_FROM_EMAIL would have tried to send
// as a stranger. There is no default now.
import { sendEmail } from "./_utils/mail.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  if (event.httpMethod !== "POST") return err(405, "Method not allowed");

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return err(400, "Invalid JSON body");
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return err(400, "Valid email address required");

  const emailDomain = email.split("@")[1];

  // Scan all orgs and find any where adminEmail or domain matches
  let codes;
  try {
    codes = await listOrgCodes();
  } catch (e) {
    console.error("listOrgCodes error:", e);
    return err(500, "Failed to search organizations");
  }

  const matches = [];
  await Promise.all(
    codes.map(async (code) => {
      const config = await readJson(`orgs/${code}/config.json`).catch(() => null);
      if (!config) return;
      const isAdmin = config.adminEmail?.toLowerCase() === email;
      const isDomainMatch = config.domain?.toLowerCase() === emailDomain;
      if (isAdmin || isDomainMatch) {
        matches.push({ code, name: config.name });
      }
    })
  );

  // Always respond with success to avoid email enumeration
  if (matches.length === 0) {
    return json(200, { ok: true });
  }

  // Escape every interpolated org field — these come from createOrg input
  // and could otherwise smuggle HTML/JS into the email body. The code is
  // already constrained by the [a-zA-Z0-9]{3,20} regex, but the name is
  // free-form, so escaping is the right baseline.
  const esc = (s) => String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const orgList = matches
    .map((m) => `  • ${m.name}  —  Code: ${m.code}`)
    .join("\n");

  const bodyText = `Hello,

You requested your TRAQS organization code. Here ${matches.length === 1 ? "it is" : "are your codes"}:

${orgList}

Enter this code on the TRAQS login screen to access your organization.

If you did not request this, you can safely ignore this email.

— The TRAQS Team`;

  const bodyHtml = `<p>Hello,</p>
<p>You requested your TRAQS organization code. Here ${matches.length === 1 ? "it is" : "are your codes"}:</p>
<table cellpadding="12" style="border-collapse:collapse;margin:16px 0;">
${matches.map((m) => `<tr><td style="font-weight:600;">${esc(m.name)}</td><td style="font-family:monospace;font-size:16px;background:#f1f5f9;padding:8px 16px;border-radius:6px;">${esc(m.code)}</td></tr>`).join("")}
</table>
<p>Enter this code on the TRAQS login screen to access your organization.</p>
<p style="color:#94a3b8;font-size:12px;">If you did not request this, you can safely ignore this email.</p>`;

  const sent = await sendEmail({
    to: email,
    subject: "Your TRAQS Organization Code",
    text: bodyText,
    html: bodyHtml,
  });
  if (!sent.ok) return err(500, "Failed to send email — please contact your administrator");

  return json(200, { ok: true });
}
