// What each tier includes.
//
// EVERY LINE HERE WAS CONFIRMED AGAINST THE CODEBASE before being written down.
// A comparison table is a promise, and the ones that got cut are the point:
//
//   "advanced analytics"    NOT LISTED. There is one analytics page and no
//                           basic/advanced split anywhere in the product, so
//                           the axis does not exist to sell — and Matrix
//                           already uses that page. Gating it would be taking
//                           something away, not adding something.
//   employee cap            NOT LISTED. There isn't one.
//   "payroll & HR export"   NOT USED. It is a pay-period hours report rendered
//                           through the export designer to PDF, not an
//                           integration with a payroll provider. Called what it
//                           is.
//
// ── 2026-10-02: the table and the code were reconciled ─────────────────────
//
// TIERS.md found eleven tier-gated write paths and the disagreements ran BOTH
// ways: the Jobs page, Analytics, Clients, approval templates, the liquid
// background and the Job Clock card were all hidden from Basic while being sold
// to it or sold to nobody, and granular permissions were sold as Business while
// every org already had them. Analytics was the sharpest: the comment above
// says gating it takes something away, and the code gated it anyway.
//
// The principle settled on was: BASIC IS THE WHOLE PRODUCT MINUS WHAT GENUINELY
// COSTS MORE TO PROVIDE. Gating features to make Basic feel thin loses the
// customer before they ever consider upgrading, and a one-shop panel builder is
// exactly who Basic is sold to.
//
// So the line is AUTOMATIC SCHEDULING, and it is now stated rather than implied.
// It used to be absent from this table entirely, and that silence is what let
// the code's version of the tiers drift: with nothing written down, every gate
// looked as defensible as every other.
//
// SSO is listed under Business honestly: config.connection works end to end
// (App.jsx routes straight to the named Auth0 connection), but nothing in the
// product can SET it — it is configured by hand today. That is exactly what a
// non-self-serve tier is for, so it belongs here rather than in Basic.
//
// Granular admin permissions are NOT listed under Business any more. They were,
// and `_utils/can.js` has always enforced them for every org with no tier check,
// so the claim was false the whole time. Ruled 2026-10-02: left working for
// everyone, and if it is ever reclaimed it is for new orgs only — never taken
// from an org that has it. A table that promises what the code does not do is
// the thing this file exists to prevent.

export const BASIC_FEATURES = [
  "Scheduling, jobs, panels & operations",
  "Time tracking, job clock & timesheets",
  "Mobile clock in/out",
  "Clients, analytics & approval templates",
  "Pay-period hours export",
];

export const BUSINESS_FEATURES = [
  "Automatic scheduling — overlap clearing, reflow, dependency cascade",
  "Microsoft / SSO sign-in",
  "Email-domain allowlist",
  "Priority support",
];

// The one-line version of the difference, for the upgrade panel. Basic shows you
// the schedule you built; Business rearranges it for you when work runs long,
// collides, or depends on something else.
export const TIER_LINE = "Basic shows you your schedule. Business rearranges it for you.";

export const TIER_LABEL = { basic: "Basic", business: "Business" };

// Business is not self-serve: the CTA opens a conversation, not a purchase.
// Provisioning is manual, which is also how Matrix got its.
export const UPGRADE_CONTACT = "sales@matrixsystems.com";

export function upgradeMailto(orgCode, orgName) {
  const subject = `TRAQS Business — ${orgName || orgCode || "upgrade"}`;
  const body = [
    `Organization: ${orgName || "(unnamed)"}`,
    orgCode ? `Org code: ${orgCode}` : null,
    "",
    "We would like to talk about moving to Business.",
  ].filter(Boolean).join("\n");
  return `mailto:${UPGRADE_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
