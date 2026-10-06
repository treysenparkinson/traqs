// Settings by tier (#421, #423) — and the negative result that frames both.
//
// NINE OF THE TWELVE BUSINESS FEATURES ARE ENFORCED BY NOTHING. `tiers-test`'s
// own NOT_ENFORCED list says so: jobs/panels/ops, PO and job numbers, the job
// clock, job analytics, Gantt, departments and row grouping, automatic
// scheduling, Microsoft SSO and priority support. **Three are really enforced:
// Clients, Approval templates, and the email-domain allowlist.** Every assertion
// here is about those three, because a gate on an unenforced feature is theatre
// and a missing gate on one of these is the only kind that costs anything.
//
//   #421  Every tier gate read `billingTier` directly, and that value is the
//         localStorage cache or "basic" until fetchBilling answers. On a Business
//         org's first load in a fresh browser the Business entries were MISSING,
//         then appeared. Ruling: show the Business set while the tier is unknown
//         and let the gate only ever TAKE AWAY.
//
//   #423  The mobile settings modal had NO tier gates at all and exposed two of
//         the three enforced features the desktop hides — Clients with no gate of
//         any kind, and Sign Off Preferences (the signOffTemplates editor, which
//         IS "Approval templates") behind can("orgSettings") alone.
//
//   node scripts/settings-tier-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { businessOnlyVisible } from "../src/tierVisibility.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const CODE = codeOf(read("../src/TRAQS.jsx"));

console.log("\n1. THE RULE — an unknown tier shows, a known Basic removes");
{
  ok("not loaded, cached basic  -> SHOWN", businessOnlyVisible("basic", false), true);
  ok("not loaded, cached business -> SHOWN", businessOnlyVisible("business", false), true);
  ok("loaded, business -> SHOWN", businessOnlyVisible("business", true), true);
  ok("loaded, basic -> REMOVED", businessOnlyVisible("basic", true), false);
  // The gate may only ever take away: there is no (tier, loaded) pair where
  // loading makes something APPEAR, which is the confusing direction.
  const appears = [["basic", "basic"], ["business", "business"]]
    .filter(([a, b]) => !businessOnlyVisible(a, false) && businessOnlyVisible(b, true));
  ok("loading never makes an entry appear", appears, []);
  // Unknown values fail toward showing, because the server is the real boundary.
  ok("an unrecognised tier, unloaded, still shows", businessOnlyVisible("enterprise", false), true);
  ok("...and once loaded is not treated as business", businessOnlyVisible("enterprise", true), false);
  ok("a missing tier, unloaded, shows", businessOnlyVisible(undefined, false), true);
  ok("...and once loaded does not", businessOnlyVisible(undefined, true), false);
}

console.log("\n2. #421 — both navs use it");
{
  ok("tierVisibility is imported", /import \{ businessOnlyVisible \} from "\.\/tierVisibility\.js"/.test(CODE), true);
  // RED: this was `billingTier === "business" || c.key !== "org-approval-templates"`.
  ok("the settings nav gates Approval templates through it",
    /businessOnlyVisible\(billingTier, billingLoaded\) \|\| c\.key !== "org-approval-templates"/.test(CODE), true);
  // RED: this was `billingTier === "business" || !["tasks", …].includes(v.id)`.
  ok("the app nav gates Jobs / Analytics / Clients through it",
    /businessOnlyVisible\(billingTier, billingLoaded\) \|\| !\["tasks", "analytics", "clients"\]\.includes\(v\.id\)/.test(CODE), true);
  ok("...and neither compares the tier directly any more",
    /billingTier === "business" \|\| c\.key !==|billingTier === "business" \|\| !\["tasks"/.test(CODE), false);
  // THE DELIBERATE ASYMMETRY. An editable field is not a nav entry: the Sign-in
  // domain row sits behind a draft and an explicit Save, so showing it and taking
  // it away could drop something half-typed. It stays gated on the tier alone.
  ok("the Sign-in domain row is still gated strictly",
    /\{billingTier === "business" && sRow\("Sign-in domain"/.test(CODE), true);
  ok("...and not on the unknown-tier rule", /businessOnlyVisible\([^)]*\) && sRow\("Sign-in domain"/.test(CODE), false);
}

console.log("\n3. #423 — mobile settings matches desktop");
{
  const at = CODE.indexOf('{prefOpen ? "Preferences" : "Settings"}');
  ok("the mobile settings modal was found", at > 0, true);
  const modal = at > 0 ? CODE.slice(at, at + 9000) : "";
  // RED: this entry had NO gate of any kind — no can(), no tier.
  ok("the Clients entry is tier-gated",
    /businessOnlyVisible\(billingTier, billingLoaded\) && <button onClick=\{\(\) => \{ setSettingsOpen\(false\); setClientsSettingsOpen\(true\); \}\}/.test(modal), true);
  // RED: this had can("orgSettings") but no tier gate, while the desktop nav
  // filters the same editor out on Basic.
  ok("the Sign Off Preferences entry is tier-gated",
    /businessOnlyVisible\(billingTier, billingLoaded\) && can\("orgSettings"\) && <button onClick=\{\(\) => \{ setSettingsOpen\(false\); setPrefOpen\(false\); setSignOffSettingsOpen\(true\); \}\}/.test(modal), true);
  // ...and the permission it already had is NOT dropped in the process.
  ok("...and keeps its orgSettings permission", /can\("orgSettings"\)[^\n]*setSignOffSettingsOpen\(true\)/.test(modal), true);
  // The neighbours a careless edit would take with it.
  ok("the org settings entry survives", /setOrgSettingsOpen\(true\)/.test(modal), true);
  ok("the roles entry survives", /setRolesSettingsOpen\(true\)/.test(modal), true);
  ok("the preferences entry survives", /setPrefOpen\(true\)/.test(modal), true);
  // Both entries must still EXIST — gating is not deleting.
  ok("Clients is still reachable on Business", /setClientsSettingsOpen\(true\)/.test(modal), true);
  ok("Sign Off Preferences is still reachable on Business", /setSignOffSettingsOpen\(true\)/.test(modal), true);
}

console.log("\n4. THE THREE ENFORCED FEATURES STILL HAVE THEIR SERVER CHECKS");
{
  // The ruling leans on these: rendering a nav entry for a second gives nothing
  // away only while the server is the real boundary. Asserted, not assumed.
  const org = read("../netlify/functions/org.js");
  ok("org.js checks the tier on the domain write", /\(billing\.tier \|\| "basic"\) !== "business"/.test(org), true);
  ok("...in two places (domain and identity providers)",
    (org.match(/\(billing\.tier \|\| "basic"\) !== "business"/g) || []).length, 2);
  const clients = read("../netlify/functions/clients.js");
  ok("clients.js checks manageClients on write", /requirePerm\(member, "manageClients"\)/.test(clients), true);
  // And billing itself cannot be self-served, which is what makes #422 latent.
  const billing = read("../netlify/functions/billing.js");
  ok("billing POST records interest without changing the tier",
    /requestedTier: "business"/.test(billing) && !/\btier: *"business"/.test(billing), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
