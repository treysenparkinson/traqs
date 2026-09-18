// DOM probe for the "DONE badge glued to the label" bug.
//
// The handoff doc is explicit that this element must be inspected in the DOM
// before anyone changes the source: the source says marginRight:6 exists at
// both render sites, and the reported render disagrees. Only the DOM settles
// which is lying. This measures the REAL gap rather than reasoning about it.
//
// Usage: node tools/verify/probe-done-badge.mjs --url http://localhost:8888
// Exit: 0 probed ok, 2 blocked on login, 3 page/nav error, 4 no DONE badge found.

import { chromium } from "playwright-core";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const PROFILE = resolve(process.env.TRAQS_VERIFY_PROFILE || "C:/Users/treysen/.traqs-verify-profile");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = arg("url", "http://localhost:8888");
const waitMs = Number(arg("wait", 4000));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME, channel: "chrome", headless: true,
  viewport: { width: Number(arg("w", 1600)), height: Number(arg("h", 950)) },
  colorScheme: arg("theme", "light") === "dark" ? "dark" : "light",
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = ctx.pages()[0] || (await ctx.newPage());
const errs = [];
page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", e => errs.push(`pageerror: ${e.message}`));

try { await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }); }
catch (e) { console.error(`navigation failed: ${e.message}`); await ctx.close(); process.exit(3); }
await page.waitForTimeout(waitMs);

const onLoginGate = await page.evaluate(() => {
  const t = document.body?.innerText || "";
  return /organization code|Sign in|Continue with|Log in to/i.test(t) && !document.querySelector("[data-tq-app]");
});
if (onLoginGate) {
  console.error("BLOCKED: parked on the Auth0/org-code gate. Run: node tools/verify/shot.mjs --login");
  await ctx.close(); process.exit(2);
}

const findings = await page.evaluate(() => {
  // The badge is the only element whose entire trimmed text is exactly "DONE"
  // and which is a <span>. Status chips elsewhere say DONE too, so record the
  // parent chain to tell the bar badge from a plan chip.
  const all = [...document.querySelectorAll("span")]
    .filter(s => (s.textContent || "").trim() === "DONE" && s.children.length === 0);
  return all.map(s => {
    const cs = getComputedStyle(s);
    const p = s.parentElement;
    const pcs = p ? getComputedStyle(p) : null;
    const sib = s.nextElementSibling;
    const sibcs = sib ? getComputedStyle(sib) : null;
    const r = s.getBoundingClientRect();
    const sr = sib ? sib.getBoundingClientRect() : null;
    return {
      badge: {
        marginRight: cs.marginRight, marginLeft: cs.marginLeft,
        display: cs.display, flexShrink: cs.flexShrink, fontSize: cs.fontSize,
        rect: { left: +r.left.toFixed(2), right: +r.right.toFixed(2), width: +r.width.toFixed(2) },
      },
      parent: pcs && {
        display: pcs.display, gap: pcs.columnGap, padding: pcs.padding,
        overflow: pcs.overflow, width: +p.getBoundingClientRect().width.toFixed(2),
      },
      nextSibling: sib ? {
        tag: sib.tagName.toLowerCase(),
        text: (sib.textContent || "").trim().slice(0, 40),
        paddingLeft: sibcs.paddingLeft, marginLeft: sibcs.marginLeft, flex: sibcs.flex,
        rect: { left: +sr.left.toFixed(2), width: +sr.width.toFixed(2) },
      } : null,
      // THE measurement: visual px between badge's right edge and the next
      // element's LEFT edge (its border box). Text inset by paddingLeft is
      // reported separately so a padded-but-touching case is distinguishable.
      visualGapPx: sr ? +(sr.left - r.right).toFixed(2) : null,
      gapIncludingSiblingPadding: sr && sibcs
        ? +((sr.left - r.right) + parseFloat(sibcs.paddingLeft || "0")).toFixed(2) : null,
    };
  });
});

console.log(JSON.stringify({
  url, badgesFound: findings.length, consoleErrors: errs.slice(0, 10), findings,
}, null, 2));
await ctx.close();
process.exit(findings.length ? 0 : 4);
