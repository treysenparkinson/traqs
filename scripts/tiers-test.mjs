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
  BASIC_FEATURES, BUSINESS_FEATURES, TIER_LABEL, UPGRADE_CONTACT, upgradeMailto,
} from "../src/tiers.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};
const all = [...BASIC_FEATURES, ...BUSINESS_FEATURES].join(" | ").toLowerCase();

eq("Basic lists the four confirmed capabilities", BASIC_FEATURES, [
  "Time tracking & timesheets",
  "Mobile clock in/out",
  "Scheduling & job management",
  "Pay-period hours export",
]);
eq("Business adds only what Basic genuinely lacks", BUSINESS_FEATURES, [
  "Microsoft / SSO sign-in",
  "Granular admin permissions",
  "Priority support",
]);
eq("nothing is claimed by both tiers",
  BASIC_FEATURES.filter((f) => BUSINESS_FEATURES.includes(f)), []);

// ── what must never appear ───────────────────────────────────────────────
eq("no advanced-analytics claim: there is one analytics page and no split",
  /advanced analytics|analytics/.test(all), false);
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
eq("granular permissions are Business — nine keys exist behind the admin role",
  BUSINESS_FEATURES.some((f) => /granular admin permissions/i.test(f)), true);

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
