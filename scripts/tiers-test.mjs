// The tier comparison is a promise, so what it does NOT say is asserted too.
//
// ── 2026-10-02 ─────────────────────────────────────────────────────────────
//
// This file used to guard four Basic rows and three Business ones and had no
// idea the product contained eleven tier gates. That is how a table and a
// codebase drift apart while every assertion stays green: the suite could only
// check claims that were written down, and the claim that mattered — where the
// JOB LAYER begins — was not one of them. A reader walked the code, found
// eleven gates no table accounted for, and concluded the code had drifted. It
// had not. The promise was incomplete.
//
// So there are four kinds of assertion here now:
//
//   1. the table says what it should, from Trey's definition;
//   2. BASIC CLAIMS NO JOB-LAYER CONCEPT, in any wording;
//   3. BASIC IS NOT A SUBSET — the comparison must not say "everything in
//      Basic, plus", because Business does not have the Employees page;
//   4. every gate the code DOES have is pinned, and every row it does NOT yet
//      enforce is pinned too, as an explicit list.
//
// (4) is deliberately two-sided. The sold definition is ahead of the code —
// see TIERS.md and #125 — and the right way to hold that is a visible, tested
// list of what is unenforced, not silence. If you enforce one, this test will
// tell you to move it. Silence is what caused all of this.
//
//   node scripts/tiers-test.mjs

import { readFileSync } from "node:fs";
import {
  BASIC_FEATURES, BUSINESS_FEATURES, BASIC_ONLY, businessColumn,
  TIER_LABEL, UPGRADE_CONTACT, upgradeMailto,
} from "../src/tiers.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};
const basicText = BASIC_FEATURES.join(" | ").toLowerCase();
const all = [...BASIC_FEATURES, ...BUSINESS_FEATURES].join(" | ").toLowerCase();

// ── 1. the table ─────────────────────────────────────────────────────────
// Basic is shift scheduling and a pay clock. That is the whole product.
eq("Basic is the roster and a pay clock", BASIC_FEATURES, [
  "Shift roster — recurring weekly patterns per person",
  "Day and week roster views",
  "Shift calendar — month grid, org-wide or per person",
  "Time clock & time stamps, for pay only",
  "Mobile clock in/out — from the phone, on site",
  "Time off — PTO and UTO, request through approval",
  "Analytics — hours logged, pay hours, export hours",
  "Employees — one person's full picture",
  "Pay-period hours export from pay punches",
  "Dashboard, messages and admin board",
]);
// RULED 2026-10-02 (second pass), from the rostering design. The roster is
// RECURRING BY DEFAULT: a weekly template per person is the primitive and
// one-offs are dated exceptions. A flat list of shift rows with a pattern added
// later is the model that was overturned.
eq("the roster is recurring by default, not a list of rows",
  BASIC_FEATURES.some((f) => /recurring weekly patterns/i.test(f)), true);
// Analytics is BASIC, cut to three elements (decision 14) — not adapted. There
// is no Employees/Analytics slot swap; Basic has both pages.
eq("analytics is Basic", BASIC_FEATURES.some((f) => /^analytics/i.test(f)), true);
eq("...and names the three elements it is cut to",
  BASIC_FEATURES.some((f) => /hours logged/i.test(f) && /pay hours/i.test(f) && /export hours/i.test(f)), true);
eq("...with no efficiency or utilization claim in Basic — efficiencyPct renders 0% with no jobs",
  /efficien|utilizat|production hours/i.test(basicText), false);
eq("Basic keeps the Employees page too — there is no slot swap",
  BASIC_FEATURES.some((f) => /^employees/i.test(f)), true);
// RULED 2026-10-02, and pinned because the table's SILENCE on this is what the
// last round nearly repeated. Basic includes a phone clock: a shift worker
// clocks in on site, not at a desk. Three Time Clock Settings sections already
// say "Mobile Clock-In" (TRAQS.jsx:19245, :20957, :27096) with no tier check,
// so the product had already made this promise before the table did.
eq("Basic names the device: mobile clock in/out is Basic",
  BASIC_FEATURES.some((f) => /mobile clock in\/out/i.test(f)), true);
eq("...and says where, so 'for pay only' cannot be read as desk-only",
  BASIC_FEATURES.some((f) => /mobile clock/i.test(f) && /phone/i.test(f)), true);
eq("the phone clock is NOT sold as a Business upgrade",
  BUSINESS_FEATURES.some((f) => /mobile clock|phone/i.test(f)), false);
// CREW: no assertion, because the two sources disagree and it is not settled.
// Ruled 2026-10-02 (first pass): "a morning crew is one shift with four names,
// not four shifts." The rostering design's decision 7 is PERSON-OWNED TEMPLATES
// ONLY (role-owned deferred), so under it a crew is four people carrying the
// same pattern — and §6.1 offers copy-from-another-person as precisely the
// affordance that "makes person-owned templates tolerable". The design
// anticipated the need and answered it with copying rather than with
// multi-person shifts. Flagged in BASIC_RECONCILIATION.md; no row either way
// until it is ruled, because asserting one would freeze an open question.
// Basic keeps Time Stamp — it is the pay clock, which is half of what Basic is.
eq("time stamps are Basic",
  BASIC_FEATURES.some((f) => /time stamps/i.test(f)), true);
// Business is that plus the job layer.
eq("Business adds the job layer", BUSINESS_FEATURES, [
  "Jobs, panels & operations",
  "PO and job numbers",
  "Job clock — time logged against work",
  "Gantt timelines — month view in place of the shift calendar",
  "Clients",
  "Approval templates",
  "Job analytics — efficiency & utilization",
  "Departments & row grouping",
  "Automatic scheduling — overlap clearing, reflow, dependency cascade, conflict blocking",
  "Microsoft / SSO sign-in",
  "Email-domain allowlist",
  "Priority support",
]);
eq("nothing is claimed by both tiers",
  BASIC_FEATURES.filter((f) => BUSINESS_FEATURES.includes(f)), []);

// ── 2. Basic has NO job layer, in any form ───────────────────────────────
// The single most important guard in this file. A previous version listed
// "Flat jobs — one task, one team, one time" under Basic. A shift is not a
// small job, and "flat jobs" is exactly the almost-right row that lets the job
// layer back in one word at a time. Basic draws SHIFTS.
for (const [concept, re] of [
  ["jobs", /\bjobs?\b/],
  ["panels", /\bpanels?\b/],
  ["operations", /\boperations?\b|\bops?\b/],
  ["PO / job numbers", /\bpo number|\bjob number/],
  ["the job clock", /job clock/],
  ["time against work", /against work|logged against|worked hours/],
  ["departments", /\bdepartments?\b|row grouping/],
  // Job-TIME rendering. Hatching is worked-vs-estimated, the overdue tray is
  // work past its date, the cursor is progress through an estimate. With no
  // time logged against work there is nothing for any of them to draw.
  ["hatching", /hatch/],
  ["the overdue tray", /overdue/],
  ["the progress cursor", /\bcursor\b/],
]) {
  eq(`Basic claims no ${concept}`, re.test(basicText), false);
}
// ...and says positively what it DOES draw, so the rows above cannot all be
// satisfied by an empty list.
eq("Basic's schedule row is the roster, per person",
  BASIC_FEATURES.some((f) => /shift roster/i.test(f) && /per person/i.test(f)), true);
eq("Basic's clock row says it is for pay only",
  BASIC_FEATURES.some((f) => /time clock/i.test(f) && /pay only/i.test(f)), true);
eq("Basic's export row says it comes from pay punches",
  BASIC_FEATURES.some((f) => /export/i.test(f) && /pay punch/i.test(f)), true);
// The job layer is named as the Business line rather than left to inference.
eq("Business names jobs, panels and operations",
  BUSINESS_FEATURES.some((f) => /jobs, panels & operations/i.test(f)), true);
eq("...and the job clock, as time logged against work",
  BUSINESS_FEATURES.some((f) => /job clock/i.test(f) && /against work/i.test(f)), true);

// ── 3. Basic is NOT a subset of Business ─────────────────────────────────
// Business puts Analytics in the slot Basic uses for Employees, so Business
// genuinely lacks a page Basic has. Any comparison that renders the Business
// column as [...BASIC, ...BUSINESS] prints a false claim.
eq("there is at least one Basic-only row", BASIC_ONLY.length > 0, true);
// It is the SHIFT CALENDAR, not the Employees page — the earlier table had the
// wrong row. Decision 20: the calendar is Basic-only and takes the toggle slot
// Business gives to the month timeline, so the tiers swap rather than nest.
eq("...and it is the shift calendar",
  BASIC_ONLY.every((f) => /shift calendar/i.test(f)), true);
eq("...which Business replaces with the month timeline, so the swap is visible in its row",
  BUSINESS_FEATURES.some((f) => /in place of the shift calendar/i.test(f)), true);
eq("every Basic-only row is really a Basic row",
  BASIC_ONLY.filter((f) => !BASIC_FEATURES.includes(f)), []);
eq("the Business column SUBTRACTS it rather than inheriting the whole list",
  businessColumn().some((f) => BASIC_ONLY.includes(f)), false);
eq("...while still carrying the rest of Basic",
  BASIC_FEATURES.filter((f) => !BASIC_ONLY.includes(f)).every((f) => businessColumn().includes(f)), true);
eq("...and all of Business",
  BUSINESS_FEATURES.every((f) => businessColumn().includes(f)), true);
// There is NO Employees/Analytics slot swap — the earlier table invented one.
// Basic has both pages; the Employees page has its job-fed panels omitted and
// its schedule panels re-sourced from the roster (design §11.3).
eq("Business does not claim the Employees page as its own",
  BUSINESS_FEATURES.some((f) => /employees slot/i.test(f)), false);

// ── what must never appear ───────────────────────────────────────────────
eq("no advanced/premium analytics split: there is one analytics page",
  /advanced analytics|premium analytics|analytics pro/.test(all), false);
eq("no employee or seat cap: there isn't one",
  /employee cap|seat|up to \d|user limit/.test(all), false);
eq("hours export is called what it is, not a payroll integration",
  /payroll (&|and) hr|payroll integration|hr export/.test(all), false);
// THE row that caused all of it: "Scheduling & job management" sold Basic a job
// layer it was never meant to have.
eq("Basic does not claim job management",
  /job management/i.test(basicText), false);
// #333. Claimed by neither tier: can.js gives adminPerms to every org with no
// tier check, so listing it under Business was false the whole time it was
// printed. Off the table until it is gated or deliberately given away.
eq("granular permissions are claimed by neither tier",
  /granular admin permissions/i.test(all), false);

// ── 4. what the code enforces, and what it does not ──────────────────────
const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const O = readFileSync(new URL("../netlify/functions/org.js", import.meta.url), "utf8");

// Gates that EXIST. `count` is exact, because a bare substring search passes
// even when the one occurrence that matters is gone (the `can("editJobs")`
// lesson — that string appears six times in TRAQS.jsx).
const GATES = [
  ["Jobs, panels & operations", J, `["tasks", "analytics", "clients"].includes(v)`, 1],
  ["Jobs, panels & operations", J, `!["tasks", "analytics", "clients"].includes(v.id)`, 1],
  ["Jobs, panels & operations", J, `t.id !== "tasks"`, 1],
  ["Jobs, panels & operations", J, `startHour: workStartH, endHour: Math.min(workEndH, workStartH + 8)`, 1],
  // This gate hides Clients AND Analytics from Basic. Analytics is now a BASIC
  // row (decision 14), so the gate is wrong for half of what it does — but it
  // is correct by accident until the page is decomposed, because the page as it
  // stands is job-fed and its efficiency card would render 0%. Labelled under
  // Clients, with the analytics half tracked in NOT_ENFORCED below.
  ["Clients", J, `!["clients", "analytics"].includes(item.id)`, 1],
  ["Clients", J, `billingTier !== "business" ? [] : clients.filter`, 1],
  ["Approval templates", J, `c.key !== "org-approval-templates"`, 1],
  ["Job clock — time logged against work", J, `isClockedIn && billingTier === "business"`, 1],
  ["Automatic scheduling", J, `if (billingTier !== "business") return { tasks: taskList, moved: [], refused: [] };`, 1],
  ["Email-domain allowlist", O, `domain`, null],
];
for (const [row, src, needle, count] of GATES) {
  const n = src.split(needle).length - 1;
  eq(`gated: "${row}" — ${JSON.stringify(needle.slice(0, 46))}`,
    count === null ? n > 0 : n === count, true);
}

// Rows the code does NOT yet enforce. The sold definition is AHEAD of the code
// (TIERS.md, #125) and this list is how that is held honestly: pinned, visible
// and tested, rather than left silent — silence is what caused all of this.
// Enforce one and this assertion will tell you to move it out of the list.
const NOT_ENFORCED = [
  // Basic still creates flat `general` jobs through the simple modal, and its
  // bars still carry hpd and worked hours. A shift type does not exist yet.
  "Jobs, panels & operations",
  // No field-level gate; unreachable only because Basic cannot open the wizard.
  "PO and job numbers",
  // jobClockIn/jobClockOut/updateJobSession/releaseJobSession carry NO tier
  // check. The card is hidden in the UI and the endpoints are wide open.
  "Job clock — time logged against work",
  // Business-only today via the same view filter as Clients, and job-fed
  // throughout. Basic's three-element version does not exist yet.
  "Job analytics — efficiency & utilization",
  // renderGantt/renderSplitGantt are reached from the Schedule page, which
  // Basic has. No separate gate; they disappear only once renderTeam carries
  // shift bars and the toggle is built per tier (design §12.3 A, §12.4).
  "Gantt timelines — month view in place of the shift calendar",
  // No tier gate anywhere on departments or row grouping.
  "Departments & row grouping",
  // Client-side convenience: no payload identifies a reflowed arrangement, so
  // this one is not server-enforceable even in principle. See TIERS.md.
  "Automatic scheduling — overlap clearing, reflow, dependency cascade, conflict blocking",
  // Configured by hand; nothing in the product can set it.
  "Microsoft / SSO sign-in",
  // Not a code path.
  "Priority support",
];
eq("every unenforced row is a real Business row",
  NOT_ENFORCED.filter((f) => !BUSINESS_FEATURES.includes(f)), []);
{
  const gatedRows = new Set(GATES.map(([row]) => row));
  // A row is accounted for if it has a gate or is on the unenforced list. Any
  // row in NEITHER is an unreviewed claim, which is the #333 shape.
  const unaccounted = BUSINESS_FEATURES.filter(
    (f) => !NOT_ENFORCED.includes(f) && ![...gatedRows].some((g) => f.startsWith(g)));
  eq("every Business row is either gated or listed as unenforced", unaccounted, []);
}

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

// RED PROOF: every guard above must discriminate, or it is decoration.
let redOk = true;
{
  const overSold = [
    "Flat jobs — one task, one team, one time",   // the row this file now forbids
    "Scheduling & job management",
    "Granular admin permissions",
    "Advanced analytics",
    "Up to 25 employees",
  ].join(" | ").toLowerCase();
  const catches = [
    ["'flat jobs' smuggled into Basic", /\bjobs?\b/.test(overSold)],
    ["job management sold to Basic", /job management/i.test(overSold)],
    ["granular permissions sold at all", /granular admin permissions/i.test(overSold)],
    ["an advanced-analytics split", /advanced analytics/.test(overSold)],
    ["an employee cap", /up to \d/.test(overSold)],
  ];
  // The inverse: the guards must stay QUIET on the table as it stands, or they
  // are passing for the wrong reason.
  const quiet = [
    ["the real Basic list trips no job-layer guard", !/\bjobs?\b|\bpanels?\b|job clock|hatch|overdue/.test(basicText)],
    ["plain Analytics is allowed in Business", !/advanced analytics/.test(all)],
  ];
  // The subset guard: a naive [...BASIC, ...BUSINESS] column must be rejected.
  const naive = [...BASIC_FEATURES, ...BUSINESS_FEATURES];
  const subsetProof = [
    ["a naive concatenated column still contains the Basic-only row",
      naive.some((f) => BASIC_ONLY.includes(f))],
    ["...and businessColumn() does not", !businessColumn().some((f) => BASIC_ONLY.includes(f))],
  ];
  // Gate guards must go red when their gate is deleted from a COPY of the source.
  const mutations = GATES.map(([row, src, needle, count]) => {
    const n = src.split(needle).join("/* removed */").split(needle).length - 1;
    return [`${row} (${needle.slice(0, 28)})`, !(count === null ? n > 0 : n === count)];
  });
  const bad = [...catches, ...quiet, ...subsetProof, ...mutations].filter(([, got]) => !got);
  if (bad.length) {
    redOk = false;
    console.error("RED PROOF FAILED: " + bad.map(([n]) => n).join(", "));
  } else {
    console.log(`red proof: ${catches.length} over-sold claims caught, ${quiet.length} honest ones left alone, `
      + `${subsetProof.length} subset checks, ${mutations.length} gate guards go red when their gate is deleted`);
  }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && redOk ? 0 : 1);
