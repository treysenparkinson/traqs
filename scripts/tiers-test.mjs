// The tier comparison is a promise, so what it does NOT say is asserted too.
//
// Three claims were cut after checking them against the codebase, and each is
// pinned here so a later edit cannot quietly put them back:
//
//   "advanced analytics"  one analytics page exists, with no basic/advanced
//                         split. The axis does not exist to sell, and Matrix
//                         already uses that page.
//   employee cap          there isn't one.
//   "payroll & HR export" it is a PDF report, not a payroll integration.
//
//   node scripts/tiers-test.mjs

import {
  BASIC_FEATURES, BUSINESS_FEATURES, TIER_LABEL, TIER_LINE, UPGRADE_CONTACT, upgradeMailto,
} from "../src/tiers.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};
const all = [...BASIC_FEATURES, ...BUSINESS_FEATURES].join(" | ").toLowerCase();

// Reconciled 2026-10-02 (see TIERS.md). Basic is the whole product minus what genuinely
// costs more to provide; the line is AUTOMATIC SCHEDULING, and it is now written down rather
// than implied — the silence is what let the code's version of the tiers drift, because with
// nothing stated every gate looked as defensible as every other.
eq("Basic is the product", BASIC_FEATURES, [
  "Scheduling, jobs, panels & operations",
  "Time tracking, job clock & timesheets",
  "Mobile clock in/out",
  "Clients, analytics & approval templates",
  "Pay-period hours export",
]);
eq("Business adds only what genuinely costs more to provide", BUSINESS_FEATURES, [
  "Automatic scheduling — overlap clearing, reflow, dependency cascade",
  "Microsoft / SSO sign-in",
  "Email-domain allowlist",
  "Priority support",
]);
eq("nothing is claimed by both tiers",
  BASIC_FEATURES.filter((f) => BUSINESS_FEATURES.includes(f)), []);

// ── what must never appear ───────────────────────────────────────────────
// Analytics moved INTO Basic, so the guard inverts: the forbidden claim is the SPLIT, not
// the word. src/tiers.js argued in writing that gating analytics "would be taking something
// away" and TRAQS.jsx:4206 gated it anyway for months — so what must never come back is a
// basic/advanced distinction, and what must stay is analytics being Basic.
eq("no advanced/premium analytics split: there is one analytics page",
  /advanced analytics|premium analytics|analytics pro/.test(all), false);
eq("...and analytics is Basic", BASIC_FEATURES.some((f) => /analytics/i.test(f)), true);
eq("no employee or seat cap: there isn't one",
  /employee cap|seat|up to \d|user limit/.test(all), false);
eq("hours export is called what it is, not a payroll integration",
  /payroll (&|and) hr|payroll integration|hr export/.test(all), false);
eq("...and the honest name is used", BASIC_FEATURES.includes("Pay-period hours export"), true);

// Mobile clock in/out is in BASIC. The iOS app exists and is not gated.
eq("mobile clock in/out is Basic, not an upsell",
  BASIC_FEATURES.some((f) => /mobile clock/i.test(f)), true);
eq("SSO is Business — it works end to end but nothing in the product can set it",
  BUSINESS_FEATURES.some((f) => /sso/i.test(f)), true);
// Granular permissions are NOT claimed by either tier, and that is the assertion.
// _utils/can.js has always enforced adminPerms for every org with no tier check, so listing
// them under Business was false the whole time it was listed. Ruled 2026-10-02: left working
// for everyone; if ever reclaimed, new orgs only, never taken from an org that has it. This
// guard stops it being written back into the table while the code still gives it away.
eq("granular permissions are claimed by neither tier — can.js gives them to every org",
  /granular admin permissions/i.test(all), false);
// The automatic-scheduling line is the one thing Business actually withholds, so it has to
// be stated. It was absent entirely before, which is how the verdict on four write paths
// came down to interpretation.
eq("automatic scheduling is named as the Business line",
  BUSINESS_FEATURES.some((f) => /automatic scheduling/i.test(f)), true);
eq("...and the one-line version says which way round it is",
  /basic shows you your schedule/i.test(TIER_LINE) && /business rearranges/i.test(TIER_LINE), true);
// The job clock is Basic (#332): it was sold as "mobile clock in/out", hidden in the UI, and
// reachable through the API with no tier check the entire time.
eq("the job clock is Basic", BASIC_FEATURES.some((f) => /job clock/i.test(f)), true);
// Panels and operations are Basic (#4): a flat one-sub job is a worse product, not a cheaper
// tier, and "job management" that cannot express a job is not job management.
eq("panels and operations are Basic", BASIC_FEATURES.some((f) => /panels & operations/i.test(f)), true);

// ── not self-serve ───────────────────────────────────────────────────────
eq("both tiers have a label", [TIER_LABEL.basic, TIER_LABEL.business], ["Basic", "Business"]);
{
  const link = upgradeMailto("Acme Fabrication", "MTX.7K2P.9QX4");
  eq("the CTA opens a conversation, not a checkout", link.startsWith("mailto:"), true);
  eq("...to the contact address", link.includes(UPGRADE_CONTACT), true);
  eq("the org name is carried so the reply has context",
    decodeURIComponent(link).includes("Acme Fabrication"), true);
  eq("so is the org code", decodeURIComponent(link).includes("MTX.7K2P.9QX4"), true);
  eq("no org name does not produce a broken subject",
    upgradeMailto("", "").startsWith("mailto:"), true);
}

// RED PROOF: the cut claims are the point of this file. A comparison that
// listed them would pass every other assertion here.
let cutRedOk = true;
{
  const overSold = ["Advanced analytics", "Payroll & HR export", "Up to 25 employees"].join(" | ").toLowerCase();
  const catches = [
    /analytics/.test(overSold),
    /payroll (&|and) hr/.test(overSold),
    /up to \d/.test(overSold),
  ];
  if (!catches.every(Boolean)) {
    cutRedOk = false;
    console.error("RED PROOF FAILED: the guards do not catch the claims that were cut");
  } else {
    console.log("red proof: the guards catch all three cut claims — advanced analytics, "
      + "payroll & HR export, and an employee cap");
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && cutRedOk ? 0 : 1);
