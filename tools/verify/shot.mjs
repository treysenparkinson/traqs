// Screenshot harness for the Verifier agent.
//
// Drives the LOCALLY INSTALLED Chrome (playwright-core + channel:"chrome"), so
// nothing downloads a 150MB browser. Uses a PERSISTENT profile directory, which
// is the whole trick: TRAQS sits behind Auth0 universal login, and a throwaway
// context would land on the login screen every run. Treysen logs in once in this
// profile (npm run verify:login) and every later run reuses that session.
//
// Usage:
//   node tools/verify/shot.mjs --url http://localhost:8890 --out shots/x.png
//   node tools/verify/shot.mjs --url ... --out ... --theme dark --w 1440 --h 900
//   node tools/verify/shot.mjs --login          # headed, for the one-time login
//
// Exit codes: 0 ok, 2 blocked on login, 3 page error.

import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1]?.startsWith("--") ? true : argv[i + 1]);
};
const has = (name) => argv.includes(`--${name}`);

const PROFILE = resolve(process.env.TRAQS_VERIFY_PROFILE || "C:/Users/treysen/.traqs-verify-profile");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const url = arg("url", "http://localhost:8890");
const out = arg("out", "shots/shot.png");
const theme = arg("theme", "light");          // light | dark
const width = Number(arg("w", 1440));
const height = Number(arg("h", 900));
const waitMs = Number(arg("wait", 2500));
const loginMode = has("login");
const full = has("full");

if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Install it or edit CHROME in this file.`);
  process.exit(3);
}

const ctx = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  channel: "chrome",
  headless: !loginMode,
  viewport: { width, height },
  colorScheme: theme === "dark" ? "dark" : "light",
  args: ["--disable-blink-features=AutomationControlled"],
});

const page = ctx.pages()[0] || (await ctx.newPage());

// Surface page-side failures instead of silently screenshotting a white box —
// the exact failure mode that wasted a round on this feature before (a stale
// build rendered blank and the screenshot looked merely "wrong").
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
} catch (e) {
  console.error(`navigation failed: ${e.message}`);
  await ctx.close();
  process.exit(3);
}

if (loginMode) {
  console.log(`Headed Chrome open on ${url} using profile ${PROFILE}.`);
  console.log("Log in (org code -> Microsoft), land on the app, then close the window.");
  await page.waitForEvent("close", { timeout: 0 }).catch(() => {});
  await ctx.close();
  process.exit(0);
}

await page.waitForTimeout(waitMs);

// Are we actually inside the app, or parked on the login gate? Screenshotting
// the gate and calling it a verified view is the one failure this must not have.
const onLoginGate = await page.evaluate(() => {
  const t = document.body?.innerText || "";
  return /organization code|Sign in|Continue with|Log in to/i.test(t) && !document.querySelector("[data-tq-app]");
});

const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });
await page.screenshot({ path: outPath, fullPage: full });

const report = {
  url, out: outPath, theme, viewport: `${width}x${height}`,
  onLoginGate,
  consoleErrors: consoleErrors.slice(0, 20),
  title: await page.title(),
};
console.log(JSON.stringify(report, null, 2));

await ctx.close();
process.exit(onLoginGate ? 2 : 0);
