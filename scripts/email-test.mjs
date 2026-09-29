// The invite email.
//
// Four of these checks exist because the design wireframe was out of date with
// the shipping app, and copying it across would have shipped each mistake:
//
//   - it drew the OLD mark (three grey bars, one sky) at the wrong proportions
//   - it linked to app.traqs.com, a host belonging to SOMEONE ELSE
//   - it promised a 7-day expiry against a 14-day TTL
//   - it carried "123 Example St" as the postal address
//
// The link one is the serious one. traqs.com is a live business on unrelated
// hosting and app.traqs.com resolves to their server, so shipping that template
// would have mailed every new employee a link to a stranger.
//
//   node scripts/email-test.mjs

import { inviteEmail, inviteAcceptUrl } from "../netlify/functions/_utils/email-invite.js";
import { INVITE_TTL_MS, makeInvite } from "../netlify/functions/_utils/invite.js";

let pass = 0, fail = 0;
const ok = (msg, cond) => {
  if (cond) { pass++; console.log("ok    " + msg); }
  else { fail++; console.error("FAIL  " + msg); }
};

const invite = makeInvite({ email: "sam@acmefab.com", role: "employee", invitedBy: "dana@acmefab.com" });
const BASE = "https://traqs.example.com";
const url = inviteAcceptUrl(BASE, "ACME.7K4M.9XQP", invite.token);
const mail = inviteEmail({
  orgName: "Acme Fabrication", inviterName: "Dana Reyes",
  acceptUrl: url, expiresAt: invite.expiresAt,
});

// ── the link ─────────────────────────────────────────────────────────────────
// The app reads ?org= and ?invite= off the root. Anything else is a dead link.
ok("the accept link carries the org code", url.includes("org=ACME.7K4M.9XQP"));
ok("...and the token, under the name the app reads", url.includes("invite=" + invite.token));
ok("...at the root of the site, not a path the app has no route for",
  url.startsWith(BASE + "/?"));
// NOT ANYONE ELSE'S DOMAIN. Nothing may hardcode a host: the base URL is passed
// in, so a template that bakes one in would ignore it.
ok("no hardcoded host anywhere in the mail",
  !/traqs\.com|traqs\.app|app\.traqs/.test(mail.html + mail.text));
// The HTML carries it escaped -- an & inside an attribute must be &amp; or the
// markup is invalid and some clients truncate the href at the ampersand. So the
// check is that it round-trips, not that the raw string appears.
const unesc = (h) => h.replace(/&amp;/g, "&");
ok("the link appears in the HTML, ampersand-escaped as it must be",
  mail.html.includes(url.replace(/&/g, "&amp;")) && unesc(mail.html).includes(url));
ok("...and the raw, unescaped ampersand is NOT in the href",
  !mail.html.includes(`href="${url}"`));
ok("...and in the plain-text part, which is where it is the only way through",
  mail.text.includes(url));

// ── the mark ─────────────────────────────────────────────────────────────────
// Same four colours as src/App.jsx BRAND_BARS. The function cannot import from
// the React bundle, so the lists are separate and this is what keeps them equal.
const BRAND = ["#FF6B57", "#F0A819", "#38BDF8", "#1D7D5C"];
for (const c of BRAND) ok(`the mark uses ${c}`, mail.html.toUpperCase().includes(c));
ok("and no grey bar survives from the old mark", !/#8a8a86/i.test(mail.html));
// Remote images are blocked by default in most clients, so the logo has to be
// drawn with table cells or it is a grey box on first open.
// THE BARS ARE DRAWN. The WORDMARK is an image, deliberately -- it is Space
// Grotesk and no client loads a webfont -- so "no <img> anywhere" is not the
// invariant and never was. What matters is that a blocked image still leaves the
// brand on screen: four correct colours in table cells, plus alt text.
//
// This assertion used to read !/<img/ against whatever the ambient environment
// produced, which passed locally and FAILED on Netlify -- Netlify sets URL, the
// lockup then emits the real wordmark, and the test caught its own feature. The
// environment is now set explicitly per case instead of inherited.
const renderWith = (base) => {
  const had = process.env.MAIL_ASSET_BASE, hadUrl = process.env.URL;
  if (base) { process.env.MAIL_ASSET_BASE = base; } else { delete process.env.MAIL_ASSET_BASE; delete process.env.URL; }
  const m = inviteEmail({ orgName: "Acme", inviterName: "Dana", acceptUrl: url, expiresAt: invite.expiresAt });
  if (had === undefined) delete process.env.MAIL_ASSET_BASE; else process.env.MAIL_ASSET_BASE = had;
  if (hadUrl === undefined) delete process.env.URL; else process.env.URL = hadUrl;
  return m.html;
};
const withImg = renderWith("https://example.test");
const noImg = renderWith(null);

ok("with an asset base, the wordmark is a real image", /<img[^>]+traqs-wordmark.png/i.test(withImg));
ok("...and it is the ONLY image in the mail", (withImg.match(/<img/gi) || []).length === 1);
ok("...carrying alt text, so a blocked image still says traqs", /<img[^>]+alt="traqs"/i.test(withImg));
ok("without one, it falls back to type rather than a broken src", !/<img/i.test(noImg));

// The bars are never an image, in either case. This is the real protection: a
// client that blocks the wordmark still shows four correct brand colours.
for (const [label, html] of [["with the image", withImg], ["without it", noImg]]) {
  const bars = (html.match(/background:#[0-9A-F]{6}/gi) || []).map((m) => m.split(":")[1].toUpperCase());
  ok(`the four bars are drawn cells, ${label}`, BRAND.every((c) => bars.includes(c)));
}

// ── the expiry ───────────────────────────────────────────────────────────────
const days = Math.round(INVITE_TTL_MS / 86400000);
ok(`the expiry copy matches INVITE_TTL_MS (${days} days)`,
  mail.html.includes(`expires in ${days} days`) && mail.text.includes(`expires in ${days} days`));
ok("it is not the wireframe's 7", !mail.html.includes("expires in 7 days"));
// Generated from the invite's own expiresAt, so shortening the TTL cannot leave
// the copy lying.
const short = inviteEmail({ orgName: "X", inviterName: "Y", acceptUrl: url,
  expiresAt: new Date(Date.now() + 3 * 86400000).toISOString() });
ok("a different expiry produces different copy", short.html.includes("expires in 3 days"));

// ── the postal address ───────────────────────────────────────────────────────
// CAN-SPAM wants a real one. Absent is honest; a placeholder is not.
ok("no placeholder address is shipped", !/123 Example St|Example St|City, ST/.test(mail.html));
// The postal address is rendered when configured, and omitted when not -- a
// fake one is worse than none. CAN-SPAM exempts transactional mail, but the
// invite's category is arguable and CASL is stricter, so the line stays.
const withAddr = (() => {
  process.env.MAIL_POSTAL_ADDRESS = "TRAQS, 100 Real Street, Springfield, OH 45501";
  const m = inviteEmail({ orgName: "X", inviterName: "Y", acceptUrl: url, expiresAt: invite.expiresAt });
  delete process.env.MAIL_POSTAL_ADDRESS;
  return m;
})();
ok("a configured address IS included", withAddr.html.includes("100 Real Street"));
ok("...and in the plain text too", withAddr.text.includes("100 Real Street"));

// ── escaping ─────────────────────────────────────────────────────────────────
// Org and inviter names are user input, and they land in HTML.
const nasty = inviteEmail({
  orgName: `<script>alert(1)</script>`, inviterName: `Bob" onload="x`,
  acceptUrl: url, expiresAt: invite.expiresAt,
});
ok("an org name cannot inject a tag", !nasty.html.includes("<script>alert(1)</script>"));
ok("...it is escaped instead", nasty.html.includes("&lt;script&gt;"));
ok("an inviter name cannot break out of an attribute", !nasty.html.includes(`onload="x`));

// ── both parts, always ───────────────────────────────────────────────────────
// A text/plain alternative is what keeps a well-formed HTML mail out of spam.
ok("there is a plain-text part", mail.text.length > 200);
ok("there is an HTML part", mail.html.startsWith("<!DOCTYPE html>"));
ok("the subject names the organization", mail.subject.includes("Acme Fabrication"));
// Outlook renders with Word's engine: no flex, no grid, no external stylesheet.
ok("the layout is tables, which is what Outlook can render", mail.html.includes("role=\"presentation\""));
ok("no flexbox or grid, which Outlook silently drops",
  !/display:\s*(flex|grid)/.test(mail.html));

// ── graceful with missing pieces ─────────────────────────────────────────────
const bare = inviteEmail({ acceptUrl: url, expiresAt: invite.expiresAt });
ok("a missing org name does not print 'undefined'", !/undefined/.test(bare.html + bare.text));
ok("a missing inviter does not either", bare.html.includes("An administrator"));

// ── the logo asset ───────────────────────────────────────────────────────────
// The lockup uses the REAL wordmark, which means an image, which means a file
// that has to exist and be deployed. A missing one shows a broken icon where the
// logo should be, and nothing else in the pipeline would notice.
import { existsSync, readFileSync as rf } from "node:fs";
const ASSET = new URL("../public/email/traqs-wordmark.png", import.meta.url);
ok("the wordmark asset exists", existsSync(ASSET));
if (existsSync(ASSET)) {
  const head = rf(ASSET).subarray(0, 8);
  ok("...and it is a real PNG", head[0] === 0x89 && head.subarray(1, 4).toString() === "PNG");
  ok("...and is small enough to mail", rf(ASSET).length < 60000);
}
// It is served from public/, so the published path must match what the HTML asks
// for. A rename on one side only is the obvious way to break this.
const LAYOUT = rf(new URL("../netlify/functions/_utils/email-layout.js", import.meta.url), "utf8");
ok("the HTML points at the path the file actually sits on",
  LAYOUT.includes("/email/traqs-wordmark.png"));
// Rendered output is asserted above; this only checks the source has not grown a
// second image source that the render-time checks would miss.
//
// Comments are stripped first. The file explains in prose why the bars are NOT
// an <img>, and counting that sentence as code is the same mistake as reading a
// comment for a call site.
const NL = String.fromCharCode(10);
const LAYOUT_CODE = LAYOUT
  .split(NL)
  .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
  .join(NL);
ok("only the wordmark is ever an image", (LAYOUT_CODE.match(/<img/g) || []).length === 1);

// ── the iPhone app ───────────────────────────────────────────────────────────
// Accept is a universal link: with the app installed it opens the app. The
// download line depends on a store listing and must vanish without one -- a
// "get the app" line with nowhere to go is worse than none.
{
  const STORE = "https://apps.apple.com/app/id1234567890";
  const withStore = inviteEmail({ orgName: "Acme Fabrication", inviterName: "Dana Reyes",
    acceptUrl: url, expiresAt: invite.expiresAt, inviteeName: "Sam Rivera", appStoreUrl: STORE });
  ok("the mail says Accept opens the app on an iPhone", /opens the TRAQS app/.test(withStore.html + withStore.text));
  ok("with a store link, the HTML offers the download", withStore.html.includes(`href="${STORE}"`));
  ok("...and so does the plain text", withStore.text.includes(STORE));
  ok("without one, no download line at all", !/Download TRAQS/.test(mail.html + mail.text));
  ok("the invitee is greeted by first name", withStore.html.includes("Hi Sam,") && withStore.text.startsWith("Hi Sam,"));
  ok("...and not by full name", !withStore.html.includes("Hi Sam Rivera"));
  ok("no name, no greeting", !/Hi [A-Z]/.test(mail.text));
  const nasty = inviteEmail({ orgName: "Acme", acceptUrl: url, expiresAt: invite.expiresAt, inviteeName: "<b>x</b>" });
  ok("the name is escaped, it is admin-typed free text", !nasty.html.includes("<b>x</b>"));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
