// SIGNUP: the shape of the wizard, its validation, and what it sends.
//
// Pure. No React, no fetch, no storage — so every rule below can be tested
// without rendering anything, and the screens stay a rendering of this rather
// than the place the rules live.
//
// WHERE THE VALUES GO, which is not obvious and is the thing most likely to be
// got wrong twice:
//
//   config.json     name, adminEmail, adminName, adminEmails,
//                   industry, companySize, country, currency
//   settings.json   timeZone, payPeriodType, payPeriodStart
//
// The org timezone and the payroll period ALREADY EXIST in settings.json and
// are already read by the app. Writing them into config.json instead would
// create a second copy that nothing reads, and the app would quietly keep its
// defaults while the signup screen showed the admin what they had chosen.

// Matching the app's existing stored values EXACTLY, hyphens and all. Note that
// "biweekly" has no hyphen and "semi-monthly" does — an inconsistency already in
// the data, and not one to tidy here: the reader compares these strings
// literally and a tidier spelling would silently stop matching.
export const PAY_PERIODS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "semi-monthly", label: "Semi-monthly" },
  { value: "monthly", label: "Monthly" },
];

// Four buckets, matching the wireframe's pill row exactly. A fifth would wrap
// the row and the pills are sized to sit on one line.
export const COMPANY_SIZES = [
  { value: "1-10", label: "1–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-200", label: "51–200" },
  { value: "200+", label: "200+" },
];

export const INDUSTRIES = [
  "Electrical", "Mechanical", "Manufacturing", "Construction",
  "Engineering", "Fabrication", "Industrial Services", "Other",
];

export const CURRENCIES = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "MXN", label: "MXN — Mexican Peso" },
];

// The wireframe numbers Identity as STEP 1 OF 5, and that is what ships: five
// forms, with the welcome screen counted as an entry point rather than a step.
// Numbering from the welcome screen instead — which is what this first shipped
// as — tells someone on the first form they are already a fifth of the way
// through something they have not started.
//
// `heading` is what the screen says; `title` is the short name used by the Back
// button and the confirmation sections. They differ on the first step, where the
// wireframe's heading is "Set up your organization" but a back button reading
// "← Set up your organization" would be absurd.
//
// There is no `blurb`. Each step used to carry a line explaining itself; they
// were cut from the screens, and a field nothing renders is a field that will be
// edited by someone who thinks it still shows.
export const SIGNUP_STEPS = [
  { id: "identity", n: 1, title: "Identity", heading: "Set up your organization" },
  { id: "basics", n: 2, title: "Organization basics", heading: "Organization basics" },
  { id: "tier", n: 3, title: "Tier", heading: "Choose your tier" },
  { id: "payroll", n: 4, title: "Payroll", heading: "Payroll rhythm" },
  { id: "confirm", n: 5, title: "Confirm", heading: "Confirm & activate" },
];

export const emptySignupForm = () => ({
  name: "", adminName: "", adminEmail: "",
  extraAdmins: [],
  industry: "", companySize: "", country: "", timeZone: "", currency: "USD",
  tier: "basic",
  payPeriodType: "biweekly", payPeriodStart: "",
});

const isEmail = (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isDate = (v) => typeof v === "string" && v.length === 10 && v[4] === "-" && v[7] === "-"
  && Number.isFinite(new Date(v + "T12:00:00").getTime());

/**
 * Errors for one step, as { field: message }. Empty object means the step may
 * advance. Per-step rather than one big validator so a half-filled later step
 * cannot block an earlier one — and so Confirm can re-run every step's rules to
 * catch a section edited into an invalid state and then navigated away from.
 */
export function validateStep(stepId, form) {
  const e = {};
  const name = (form.name || "").trim();

  if (stepId === "identity") {
    if (!name) e.name = "Organization name is required.";
    else if (name.length > 80) e.name = "Keep this under 80 characters.";
    if (!(form.adminName || "").trim()) e.adminName = "Your name is required.";
    if (!isEmail(form.adminEmail)) e.adminEmail = "Enter a valid email address.";
    // NO DOMAIN AT SIGNUP. An email-domain allowlist is a Business-tier control,
    // not something every new org has to decide before it can exist. Membership
    // is the real boundary either way: requireOrgMember rejects anyone who is
    // neither in people.json nor in config.adminEmails, so an org without a
    // domain is not an open one.
    // Each extra admin gets their own invite, so each address has to be usable
    // on its own. A blank row is just an unused row and is dropped, not an error.
    const extras = (form.extraAdmins || []).map((a) => (a || "").trim()).filter(Boolean);
    const bad = extras.filter((a) => !isEmail(a));
    if (bad.length) e.extraAdmins = `Not a valid email: ${bad[0]}`;
    const all = [form.adminEmail, ...extras].map((a) => (a || "").trim().toLowerCase()).filter(Boolean);
    if (new Set(all).size !== all.length) e.extraAdmins = "That address is already listed.";
  }

  if (stepId === "basics") {
    if (!form.industry) e.industry = "Pick an industry.";
    if (!form.companySize) e.companySize = "Pick a company size.";
    if (!(form.country || "").trim()) e.country = "Country is required.";
    if (!(form.timeZone || "").trim()) e.timeZone = "Time zone is required.";
    if (!CURRENCIES.some((c) => c.value === form.currency)) e.currency = "Pick a currency.";
  }

  if (stepId === "tier") {
    // BUSINESS IS NOT SELECTABLE YET. It is shown so the difference is visible
    // and so the screen does not have to be redesigned when it opens up, but
    // choosing it is refused here as well as in the UI -- a disabled button is a
    // suggestion, and this step's value ends up in a POST either way.
    if (form.tier !== "basic") e.tier = "Business is not available yet. It is coming soon.";
  }

  if (stepId === "payroll") {
    if (!PAY_PERIODS.some((p) => p.value === form.payPeriodType)) e.payPeriodType = "Pick a pay period.";
    // A DATE, not a weekday. payPeriodStart is stored as YYYY-MM-DD and every
    // period boundary in the app is counted forward from it, so a day name
    // would be unusable — there would be no anchor to count from.
    if (!isDate(form.payPeriodStart)) e.payPeriodStart = "Pick the date the first pay period starts.";
  }

  if (stepId === "confirm") {
    for (const s of SIGNUP_STEPS) {
      if (s.id === "confirm") continue;
      Object.assign(e, validateStep(s.id, form));
    }
  }
  return e;
}

export const stepIsValid = (stepId, form) => Object.keys(validateStep(stepId, form)).length === 0;

/**
 * The POST body. Split into the two files that actually hold these values, so
 * the server writes each where the app already reads it.
 *
 * No org code: the server generates it. No people: a new org boots completely
 * empty — no departments, shifts, ops or person records. The admin can sign in
 * because requireOrgMember accepts an address listed in config.adminEmails
 * without a person row, and their record is written on first login.
 */
export function buildOrgPayload(form) {
  const clean = (v) => (v || "").trim();
  const extras = (form.extraAdmins || [])
    .map(clean).filter(Boolean)
    .map((a) => a.toLowerCase());
  const adminEmail = clean(form.adminEmail).toLowerCase();

  return {
    name: clean(form.name),
    adminEmail,
    adminName: clean(form.adminName),
    // The primary admin first, then the invitees, de-duplicated.
    adminEmails: [...new Set([adminEmail, ...extras])],
    industry: form.industry || "",
    companySize: form.companySize || "",
    country: clean(form.country),
    currency: form.currency || "USD",
    settings: {
      timeZone: clean(form.timeZone),
      payPeriodType: form.payPeriodType,
      payPeriodStart: form.payPeriodStart,
    },
  };
}

// The addresses that receive an invite — everyone except the person signing up,
// who is already authenticated by the time the org exists.
export function inviteRecipients(form) {
  const adminEmail = (form.adminEmail || "").trim().toLowerCase();
  return [...new Set((form.extraAdmins || [])
    .map((a) => (a || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((a) => a !== adminEmail))];
}
