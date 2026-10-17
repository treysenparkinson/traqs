// Desktop alerts move from the rail to Settings → Account.
//
// Trey, 2026-10-17: "remove the enable alerts please once its enabled, if disabled, remove it
// and set it in the settings for me please". The rail's "Enable alerts" button was meant to hide
// once alerts were on, but it read the browser's permission only on load and after its own
// click, so a permission changed anywhere else left it showing. And on a browser that has
// BLOCKED alerts it was a dead button: requestPermission answers "denied" at once, with no
// prompt, so the click did nothing at all.
//
// Now the rail has no alerts button in any state. Settings → Account has a Desktop alerts row
// that says what this browser is doing (On / Off / Blocked / Not available), offers "Turn on
// alerts" only where a click can work, and says how to unblock where it can't. The page re-reads
// the permission when the person comes back to the tab, so a change made in the browser's own
// settings shows without a reload.
//
//   node scripts/alerts-setting-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. WHAT THE ROW SAYS, FROM WHAT THE BROWSER SAYS");
let alertsSetting = null;
try {
  ({ alertsSetting } = await import(new URL("../src/alertsSetting.js", import.meta.url).href));
} catch { /* missing module: every case below fails on its assertion */ }
const row = (supported, perm) => (typeof alertsSetting === "function" ? alertsSetting(supported, perm) : {});
{
  ok("granted reads On", row(true, "granted").status, "on");
  ok("...and offers no button (a click there would do nothing)", row(true, "granted").canEnable, false);
  ok("not asked yet reads Off", row(true, "default").status, "off");
  ok("...and is the one state with a Turn on button", row(true, "default").canEnable, true);
  ok("denied reads Blocked", row(true, "denied").status, "blocked");
  ok("...with no button: requestPermission answers denied without a prompt", row(true, "denied").canEnable, false);
  ok("...and says where to unblock it", /site settings/i.test(row(true, "denied").note || ""), true);
  ok("a browser with no Web Push reads Not available, whatever the permission", row(false, "granted").status, "unavailable");
  ok("...with no button", row(false, "default").canEnable, false);
  ok("every state has a chip label and a note", ["granted", "default", "denied"].every(p => row(true, p).chip && row(true, p).note) && !!row(false, "default").chip, true);
}

const A = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));

console.log("\n2. THE RAIL HAS NO ALERTS BUTTON");
{
  ok("no \"Enable alerts\" control anywhere in the app's code", A.includes("Enable alerts"), false);
  // The bell is the rail foot's first button now. Anchor on it, unique, and look at what sits
  // just before it in the same foot column.
  const bell = A.indexOf('aria-label="Notifications"');
  ok("the bell (anchor) appears once", bell > 0 && A.indexOf('aria-label="Notifications"', bell + 1) < 0, true);
  const foot = A.slice(Math.max(0, bell - 1500), bell);
  ok("nothing in the rail foot asks for push permission", /registerAndSubscribe|enableAlerts/.test(foot), false);
}

console.log("\n3. SETTINGS → ACCOUNT HAS THE ROW");
{
  const start = A.indexOf("const renderSettingsGeneral = ");
  const end = A.indexOf("const renderSettingsOrgGeneral = ", start);
  ok("renderSettingsGeneral (anchor) found once", start > 0 && end > start && A.indexOf("const renderSettingsGeneral = ", start + 1) < 0, true);
  const body = A.slice(start, end);
  ok("it asks alertsSetting about this browser", /alertsSetting\(canWebPush, pushPerm\)/.test(body), true);
  ok("it renders a Desktop alerts row", /sRow\("Desktop alerts"/.test(body), true);
  ok("its button only shows when a click can work", /\.canEnable && <button[^>]*onClick=\{enableAlerts\}/.test(body), true);
  const def = A.indexOf("const enableAlerts = ");
  const defBody = A.slice(def, A.indexOf("};", def));
  ok("enableAlerts asks, then re-reads the permission", def > 0 && /registerAndSubscribe\(getToken, orgCode\)[\s\S]*setPushPerm\(pushPermission\(\)\)/.test(defBody), true);
}

console.log("\n4. A PERMISSION CHANGED IN THE BROWSER SHOWS WITHOUT A RELOAD");
{
  const at = A.indexOf('addEventListener("focus", rereadPush)');
  ok("the page re-reads on focus", at > 0, true);
  const eff = A.slice(A.lastIndexOf("useEffect(", at), A.indexOf("}, [", at));
  ok("...and when the tab becomes visible again", /addEventListener\("visibilitychange", rereadPush\)/.test(eff), true);
  ok("...by setting pushPerm from the browser", /const rereadPush = \(\) => setPushPerm\(pushPermission\(\)\)/.test(eff), true);
  ok("...and removes both listeners", /removeEventListener\("focus", rereadPush\)/.test(eff) && /removeEventListener\("visibilitychange", rereadPush\)/.test(eff), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
