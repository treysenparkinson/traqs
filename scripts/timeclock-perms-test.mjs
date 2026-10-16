// #295. THE TIMECLOCK ADMIN ACTIONS CHECKED A BARE `isAdmin`.
//
// Five sites — the punch editors, the lunch/break editors, confirm/unconfirm,
// adminJobHours — asked only "are you an admin", so a restricted admin kept
// FULL power over everyone's hours. At Matrix that is concrete: Chelsea has
// seven of nine toggles off and can confirm a timesheet, and #503 put 828
// unconfirmed hours behind that button.
//
// TWO KEYS, NOT ONE, because they are different acts:
//   manageTimeclock  — correcting the record: clock someone in or out, edit a
//                      punch, add or remove a lunch, set job hours. Daily, shop
//                      floor, reversible.
//   confirmTimesheet — turning hours into money. Fortnightly, payroll, and the
//                      only one the accountant's export reads.
// The existing model already separates doing from approving (editJobs vs
// approveCompletions, manageTeam vs approveTimeOff); this follows that grain.
//
// AND THE PERMISSION MODEL IS MADE TO MEAN WHAT IT SAYS IN THE SAME PASS.
// `GRANTED_WHEN_ABSENT` exists so a NEW key does not strip rights from records
// written before it, and its own comment says to empty it "once every live
// record carries the keys". Nobody ever did — so `approveCompletions` and
// `approveTimeOff` have been DECORATIVE since they shipped: absent means
// granted, and nothing ever wrote them onto a record that lacked them.
//
// THE MECHANISM, not the oversight: `togglePerm` writes ONE key onto whatever
// object is there. A record missing a key never gains it unless that exact
// toggle is touched, so the set could never empty itself. It now backfills the
// whole map, which is what lets the set go to zero and stay there.
//
//   node scripts/timeclock-perms-test.mjs
import { register } from "module";
import { readFileSync } from "node:fs";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
// #125: pinned, never inherited (#529) — the tier rule is tier-rules-test's, and here it would
// add rule events this suite does not expect, or refuse its Basic test org in enforce.
process.env.TIER_RULES_MODE = "off";
const { handler } = await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href);
const { can, PERM_KEYS } = await import(new URL("../netlify/functions/_utils/can.js", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const CAN = readFileSync(new URL("../netlify/functions/_utils/can.js", import.meta.url), "utf8");
const TC = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8");
const WEB = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

console.log("\n1. THE TWO KEYS EXIST ON BOTH SIDES");
{
  ok("manageTimeclock is a server key", PERM_KEYS.includes("manageTimeclock"), true);
  ok("confirmTimesheet is a server key", PERM_KEYS.includes("confirmTimesheet"), true);
  ok("...and the web offers both as toggles",
    /key: "manageTimeclock"/.test(WEB) && /key: "confirmTimesheet"/.test(WEB), true);
  ok("both carry a plain-English label for the 403 body",
    /manageTimeclock:\s*"/.test(CAN) && /confirmTimesheet:\s*"/.test(CAN), true);
}

console.log("\n2. GRANTED_WHEN_ABSENT IS EMPTY — the toggles are real now");
{
  ok("the server set is empty", /const GRANTED_WHEN_ABSENT = new Set\(\[\]\);/.test(CAN), true);
  ok("the web set is empty", /const PERMS_GRANTED_WHEN_ABSENT = new Set\(\[\]\);/.test(WEB), true);
  // The behaviour that follows, which is the whole point of emptying it.
  ok("an absent key no longer grants approveCompletions",
    can({ isAdmin: true, adminPerms: {} }, "approveCompletions"), false);
  ok("...nor approveTimeOff", can({ isAdmin: true, adminPerms: {} }, "approveTimeOff"), false);
  ok("an explicit true still grants", can({ isAdmin: true, adminPerms: { approveTimeOff: true } }, "approveTimeOff"), true);
  ok("a legacy unrestricted admin (adminPerms null) still has everything",
    PERM_KEYS.every(k => can({ isAdmin: true, adminPerms: null }, k)), true);
  ok("a non-admin has nothing, whatever the map says",
    can({ isAdmin: false, adminPerms: { manageTimeclock: true } }, "manageTimeclock"), false);
}

console.log("\n3. togglePerm BACKFILLS, WHICH IS WHY THE SET CAN STAY EMPTY");
{
  // The mechanism that kept the set from ever emptying: one key written onto a
  // record that may be missing the others. Both toggle sites, pinned by site.
  ok("the draft toggle writes the whole map",
    (WEB.match(/adminPerms: fullPerms\(person\.adminPerms, key, val\)/g) || []).length, 2);
  ok("...and no single-key spread survives",
    /adminPerms: \{ \.\.\.\(person\.adminPerms \|\| \{\}\), \[key\]: val \}/.test(WEB), false);
  ok("fullPerms fills every key it does not carry",
    /const fullPerms = \(perms, key, val\) =>/.test(WEB), true);
  // Promotion writes an explicit map rather than {}, so a NEW admin's record is
  // self-describing from birth and the trap cannot regrow on the next key.
  ok("promoting someone writes every key explicitly, not {}",
    /adminPerms: isAdm \? undefined : fullPerms\(\{\}\)/.test(WEB), true);
  ok("...and the bare {} promotion is gone",
    /userRole: isAdm \? "user" : "admin", adminPerms: isAdm \? undefined : \{\}/.test(WEB), false);
}

console.log("\n4. THE FIVE SERVER SITES ASK FOR THE RIGHT KEY");
{
  const site = (open) => { const i = TC.indexOf(open); return i < 0 ? "" : TC.slice(i, i + 900); };
  ok("the punch editors want manageTimeclock",
    /can\(_m, "manageTimeclock"\)/.test(site(`if (action === "adminClockOut" || action === "adminClockIn"`)), true);
  ok("the entry editors want manageTimeclock",
    /can\(_me, "manageTimeclock"\)/.test(site(`if (action === "adminEditEvent" || action === "adminAddEvent"`)), true);
  ok("the lunch/break editors want manageTimeclock",
    /can\(_ml, "manageTimeclock"\)/.test(site(`if (action === "adminLunchStart" || action === "adminLunchEnd"`)), true);
  ok("adminJobHours wants manageTimeclock",
    /can\(_mjh, "manageTimeclock"\)/.test(site(`if (action === "adminJobHours")`)), true);
  ok("confirm/unconfirm wants its OWN key",
    /can\(_cm, "confirmTimesheet"\)/.test(site(`if (action === "confirmTimesheet" || action === "unconfirmTimesheet")`)), true);
  ok("...and not the correcting one",
    /can\(_cm, "manageTimeclock"\)/.test(site(`if (action === "confirmTimesheet" || action === "unconfirmTimesheet")`)), false);
  ok("no bare Admin only survives on these five",
    (TC.match(/return err\(403, "Admin only"\)/g) || []).length, 0);
}

console.log("\n5. BEHAVIOURAL — a restricted admin is refused, and told which toggle");
const reset = (perms) => {
  globalThis.__S3 = {
    "orgs/TESTORG/settings.json": { timeZone: "America/Denver" },
    "orgs/TESTORG/people.json": [{ id: 7, name: "Worker", pin: "1234" }],
    "orgs/TESTORG/payhours.json": [
      { id: "e1", personId: 7, date: "2026-10-05", clockIn: "2026-10-05T15:00:00.000Z", clockOut: "2026-10-05T23:00:00.000Z", hours: 8 },
    ],
    "orgs/TESTORG/productionhours.json": [], "orgs/TESTORG/tasks.json": [],
  };
  globalThis.__WRITES = []; globalThis.__ETAGS = {};
  globalThis.__AUTH = { orgCode: "TESTORG", personId: 1, isAdmin: true, email: "a@x.com", adminPerms: perms };
};
const post = (b) => handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(b) });
{
  // Chelsea's shape: admin, almost everything off.
  reset({ undoHistory: true, orgSettings: true });
  const c = await post({ action: "confirmTimesheet", start: "2026-10-01", end: "2026-10-31" });
  ok("a restricted admin cannot confirm a timesheet", c.statusCode, 403);
  ok("...and the 403 names the toggle", /confirm/i.test(c.body?.error || ""), true);
  const e = await post({ action: "adminClockIn", personId: 7 });
  ok("...nor clock somebody in", e.statusCode, 403);
  ok("the timesheet was not confirmed", !!globalThis.__S3["orgs/TESTORG/payhours.json"][0].confirmed, false);
}
{
  // Noah's agreed shape: correcting yes, confirming no. The split in action.
  reset({ manageTimeclock: true, confirmTimesheet: false });
  const e = await post({ action: "adminClockIn", personId: 7 });
  ok("manageTimeclock alone allows a correction", e.statusCode, 200);
  const c = await post({ action: "confirmTimesheet", start: "2026-10-01", end: "2026-10-31" });
  ok("...and still refuses the confirm", c.statusCode, 403);
}
{
  reset({ confirmTimesheet: true });
  const c = await post({ action: "confirmTimesheet", start: "2026-10-01", end: "2026-10-31" });
  ok("confirmTimesheet alone allows the confirm", c.statusCode, 200);
  const e = await post({ action: "adminClockIn", personId: 7 });
  ok("...and refuses the correction — the split works both ways", e.statusCode, 403);
}
{
  reset(null);
  const c = await post({ action: "confirmTimesheet", start: "2026-10-01", end: "2026-10-31" });
  ok("an unrestricted admin is unaffected", c.statusCode, 200);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
