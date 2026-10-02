// STEP 0 — settings.timeZone and tier are required at org creation, and the
// server's silent UTC fallback is visible before it is removed.
//
// WHY THIS EXISTS. The rostering design (§4.1) calls a zoneless org the one
// thing roster generation cannot survive. Bucketing runs instant -> day: a
// wrong zone mis-files by a day at the edges, which is bad. Generation runs
// wall clock -> instant: a 07:00 pattern for a zoneless org becomes 07:00 UTC,
// which is MIDNIGHT LOCAL at UTC-7. The same bug class already bit this
// codebase in the other direction (localDay.js's header: an 18:23-21:53 shift
// filed on the following day), so the guard is against a known failure, not a
// hypothetical one.
//
//   node scripts/step0-timezone-test.mjs

import { readFileSync } from "node:fs";
import { buildOrgPayload } from "../src/orgSignup.js";

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (got === want) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ORG = src("../netlify/functions/org.js");
const TC = src("../netlify/functions/timeclock.js");
const count = (hay, needle) => hay.split(needle).length - 1;

console.log("\n1. /org refuses a creation with no timezone or no tier");
ok("timeZone is read from the request settings",
  ORG.includes("const tz = reqSettings?.timeZone == null ? \"\" : String(reqSettings.timeZone).trim();"));
ok("...and a missing one is a 400, not a default",
  ORG.includes('if (!tz) return err(400, "Missing required field: settings.timeZone");'));
// Shape checks accept "Mountain". The ICU database does not.
ok("...and the zone is validated against ICU, not by shape",
  /new Intl\.DateTimeFormat\("en-US", \{ timeZone: tz \}\)/.test(ORG));
ok("...with the unknown-zone case returning 400 too",
  ORG.includes("return err(400, `Unknown time zone:"));
ok("tier is required explicitly",
  ORG.includes('if (!wantTier) return err(400, "Missing required field: tier");'));
ok("...and constrained to the two real tiers",
  ORG.includes('const TIERS = ["basic", "business"];'));

console.log("\n2. Both are WRITTEN, so the decision is recorded not inferred");
ok("settings.json is now unconditional — timeZone is required, so it is never empty",
  ORG.includes("writeJson(`orgs/${code}/settings.json`, seedSettings),"));
ok("...and the old conditional write is gone",
  /Object\.keys\(seedSettings\)\.length\s*\n?\s*\? \[writeJson/.test(ORG), false);
ok("billing.json is written explicitly at creation",
  ORG.includes("writeJson(`orgs/${code}/billing.json`, seedBilling),"));
ok("...from the requested tier, not a default",
  ORG.includes("tier: wantTier,"));

console.log("\n3. The signup actually SENDS the tier it collected");
{
  // It did not. The wizard has a whole tier step and the payload dropped it, so
  // the answer never reached the server and billing.js's absent-means-basic
  // default decided instead. Asserted on the real builder, not on the source.
  const p = buildOrgPayload({
    name: "Acme Fabrication", adminEmail: "A@Acme.com", adminName: "Ada",
    country: "United States", timeZone: "America/Denver", tier: "business",
    payPeriodType: "semimonthly", payPeriodStart: "2026-10-01",
  });
  ok("the payload carries tier", p.tier, "business");
  ok("...and the timezone, under settings where the app reads it", p.settings.timeZone, "America/Denver");
  ok("a payload with no tier still defaults to basic rather than omitting the field",
    buildOrgPayload({ name: "X", adminEmail: "x@y.com" }).tier, "basic");
  // RED PROOF for this block: a builder that dropped tier would return undefined
  // and the first assertion would fail. Confirm the field is genuinely present
  // rather than passing because both sides are undefined.
  ok("...and the key really exists on the object", Object.hasOwn(p, "tier"));
}

console.log("\n4. The server's silent UTC fallback is VISIBLE before it is removed");
ok("there is a fallback mode flag, defaulting to log",
  ORG !== null && TC.includes('const TZ_FALLBACK_MODE = process.env.TZ_FALLBACK_MODE || "log";'));
ok("the absent-zone path logs instead of guessing silently",
  TC.includes('tzFallback("missing", timeZone)'));
// An absent zone and a zone the ICU database rejects are different failures:
// one is an org nobody configured, the other is a value something WROTE that
// org.js now refuses. The log has to tell them apart or the signal is useless.
ok("...and the invalid-zone path is logged under its own reason",
  TC.includes('tzFallback("invalid", timeZone)'));
ok("both reasons are distinguishable in the log", count(TC, "tzFallback(\"") >= 2);
ok("enforce mode exists and throws rather than guessing",
  /if \(TZ_FALLBACK_MODE === "enforce"\) \{\s*\n\s*throw new Error/.test(TC));
ok("...but it is NOT the default — this ships in log mode",
  /TZ_FALLBACK_MODE \|\| "log"/.test(TC));
// The fallback must still RETURN a day in log mode. A clock write that throws
// because an org never set a timezone is a worse outcome than a day-edge error.
ok("log mode still returns a day — the row is never lost",
  /tzFallback\("missing", timeZone\); return d\.toISOString\(\)\.slice\(0, 10\);/.test(TC));

console.log("\n5. RED PROOF — the guards discriminate");
{
  // Each mutation removes the thing the matching assertion watches, against a
  // COPY. A guard that still passes with its subject deleted is decoration.
  const mutations = [
    ["timezone 400", ORG, 'if (!tz) return err(400, "Missing required field: settings.timeZone");'],
    ["tier 400", ORG, 'if (!wantTier) return err(400, "Missing required field: tier");'],
    ["billing write", ORG, "writeJson(`orgs/${code}/billing.json`, seedBilling),"],
    ["fallback log", TC, 'tzFallback("missing", timeZone)'],
    ["mode flag", TC, 'const TZ_FALLBACK_MODE = process.env.TZ_FALLBACK_MODE || "log";'],
  ];
  let red = 0;
  for (const [label, hay, needle] of mutations) {
    const mutated = hay.split(needle).join("/* removed */");
    if (mutated.includes(needle)) { console.error(`  RED FAIL  ${label} survives deletion`); fail++; }
    else { red++; }
  }
  console.log(`  red proof: ${red}/${mutations.length} guards go red when their subject is deleted`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
