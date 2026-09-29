// The "here is your organization code" email.
//
// Was a bare <p>Hello,</p> and an unstyled table, which next to the invite mail
// looked like it came from a different company. Built on the shared shell now,
// so both carry the same mark, card and anti-phishing footer.
//
// THE CODE IS THE POINT. It is set large, in a bordered panel, letter-spaced and
// selectable, because the one thing the recipient does with this email is read a
// code off it and type it into another window. Everything else is framing.

import { shell, textFooter, FONT, INK, MUTED, BODY, RULE } from "./email-layout.js";

/**
 * @param {object} a
 * @param {{code: string, name: string}[]} a.orgs  every org this admin holds
 * @param {string} a.esc  HTML escaper
 */
export function orgCodeEmail({ orgs, esc }) {
  const list = Array.isArray(orgs) ? orgs : [];
  const many = list.length > 1;

  // One panel per organization. An admin of several gets several, which is why
  // the heading is plural-aware rather than assuming a single code.
  const panels = list.map((o) => `
<tr><td style="padding-bottom:12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RULE};border-radius:12px">
    <tr><td style="padding:16px 18px 14px" align="center">
      <div style="font-family:${FONT};font-size:12px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:1px;padding-bottom:8px">${esc(o.name || "Organization")}</div>
      <div style="font-family:${FONT};font-size:24px;font-weight:bold;color:${INK};letter-spacing:3px;word-break:break-all">${esc(o.code)}</div>
    </td></tr>
  </table>
</td></tr>`).join("");

  const rows = `
<tr><td style="font-family:${FONT};font-size:15px;color:${BODY};mso-line-height-rule:exactly;line-height:23px;padding-bottom:22px">
  You asked for your TRAQS organization code. Enter ${many ? "one of these" : "it"} on the sign-in screen to reach your ${many ? "organizations" : "organization"}.
</td></tr>
${panels}
<tr><td style="border-top:1px solid ${RULE};padding-top:20px;font-family:${FONT};font-size:12px;color:${MUTED};mso-line-height-rule:exactly;line-height:19px">
  This code identifies your organization; it is not a password and it does not sign anyone in on its own.
  If you did not ask for this, no action is needed.
</td></tr>`;

  const subject = many ? "Your TRAQS organization codes" : "Your TRAQS organization code";

  const text = [
    `You asked for your TRAQS organization code. Enter ${many ? "one of these" : "it"} on the sign-in screen:`,
    "",
    ...list.map((o) => `  ${o.name || "Organization"}: ${o.code}`),
    "",
    "This code identifies your organization; it is not a password and it does",
    "not sign anyone in on its own. If you did not ask for this, no action is",
    "needed.",
    "",
    textFooter(),
  ].join("\n");

  const html = shell({
    title: subject,
    preheader: many
      ? `Your organization codes: ${list.map((o) => o.code).join(", ")}`
      : `Your organization code: ${list[0]?.code || ""}`,
    eyebrow: "Organization code",
    heading: many ? "Your organization codes" : "Your organization code",
    rows,
    esc,
  });

  return { subject, html, text };
}
