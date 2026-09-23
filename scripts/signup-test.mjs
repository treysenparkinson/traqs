// Signup: the rules behind the wizard, and where each value is written.
//
// The last section is the one that earns its keep. The org timezone and the
// payroll period already exist in settings.json and are already read by the
// app; writing them into config.json instead would create a second copy that
// nothing reads, and the screen would show the admin a choice the app then
// ignored. So the payload is asserted field by field against the names and
// spellings already in the live bucket.
//
//   node scripts/signup-test.mjs

import {
  SIGNUP_STEPS, PAY_PERIODS, COMPANY_SIZES, CURRENCIES, INDUSTRIES,
  emptySignupForm, validateStep, stepIsValid, buildOrgPayload, inviteRecipients,
} from "../src/orgSignup.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return true; }
  fail++; console.error(`FAIL  ${label}\n      got  ${g}\n      want ${w}`);
};

const filled = () => ({
  name: "Acme Fabrication", adminName: "Dana Reyes",
  adminEmail: "dana@acmefab.com", domain: "acmefab.com",
  extraAdmins: ["sam@acmefab.com"],
  industry: "Fabrication", companySize: "11-50",
  country: "United States", timeZone: "America/Denver", currency: "USD",
  payPeriodType: "biweekly", payPeriodStart: "2026-10-05",
});

// ── the wizard's shape ───────────────────────────────────────────────────
eq("four steps after the welcome screen", SIGNUP_STEPS.length, 4);
eq("numbered 1 through 4 — the welcome screen is an entry point, not a step",
  SIGNUP_STEPS.map((s) => s.n), [1, 2, 3, 4]);
eq("a blank form fails every step",
  SIGNUP_STEPS.map((s) => stepIsValid(s.id, emptySignupForm())), [false, false, false, false]);
eq("a filled form passes every step",
  SIGNUP_STEPS.map((s) => stepIsValid(s.id, filled())), [true, true, true, true]);

// ── identity ─────────────────────────────────────────────────────────────
const idErr = (over) => validateStep("identity", { ...filled(), ...over });
eq("organization name is required", Object.keys(idErr({ name: "  " })), ["name"]);
eq("a name over 80 chars is rejected", Object.keys(idErr({ name: "x".repeat(81) })), ["name"]);
eq("admin name is required", Object.keys(idErr({ adminName: "" })), ["adminName"]);
eq("admin email must be an email", Object.keys(idErr({ adminEmail: "dana" })), ["adminEmail"]);
eq("domain must look like a domain", Object.keys(idErr({ domain: "acmefab" })), ["domain"]);
eq("a domain with an @ is rejected", Object.keys(idErr({ domain: "a@acmefab.com" })), ["domain"]);
eq("a leading @ on the domain is tolerated, not an error",
  Object.keys(idErr({ domain: "@acmefab.com" })), []);
eq("an invalid extra admin is caught",
  Object.keys(idErr({ extraAdmins: ["nope"] })), ["extraAdmins"]);
eq("a blank extra admin row is just unused, not an error",
  Object.keys(idErr({ extraAdmins: ["", "  "] })), []);
eq("listing the same admin twice is caught",
  Object.keys(idErr({ extraAdmins: ["dana@acmefab.com"] })), ["extraAdmins"]);
eq("...case-insensitively",
  Object.keys(idErr({ extraAdmins: ["DANA@acmefab.com"] })), ["extraAdmins"]);
eq("NO org code field exists to validate",
  Object.keys(emptySignupForm()).includes("code"), false);

// ── basics ───────────────────────────────────────────────────────────────
const bErr = (over) => validateStep("basics", { ...filled(), ...over });
eq("industry is required", Object.keys(bErr({ industry: "" })), ["industry"]);
eq("company size is required", Object.keys(bErr({ companySize: "" })), ["companySize"]);
eq("country is required", Object.keys(bErr({ country: "" })), ["country"]);
eq("time zone is required", Object.keys(bErr({ timeZone: "" })), ["timeZone"]);
eq("currency must be one we offer", Object.keys(bErr({ currency: "XYZ" })), ["currency"]);
eq("four size buckets, as the wireframe draws them", COMPANY_SIZES.map((c) => c.value), ["1-10", "11-50", "51-200", "200+"]);
eq("Other is an industry, so nobody is stuck", INDUSTRIES.includes("Other"), true);

// ── payroll ──────────────────────────────────────────────────────────────
const pErr = (over) => validateStep("payroll", { ...filled(), ...over });
eq("pay period must be one the app understands",
  Object.keys(pErr({ payPeriodType: "fortnightly" })), ["payPeriodType"]);
eq("the start must be a real date", Object.keys(pErr({ payPeriodStart: "Monday" })), ["payPeriodStart"]);
eq("...not a blank", Object.keys(pErr({ payPeriodStart: "" })), ["payPeriodStart"]);
eq("...and not a malformed one", Object.keys(pErr({ payPeriodStart: "2026-13-45" })), ["payPeriodStart"]);
eq("all four periods the app supports are offered",
  PAY_PERIODS.map((p) => p.value), ["weekly", "biweekly", "semi-monthly", "monthly"]);

// THE SPELLING. These strings are compared literally by the reader, and the
// existing data is inconsistent: biweekly has no hyphen, semi-monthly does.
// Tidying either one here would silently stop matching.
eq("biweekly is unhyphenated, as stored", PAY_PERIODS[1].value, "biweekly");
eq("semi-monthly is hyphenated, as stored", PAY_PERIODS[2].value, "semi-monthly");

// ── confirm re-runs everything ───────────────────────────────────────────
eq("confirm catches a section edited into an invalid state and left",
  Object.keys(validateStep("confirm", { ...filled(), timeZone: "" })), ["timeZone"]);
eq("confirm on a good form is clean", validateStep("confirm", filled()), {});

// ── WHERE THE VALUES GO ──────────────────────────────────────────────────
{
  const p = buildOrgPayload(filled());
  eq("the org name goes to config", p.name, "Acme Fabrication");
  eq("the domain is normalised", buildOrgPayload({ ...filled(), domain: "@ACMEFAB.com" }).domain, "acmefab.com");
  eq("the admin email is lowercased", p.adminEmail, "dana@acmefab.com");
  eq("adminEmails leads with the primary admin, then the invitees",
    p.adminEmails, ["dana@acmefab.com", "sam@acmefab.com"]);
  eq("a duplicated admin is collapsed",
    buildOrgPayload({ ...filled(), extraAdmins: ["Dana@acmefab.com"] }).adminEmails, ["dana@acmefab.com"]);

  // The three that must land in settings.json, under the names already there.
  eq("timeZone goes to settings, not config", p.settings.timeZone, "America/Denver");
  eq("payPeriodType goes to settings", p.settings.payPeriodType, "biweekly");
  eq("payPeriodStart goes to settings", p.settings.payPeriodStart, "2026-10-05");
  eq("and none of the three leaks into the config half",
    [p.timeZone, p.payPeriodType, p.payPeriodStart], [undefined, undefined, undefined]);

  eq("no org code is sent — the server generates it", p.code, undefined);
  eq("no people are sent — a new org boots empty", p.people, undefined);
}

// RED PROOF: the mistake this section exists to prevent. A payload that puts
// the timezone on the config object satisfies "the field is present" while the
// app, which reads orgSettings.timeZone, never sees it.
let placementRedOk = true;
{
  const wrong = { ...buildOrgPayload(filled()), timeZone: "America/Denver", settings: {} };
  const appReads = (payload) => payload.settings?.timeZone || null;
  if (appReads(wrong) !== null || appReads(buildOrgPayload(filled())) !== "America/Denver") {
    placementRedOk = false;
    console.error("RED PROOF FAILED: config-placed timezone is not distinguishable from settings-placed");
  } else {
    console.log("red proof: a timezone written to config.json reads back as null for the app, "
      + "though the value is right there in the payload");
  }
}

// ── invites ──────────────────────────────────────────────────────────────
eq("the person signing up is not invited — they are already here",
  inviteRecipients(filled()), ["sam@acmefab.com"]);
eq("nor are they if they list themselves again",
  inviteRecipients({ ...filled(), extraAdmins: ["dana@acmefab.com", "sam@acmefab.com"] }), ["sam@acmefab.com"]);
eq("no extra admins means no invites", inviteRecipients({ ...filled(), extraAdmins: [] }), []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 && placementRedOk ? 0 : 1);
