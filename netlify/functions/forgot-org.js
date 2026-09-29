import { readJson, listOrgCodes } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
// One SES client and one sender for the whole codebase -- see _utils/mail.js.
// The default that used to sit here was no-reply@traqs.app, a domain that
// belongs to someone else, so an unset SEND_FROM_EMAIL would have tried to send
// as a stranger. There is no default now.
import { sendEmail } from "./_utils/mail.js";
import { orgCodeEmail } from "./_utils/email-orgcode.js";

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

  // ADMINS ONLY. The org code is the first factor for signing in, so the recovery
  // path has to be no weaker than the thing it recovers.
  //
  // This used to match on the org's DOMAIN as well, which meant anybody able to
  // receive mail at a matching domain could ask for the code and be sent it.
  // Measured against live data: MTX2026TRAQS carries domain "matrixpci.com", so
  // every address at the company qualified -- and a domain is not a secret, it is
  // printed on the website.
  //
  // It also only ever checked the singular adminEmail, so a second admin listed in
  // adminEmails could not recover the code for their own organization. Both halves
  // are fixed here: every listed admin, and nobody else.
  const isOrgAdmin = (config) => {
    if (!config) return false;
    const listed = Array.isArray(config.adminEmails) ? config.adminEmails : [];
    return [config.adminEmail, ...listed]
      .filter(Boolean)
      .some((a) => String(a).trim().toLowerCase() === email);
  };

  // Scan all orgs and find any the requester is an admin of
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
      // A deleted organization is not recoverable and must not be named in mail:
      // its code still resolves here even though org.js 404s on it.
      if (config.deletedAt) return;
      if (isOrgAdmin(config)) {
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

  const { subject, html, text } = orgCodeEmail({ orgs: matches, esc });

  const sent = await sendEmail({ to: email, subject, text, html });
  if (!sent.ok) return err(500, "Failed to send email — please contact your administrator");

  return json(200, { ok: true });
}
