// What each tier includes.
//
// ── 2026-10-02: written from Trey's definition, not inferred from the code ──
//
// THIS TABLE IS THE SOLD DEFINITION. The code implements PART of it. That gap
// is documented in TIERS.md and tracked as #125; it is not a licence to edit
// this file to match the code, because the code is the half that is behind.
//
// The shape of the two tiers:
//
//   BASIC is shift scheduling and a pay clock. That is the whole product.
//   The schedule is the same view, drawing SHIFT bars on person rows: start
//   time, end time, optional notes and location. Nothing else on a bar. The
//   time clock exists for PAY only, and the hours export comes from pay
//   punches. It is all manual.
//
//   BUSINESS is all of that plus THE JOB LAYER: jobs, panels and operations,
//   PO and job numbers, the job clock, time logged against work, Analytics,
//   Clients, approval templates, departments, and automatic scheduling.
//
// BASIC HAS NO JOB LAYER IN ANY FORM. Not a reduced one, not a flat one, not
// one with the fields hidden — none. No jobs, no panels, no ops, no PO or job
// numbers, no job clock, no time logged against work. A previous version of
// this file said Basic got "flat jobs"; that was wrong and is the kind of
// almost-right row this file exists to stop. A shift is not a small job.
//
// Three consequences fall straight out of that, and each has caught something:
//
//   NO DEPARTMENTS, so no row grouping. Departments are a job-layer concept.
//
//   NO HATCHING, NO OVERDUE TRAY, NO CURSOR. Every one of those renders
//   JOB TIME — hatching is worked-vs-estimated, the overdue tray is work past
//   its date, the cursor is progress through an estimate. With no time logged
//   against work there is nothing for any of them to draw.
//
//   BASIC IS NOT A SUBSET OF BUSINESS. See BASIC_ONLY below: Basic has an
//   Employees page that Business does not. The two tiers put different pages
//   in the same nav slot — Employees for Basic, Analytics for Business — so
//   "Business is everything in Basic, plus..." is FALSE and the upgrade
//   comparison must not render it that way.
//
// ── why this file is written at all ────────────────────────────────────────
//
// It used to list four Basic rows and three Business ones and said nothing
// about the tier gates in the product. That silence is the whole reason it is
// being written properly: with the real line unwritten, a reader (me, in
// TIERS.md) walked the code, found eleven deliberate gates that no table
// accounted for, and concluded the CODE had drifted from the promise. It had
// not. The gates ARE the product design. The PROMISE was incomplete, and a
// silent table cannot defend a deliberate decision.
//
// One row did most of the damage: "Scheduling & job management" sold Basic a
// job layer it was never meant to have. Four words made nine deliberate gates
// read as defects, and acting on that removed them all before it was caught.
//
// Claims deliberately NOT made, each checked and cut:
//
//   "advanced analytics"    there is one Analytics page and no basic/advanced
//                           split. Analytics is Business — but as one row,
//                           because there is only one of it.
//   employee cap            there isn't one.
//   "payroll & HR export"   it is a pay-period hours report rendered through
//                           the export designer to PDF, not an integration
//                           with a payroll provider. Called what it is.
//
// SSO is listed under Business honestly: config.connection works end to end
// (App.jsx routes straight to the named Auth0 connection), but nothing in the
// product can SET it — it is configured by hand today. That is exactly what a
// non-self-serve tier is for, so it belongs there rather than in Basic.
//
// GRANULAR ADMIN PERMISSIONS — #333, CLOSED 2026-10-02 against the rostering
// design's decision 16, which answered it in a way neither option on the table
// had considered. The question had been framed as "gate adminPerms on tier (a
// takeaway from every existing Basic org) or give them away deliberately".
// The answer is neither: ALL NINE KEYS STAY ENFORCED FOR EVERY ORG, and Basic
// is SHOWN only the four that mean anything in a product with no jobs —
// manageTeam, orgSettings, approveTimeOff (and undoHistory, which decision 18
// then removes, leaving three). The five job/client toggles (editJobs,
// moveJobs, reassign, manageClients, approveCompletions) are omitted from the
// settings page, not disabled and not revoked. Nothing is taken from anyone,
// and the table never claimed them, so there is no row here either way.

// ── RULED 2026-10-02 (second pass), from the rostering design ──────────────
//
// `origin/docs/rostering-design` (2026-09-21/22, 23 locked decisions) is the
// default throughout. It is the more considered source and it was written
// first; the 2026-10-02 definition that produced the previous version of this
// table was written without knowledge of it. See BASIC_RECONCILIATION.md.
//
// Three rows changed as a direct result:
//
//   ANALYTICS IS BASIC, cut to three elements (decision 14). Not adapted —
//   CUT. `efficiencyPct({prod, working})` (statsMath.js:220) divides
//   production hours by working hours, and `prod` comes from productionHours,
//   so with no jobs it renders 0%: a FALSE statement rather than a missing
//   one. The card and the Employees Performance panel are absent in Basic
//   rather than zeroed, and statsMath.js stays a Business-only module.
//
//   THERE IS NO EMPLOYEES/ANALYTICS SLOT SWAP. The previous table invented
//   one. Basic has BOTH pages; the Employees page simply has its job-fed
//   panels omitted and its schedule panels re-sourced from the roster.
//
//   THE ROSTER IS RECURRING BY DEFAULT (decisions 1–7). A weekly template per
//   person is the primitive and one-offs are dated exceptions — not a flat
//   list of shift rows with a pattern bolted on later.
//
// CONFLICT NOT RESOLVED HERE, flagged rather than decided: the 2026-10-02
// definition says Basic has NO DEPARTMENTS and no row grouping, while the
// rostering design (§12.3 D) treats the Departments settings section as
// "Basic-safe as it stands". Departments are listed under Business below,
// following the explicit definition, but the two sources disagree and this
// row should be confirmed.
export const BASIC_FEATURES = [
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
];

// What Basic has that BUSINESS DOES NOT.
//
// It is the SHIFT CALENDAR, not the Employees page — the previous version of
// this file had the wrong row. Per decision 20 the calendar is Basic-only and
// occupies the toggle slot Business gives to the month timeline, so the two
// tiers swap that slot rather than nesting. The design calls this out itself
// (§10.9): upgrading no longer only reveals things, it also TAKES ONE AWAY,
// and the upgrade button's copy has to say so.
export const BASIC_ONLY = [
  "Shift calendar — month grid, org-wide or per person",
];

// Business is everything in Basic EXCEPT BASIC_ONLY, plus all of this.
export const BUSINESS_FEATURES = [
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
];

// The Business column of the upgrade comparison. NOT `[...BASIC, ...BUSINESS]`:
// Basic is not a subset, so the rows in BASIC_ONLY are dropped.
export const businessColumn = () => [
  ...BASIC_FEATURES.filter((f) => !BASIC_ONLY.includes(f)),
  ...BUSINESS_FEATURES,
];

export const TIER_LABEL = { basic: "Basic", business: "Business" };

// Business is not self-serve: the CTA opens a conversation, not a purchase.
// Provisioning is manual, which is also how Matrix got its.
export const UPGRADE_CONTACT = "sales@matrixsystems.com";

export const upgradeMailto = (orgName, orgCode) => {
  const subject = `TRAQS Business: ${orgName || "upgrade enquiry"}`;
  const body = [
    "Hello,",
    "",
    `We'd like to talk about upgrading ${orgName || "our organization"} to TRAQS Business.`,
    orgCode ? `Organization code: ${orgCode}` : "",
    "",
  ].filter(Boolean).join("\n");
  return `mailto:${UPGRADE_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
