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
// GRANULAR ADMIN PERMISSIONS ARE DELIBERATELY NOT LISTED, and that is an open
// gap rather than a decision (#333). They used to sit under Business, and
// `_utils/can.js` has always enforced them for every org with no tier check —
// so the claim was false the whole time it was printed. It stays off the table
// until it is either gated or deliberately given to everyone.

export const BASIC_FEATURES = [
  "Shift scheduling — shift bars on person rows",
  "Shifts: start and end time, notes and location",
  "New shift: day, all-day or set times, who's on it",
  "Time clock, for pay only",
  "Pay-period hours export from pay punches",
  "Employees — name and phone for quick contact",
  "Dashboard, messages and admin",
];

// What Basic has that BUSINESS DOES NOT. Business puts Analytics in this nav
// slot instead, so this is not a feature Business "also gets" — it is the one
// place the tiers diverge rather than nest, and the upgrade comparison has to
// subtract it from the Business column rather than inheriting the whole list.
export const BASIC_ONLY = [
  "Employees — name and phone for quick contact",
];

// Business is everything in Basic EXCEPT BASIC_ONLY, plus all of this.
// The job layer is the line. Everything above "Departments" is part of it.
export const BUSINESS_FEATURES = [
  "Jobs, panels & operations",
  "PO and job numbers",
  "Job clock — time logged against work",
  "Analytics — in the Employees slot",
  "Clients",
  "Approval templates",
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
