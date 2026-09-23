// The invite email.
//
// Built from "TRAQS Invite Email.html" in the design project, with four things
// corrected against the shipping app rather than copied across:
//
//   1. THE MARK. The wireframe drew three grey bars and one sky one. The mark is
//      four colours -- coral, amber, sky, green -- and its bar widths are
//      0.552 / 0.789 / 1.0 / 0.448 of the full width. The wireframe's 22/30/19/12
//      is 0.73 / 1.0 / 0.63 / 0.4, a different shape entirely.
//   2. THE LINK. The wireframe pointed at app.traqs.com/invite/accept?token=...
//      That domain is not ours -- traqs.com is a live business on someone else's
//      hosting, and app.traqs.com resolves to their server. Sending employees
//      there would have handed a stranger the traffic. The app reads
//      ?org=CODE&invite=TOKEN off the root URL; that is what is built here.
//   3. THE EXPIRY. The wireframe said 7 days. INVITE_TTL_MS is 14, and the copy
//      is generated from the invite's own expiresAt rather than restated, so it
//      cannot drift again.
//   4. THE POSTAL ADDRESS. The wireframe carried "123 Example St". CAN-SPAM
//      requires a real one, so it comes from env and the block is omitted
//      entirely rather than shipping a placeholder that looks deliberate.
//
// TABLES AND INLINE STYLES, NOT FLEXBOX. Outlook renders with Word's HTML
// engine: no flex, no grid, no external stylesheet, and margins are unreliable.
// The nested-table shape below is what survives it, which is why it looks like
// 2004 in here.
//
// ARIAL, NOT DM SANS, AND THAT IS NOT DRIFT. The app is one typeface because it
// can load one; an email client mostly cannot, and a webfont that fails to load
// falls back unpredictably per client. DM Sans is named first for the clients
// that will honour it, with Arial behind it for the ones that will not.

import { esc } from "./mail.js";

// Same four colours as src/App.jsx BRAND_BARS, in the same order. Restated here
// because a Netlify function cannot import from the React bundle; the brand test
// checks that these two lists agree.
const BARS = [
  { c: "#FF6B57", w: 0.552 },
  { c: "#F0A819", w: 0.789 },
  { c: "#38BDF8", w: 1 },
  { c: "#1D7D5C", w: 0.448 },
];

const FONT = "'DM Sans',Arial,Helvetica,sans-serif";
const PAPER = "#eae7e0";
const CARD = "#faf8f3";
const INK = "#141414";
const MUTED = "#6f6f6b";

// The mark, as table rows. An <img> would be the obvious choice and is the wrong
// one: most clients block remote images by default, so the logo would be a grey
// box on first open. Coloured table cells always render.
const MARK_W = 34;   // px, the widest bar
const mark = () => BARS.map(({ c, w }, i) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${Math.round(MARK_W * w)}" style="width:${Math.round(MARK_W * w)}px"><tr><td height="5" style="height:5px;background:${c};border-radius:2px;font-size:0;line-height:0">&nbsp;</td></tr></table>${
  i < BARS.length - 1 ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td height="3" style="height:3px;font-size:0;line-height:0">&nbsp;</td></tr></table>` : ""}`).join("");

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
 * @returns {{subject: string, html: string, text: string}}
 */
export function inviteEmail({ orgName, inviterName, acceptUrl, expiresAt }) {
  const org = orgName || "your organization";
  const who = inviterName || "An administrator";
  const days = daysUntil(expiresAt);
  const expiryLine = days ? `This invitation expires in ${days} day${days === 1 ? "" : "s"}.` : "";
  // Only if it is real. A fake address is worse than none.
  const postal = (process.env.MAIL_POSTAL_ADDRESS || "").trim();

  const subject = `You're invited to join ${org} on TRAQS`;

  const text = [
    `${who} has invited you to join ${org} on TRAQS.`,
    "",
    "Accept the invitation to create your employee account:",
    acceptUrl,
    "",
    expiryLine,
    "",
    "TRAQS will never ask for your password, organization code, or personal",
    "information by email, phone, or text. If anyone requests this information",
    "claiming to be from TRAQS, do not respond.",
    "",
    "If you weren't expecting this invitation, you can safely ignore this email.",
    "No account will be created unless you accept.",
    postal ? "" : null,
    postal || null,
  ].filter((l) => l !== null).join("\n");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<style>a{color:#0284c7}@media (max-width:620px){.wrap{width:100%!important}.pad{padding-left:24px!important;padding-right:24px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${PAPER}">
<span style="display:none;font-size:1px;color:${PAPER};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(who)} invited you to join ${esc(org)} on TRAQS. Accept to create your employee account.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}"><tr><td align="center" style="padding:40px 12px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">

<tr><td align="center" style="padding:0 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${FONT};font-size:30px;font-weight:bold;color:${INK};letter-spacing:-1px;mso-line-height-rule:exactly;line-height:34px">traqs</td>
<td width="6" style="width:6px"></td>
<td valign="bottom" style="padding-bottom:4px">${mark()}</td>
</tr></table></td></tr>

<tr><td class="pad" style="background:${CARD};border-radius:18px;padding:44px 48px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font-family:${FONT};font-size:11px;letter-spacing:2px;color:${MUTED};text-transform:uppercase;padding-bottom:14px">Organization invite</td></tr>
<tr><td style="font-family:${FONT};font-size:26px;font-weight:bold;color:${INK};mso-line-height-rule:exactly;line-height:32px;padding-bottom:14px">You're invited to join ${esc(org)}</td></tr>
<tr><td style="font-family:${FONT};font-size:15px;color:#4a4a47;mso-line-height-rule:exactly;line-height:23px;padding-bottom:28px"><strong style="color:${INK}">${esc(who)}</strong> has invited you to join <strong style="color:${INK}">${esc(org)}</strong> on TRAQS. Accept the invitation to create your employee account and get started.</td></tr>
<tr><td align="left" style="padding-bottom:28px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="background:${INK};border-radius:999px">
<a href="${esc(acceptUrl)}" style="display:block;padding:15px 34px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">Accept invitation</a>
</td></tr></table></td></tr>
<tr><td style="border-top:1px solid #e3e0d8;padding-top:20px;font-family:${FONT};font-size:12px;color:${MUTED};mso-line-height-rule:exactly;line-height:19px">Button not working? Paste this link into your browser:<br><a href="${esc(acceptUrl)}" style="color:#0284c7;word-break:break-all">${esc(acceptUrl)}</a>${expiryLine ? `<br><br>${esc(expiryLine)}` : ""}</td></tr>
</table></td></tr>

<tr><td class="pad" style="padding:26px 48px 0;font-family:${FONT};font-size:11px;color:${MUTED};mso-line-height-rule:exactly;line-height:17px" align="center">
<strong style="color:#4a4a47">TRAQS will never ask for your password, organization code, or personal information by email, phone, or text.</strong> If anyone requests this information claiming to be from TRAQS, do not respond.<br><br>
If you weren't expecting this invitation, you can safely ignore this email. No account will be created unless you accept.${postal ? `<br><br>${esc(postal)}` : ""}
</td></tr>

</table></td></tr></table>
</body></html>`;

  return { subject, html, text };
}

/** The link the app actually understands: ?org=CODE&invite=TOKEN at the root. */
export const inviteAcceptUrl = (baseUrl, orgCode, token) =>
  `${String(baseUrl).replace(/\/+$/, "")}/?org=${encodeURIComponent(orgCode)}&invite=${encodeURIComponent(token)}`;
