// The invite email.
//
// Built on the shared shell in email-layout.js, so this file holds only what is
// specific to an invitation. The chrome -- paper ground, lockup, card,
// anti-phishing footer -- is shared with the org-code mail, because the two go
// to the same people from the same address and two hand-built layouts would
// eventually disagree about the colour of a card.
//
// Four things were corrected against the shipping app rather than copied from
// the design wireframe:
//
//   1. THE MARK. The wireframe drew three grey bars and one sky one. The mark is
//      four colours, and its bar widths are 0.552 / 0.789 / 1.0 / 0.448 of the
//      full width. The wireframe's 22/30/19/12 is a different shape entirely.
//   2. THE LINK. The wireframe pointed at app.traqs.com/invite/accept?token=...
//      That domain is not ours -- traqs.com is a live business on someone
//      else's hosting, and app.traqs.com resolves to their server. Sending
//      employees there would have handed a stranger the traffic. The app reads
//      ?org=CODE&invite=TOKEN off the root URL; that is what is built here.
//   3. THE EXPIRY. The wireframe said 7 days. INVITE_TTL_MS is 14, and the copy
//      is generated from the invite's own expiresAt rather than restated, so it
//      cannot drift again.
//   4. THE POSTAL ADDRESS. The wireframe carried "123 Example St". There is no
//      address at all now: CAN-SPAM requires one on commercial mail, and these
//      are transactional, which is exempt.

import { esc } from "./mail.js";
// The shell: paper ground, real wordmark, drawn mark, card, anti-phishing
// footer. Shared with the org-code mail so the two cannot drift apart.
import { shell, button, textFooter, FONT, INK, MUTED, BODY, RULE, LINK } from "./email-layout.js";

const daysUntil = (iso) => {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
};

/**
 * @param {object} a
 * @param {string} a.orgName     the organization being joined
 * @param {string} a.inviterName who sent it (falls back to their email)
 * @param {string} a.acceptUrl   the full link, built by the caller
 * @param {string} a.expiresAt   ISO, straight off the invite
 * @param {string} [a.inviteeName]  the name the admin typed on Add Employee
 * @param {string} [a.appStoreUrl]  IOS_APP_STORE_URL; empty = no download line
 * @returns {{subject: string, html: string, text: string}}
 */
export function inviteEmail({ orgName, inviterName, acceptUrl, expiresAt, inviteeName, appStoreUrl }) {
  const org = orgName || "your organization";
  const who = inviterName || "An administrator";
  const days = daysUntil(expiresAt);
  const expiryLine = days ? `This invitation expires in ${days} day${days === 1 ? "" : "s"}.` : "";
  // First name only: "Hi Sam," not "Hi Sam Rivera,". Absent for an invite sent
  // without a roster row, where all we know is the address.
  const first = String(inviteeName || "").trim().split(/\s+/)[0] || "";
  const greeting = first ? `Hi ${first},` : "";

  // THE iPHONE LINE. The Accept button is a universal link: with TRAQS
  // installed, iOS opens the app on it instead of Safari, so the same button
  // serves both. Only the download half depends on a store listing, and it is
  // left out entirely until there is one -- a "get the app" line with nowhere to
  // go is worse than none.
  const appLine = "On your iPhone? Accept opens the TRAQS app if you have it installed.";

  const subject = `You're invited to join ${org} on TRAQS`;

  const text = [
    ...(greeting ? [greeting, ""] : []),
    `${who} has invited you to join ${org} on TRAQS.`,
    "",
    "Accept the invitation to create your employee account:",
    acceptUrl,
    "",
    appLine,
    ...(appStoreUrl ? ["Don't have it yet? Download TRAQS for iPhone:", appStoreUrl] : []),
    "",
    expiryLine,
    "",
    "No account will be created unless you accept.",
    "",
    textFooter(),
  ].join(String.fromCharCode(10));

  const rows = `${greeting ? `
<tr><td style="font-family:${FONT};font-size:15px;color:${INK};mso-line-height-rule:exactly;line-height:23px;padding-bottom:12px">${esc(greeting)}</td></tr>` : ""}
<tr><td style="font-family:${FONT};font-size:15px;color:${BODY};mso-line-height-rule:exactly;line-height:23px;padding-bottom:28px"><strong style="color:${INK}">${esc(who)}</strong> has invited you to join <strong style="color:${INK}">${esc(org)}</strong> on TRAQS. Accept the invitation to create your employee account and get started.</td></tr>
${button(acceptUrl, "Accept invitation", esc)}
<tr><td style="font-family:${FONT};font-size:13px;color:${BODY};mso-line-height-rule:exactly;line-height:20px;padding-bottom:24px">${esc(appLine)}${appStoreUrl ? `<br>Don't have it yet? <a href="${esc(appStoreUrl)}" style="color:${LINK};font-weight:600">Download TRAQS for iPhone</a>` : ""}</td></tr>
<tr><td style="border-top:1px solid ${RULE};padding-top:20px;font-family:${FONT};font-size:12px;color:${MUTED};mso-line-height-rule:exactly;line-height:19px">Button not working? Paste this link into your browser:<br><a href="${esc(acceptUrl)}" style="color:${LINK};word-break:break-all">${esc(acceptUrl)}</a>${expiryLine ? `<br><br>${esc(expiryLine)}` : ""}</td></tr>`;

  const html = shell({
    title: subject,
    preheader: `${who} invited you to join ${org} on TRAQS. Accept to create your employee account.`,
    eyebrow: "Organization invite",
    heading: `You're invited to join ${esc(org)}`,
    rows,
    esc,
  });

  return { subject, html, text };
}

/** The link the app actually understands: ?org=CODE&invite=TOKEN at the root. */
export const inviteAcceptUrl = (baseUrl, orgCode, token) => {
  let b = String(baseUrl);
  while (b.endsWith("/")) b = b.slice(0, -1);
  return `${b}/?org=${encodeURIComponent(orgCode)}&invite=${encodeURIComponent(token)}`;
};
