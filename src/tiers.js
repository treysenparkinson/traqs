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
// SSO is listed under Business honestly: config.connection works end to end
// (App.jsx routes straight to the named Auth0 connection), but nothing in the
// product can SET it — it is configured by hand today. That is exactly what a
// non-self-serve tier is for, so it belongs here rather than in Basic.

export const BASIC_FEATURES = [
  "Time tracking & timesheets",
  "Mobile clock in/out",
  "Scheduling & job management",
  "Pay-period hours export",
];

export const BUSINESS_FEATURES = [
  "Microsoft / SSO sign-in",
  "Granular admin permissions",
  "Priority support",
];

export const TIER_LABEL = { basic: "Basic", business: "Business" };

// Business is not self-serve: the CTA opens a conversation, not a purchase.
// Provisioning is manual, which is also how Matrix got its.
export const UPGRADE_CONTACT = "sales@matrixsystems.com";

export const upgradeMailto = (orgName, orgCode) => {
  const subject = `TRAQS Business — ${orgName || "upgrade enquiry"}`;
  const body = [
    "Hello,",
    "",
    `We'd like to talk about upgrading ${orgName || "our organization"} to TRAQS Business.`,
    orgCode ? `Organization code: ${orgCode}` : "",
    "",
  ].filter(Boolean).join("\n");
  return `mailto:${UPGRADE_CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
};
