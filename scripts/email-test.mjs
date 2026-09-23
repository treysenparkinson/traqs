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
ok("the mark is drawn, not an <img> that clients will block", !/<img/i.test(mail.html));

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
const withAddr = (() => {
  process.env.MAIL_POSTAL_ADDRESS = "TRAQS, 100 Real Street, Springfield, OH 45501";
  const m = inviteEmail({ orgName: "X", inviterName: "Y", acceptUrl: url, expiresAt: invite.expiresAt });
  delete process.env.MAIL_POSTAL_ADDRESS;
  return m;
})();
ok("a configured address is included", withAddr.html.includes("100 Real Street"));

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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
