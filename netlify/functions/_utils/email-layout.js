// The shell every TRAQS email is built in: paper ground, drawn mark, card,
// anti-phishing footer.
//
// Extracted so the invite and the org-code mail cannot drift apart. They go to
// the same people from the same address, and two hand-built layouts would
// eventually disagree about the colour of the card.
//
// TABLES AND INLINE STYLES, NOT FLEXBOX. Outlook renders with Word's HTML
// engine: no flex, no grid, no external stylesheet, and margins are unreliable.
// The nested-table shape below is what survives it, which is why it looks like
// 2004 in here.
//
// ARIAL BEHIND DM SANS, AND THAT IS NOT DRIFT. The app is one typeface because
// it can load one; an email client mostly cannot, and a webfont that fails to
// load falls back unpredictably per client. DM Sans is named first for the
// clients that honour it, with Arial behind it for the ones that will not.

// The brand's four colours, in the order the mark stacks them. Measured off
// AppIcon.icon/Assets/traqs-candy-bars.png, not matched by eye -- the sky is
// #38BDF8, exactly the accent the app already uses. A Netlify function cannot
// import from the React bundle, so this list is a second copy and
// scripts/brand-test.mjs asserts it still agrees with src/brand.jsx.
export const BARS = [
  { c: "#FF6B57", w: 0.552 },   // coral
  { c: "#F0A819", w: 0.789 },   // amber
  { c: "#38BDF8", w: 1 },       // sky
  { c: "#1D7D5C", w: 0.448 },   // green
];

export const FONT = "'DM Sans',Arial,Helvetica,sans-serif";
export const PAPER = "#eae7e0";
export const CARD = "#faf8f3";
export const INK = "#141414";
export const MUTED = "#6f6f6b";
export const BODY = "#4a4a47";
export const RULE = "#e3e0d8";
export const LINK = "#0284c7";

// The mark, as table rows. An <img> would be the obvious choice and is the
// wrong one: most clients block remote images by default, so the logo would be
// a grey box on first open. Coloured table cells always render.
// GEOMETRY FROM THE LOCKUP SPEC, not eyeballed. The app draws the mark at
// .52em tall and .619em wide against the wordmark, with bars 650 units and gaps
// 223 -- a bar:gap ratio of 2.91:1 and an overall aspect of 0.840.
//
// What was here measured 34x29 against a 30px wordmark, which is 1.83x too wide
// and 1.86x too tall, with a bar:gap of 1.67:1 -- gaps nearly double what they
// should be. The mark read as a separate graphic parked next to the word rather
// than part of the lockup.
//
// At WORDMARK_PX = 30 the spec gives 18.6 x 15.6. Bars of 3 and gaps of 1 land
// on 18 x 15 with a ratio of 3.0, which is within 3% of 2.91 and the closest
// whole-pixel fit -- and whole pixels matter here, because a fractional table
// cell height is rounded differently by every client.
const WORDMARK_PX = 30;
const MARK_W = Math.round(0.619 * WORDMARK_PX);   // 19
const BAR_H = 3;
const GAP_H = 1;
const BAR_R = 1;                                   // 0.346 x BAR_H, per the spec
export const mark = () => BARS.map(({ c, w }, i) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${Math.round(MARK_W * w)}" style="width:${Math.round(MARK_W * w)}px"><tr><td height="${BAR_H}" style="height:${BAR_H}px;background:${c};border-radius:${BAR_R}px;font-size:0;line-height:0">&nbsp;</td></tr></table>${
  i < BARS.length - 1 ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td height="${GAP_H}" style="height:${GAP_H}px;font-size:0;line-height:0">&nbsp;</td></tr></table>` : ""}`).join("");

// THE REAL WORDMARK, AS AN IMAGE. It is Space Grotesk 700 with a thickened
// stroke, and no email client will load a webfont reliably -- rendered as live
// text it falls back to Arial, which is not the logo, just a word that says the
// same thing.
//
// Cropped to its ink first. The source is 2348x1200 with the word in the middle
// third: 331px of padding left, 312 right, 282 top, 280 bottom. Placed unpadded
// the layout aligns the FILE rather than the mark, which is why a logo so often
// sits visibly wrong. Served at 2x (150x56) for retina, displayed at 75x28.
//
// The bars stay DRAWN, deliberately. Outlook desktop still blocks images by
// default, and a lockup that is entirely an image degrades to an empty box. This
// way a blocked image leaves the alt text and four correct brand colours.
const MARK_IMG_W = 75;
const MARK_IMG_H = 28;
// Where the baseline sits in the cropped file: the 't' has no descender, so its
// lowest ink is the baseline, measured at 0.767 of the height. The bars sit ON
// the baseline, so they need the descender's worth of padding beneath them --
// bottom-aligning them to the image would hang them level with the q's tail.
const MARK_BASELINE = 0.767;
const DESCENDER_PX = Math.round(MARK_IMG_H * (1 - MARK_BASELINE));   // 7

/** Where the email's images are served from. Must be a PUBLIC url. */
// Trailing slashes trimmed without a regex: this file gets patched through
// shells that eat backslashes, and an escape here silently became a comment.
export const assetBase = () => {
  let b = String(process.env.MAIL_ASSET_BASE || process.env.URL || "");
  while (b.endsWith("/")) b = b.slice(0, -1);
  return b;
};

/** The wordmark plus the mark, centred above the card. */
export const lockup = () => {
  const base = assetBase();
  // No public base means no reachable image, so fall back to type rather than
  // emitting a src nobody can load. A relative URL in an email resolves against
  // nothing and shows a broken icon.
  const word = base
    ? `<img src="${base}/email/traqs-wordmark.png" width="${MARK_IMG_W}" height="${MARK_IMG_H}" alt="traqs" style="display:block;border:0;outline:none;text-decoration:none;width:${MARK_IMG_W}px;height:${MARK_IMG_H}px" />`
    : `<span style="font-family:${FONT};font-size:${WORDMARK_PX}px;font-weight:bold;color:${INK};letter-spacing:-1.5px;line-height:${WORDMARK_PX}px">traqs</span>`;
  return `
<tr><td align="center" style="padding:0 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="bottom" style="mso-line-height-rule:exactly;line-height:${MARK_IMG_H}px">${word}</td>
<td width="3" style="width:3px"></td>
<td valign="bottom" style="padding-bottom:${DESCENDER_PX}px">${mark()}</td>
</tr></table></td></tr>`;
};

/** A dark pill button. */
export const button = (href, label, esc) => `
<tr><td align="left" style="padding-bottom:28px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="background:${INK};border-radius:999px">
<a href="${esc(href)}" style="display:block;padding:15px 34px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">${label}</a>
</td></tr></table></td></tr>`;

/**
 * Wrap content in the full document.
 *
 * @param {object} a
 * @param {string} a.title      the <title>, also used by some clients as a fallback preview
 * @param {string} a.preheader  the grey line every inbox shows next to the subject
 * @param {string} a.eyebrow    small caps label above the heading
 * @param {string} a.heading    the big line
 * @param {string} a.rows       table rows for the card body, already escaped
 * @param {string} a.esc        the caller's escaper
 */
// THE POSTAL ADDRESS STAYS, and the reasoning is worth writing down because the
// obvious argument says it can go.
//
// CAN-SPAM requires an address on COMMERCIAL mail and exempts transactional or
// relationship messages. The org-code mail is plainly exempt -- the recipient
// asked for it. The INVITE is arguable: it facilitates an account their employer
// is creating, which reads as transactional, but the recipient may have no prior
// relationship with TRAQS at all.
//
// Two things settle it. CAN-SPAM is US law, and Canada's CASL requires sender
// identification including a mailing address with narrower exemptions. And the
// cost of including it is one line of 11px grey text, where the cost of being
// wrong about the category is not.
//
// Rendered only when MAIL_POSTAL_ADDRESS is set. A fake address is worse than
// none, so there is no default.
export function shell({ title, preheader, eyebrow, heading, rows, esc }) {
  const postal = (process.env.MAIL_POSTAL_ADDRESS || "").trim();
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title>
<style>a{color:${LINK}}@media (max-width:620px){.wrap{width:100%!important}.pad{padding-left:24px!important;padding-right:24px!important}}</style>
</head>
<body style="margin:0;padding:0;background:${PAPER}">
<span style="display:none;font-size:1px;color:${PAPER};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER}"><tr><td align="center" style="padding:40px 12px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
${lockup()}
<tr><td class="pad" style="background:${CARD};border-radius:18px;padding:44px 48px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font-family:${FONT};font-size:11px;letter-spacing:2px;color:${MUTED};text-transform:uppercase;padding-bottom:14px">${esc(eyebrow)}</td></tr>
<tr><td style="font-family:${FONT};font-size:26px;font-weight:bold;color:${INK};mso-line-height-rule:exactly;line-height:32px;padding-bottom:14px">${heading}</td></tr>
${rows}
</table></td></tr>
<tr><td class="pad" style="padding:26px 48px 0;font-family:${FONT};font-size:11px;color:${MUTED};mso-line-height-rule:exactly;line-height:17px" align="center">
<strong style="color:${BODY}">TRAQS will never ask for your password, organization code, or personal information by email, phone, or text.</strong> If anyone requests this information claiming to be from TRAQS, do not respond.<br><br>
If you weren't expecting this email, you can safely ignore it.${postal ? `<br><br>${esc(postal)}` : ""}
</td></tr>
</table></td></tr></table>
</body></html>`;
}

/** The same anti-phishing block for the plain-text alternative. */
export const textFooter = () => {
  const postal = (process.env.MAIL_POSTAL_ADDRESS || "").trim();
  return [
    "TRAQS will never ask for your password, organization code, or personal",
    "information by email, phone, or text. If anyone requests this information",
    "claiming to be from TRAQS, do not respond.",
    "",
    "If you weren't expecting this email, you can safely ignore it.",
    postal ? "" : null,
    postal || null,
  ].filter((l) => l !== null).join(String.fromCharCode(10));
};
