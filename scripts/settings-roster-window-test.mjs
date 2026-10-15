// #150. THE TIME CLOCK SETTINGS MODAL POSTED THE ROSTER IT OPENED WITH.
//
// `openSettings` snapshotted every person (`people.map(p => ({ ...p }))`), the
// modal stayed open while an admin edited, and `saveSettings` POSTed that
// snapshot entire. Anything written to people.json in between — a PTO approval,
// a push-token registration, somebody else's edit — was erased by it. The
// window was as long as the modal was open.
//
// AND #349's PROTECTION EXEMPTS THE ONLY CALLER THAT REACHES IT. `people.js`
// pins `PROTECTED_PERSON_FIELDS` (timeOff among them) but only
// `if (!can(member, "manageTeam") && stored)` — admins bypass it, and only an
// admin can open Time Clock Settings.
//
// THE EXEMPTION STAYS, and that was checked rather than assumed: four admin
// paths deliberately write `timeOff` through the same roster POST — the
// schedule's PTO drag (TRAQS.jsx:17211), the PTO context-menu cancel (:30916),
// the PTO edit modal (:31128) and the Person modal's linked-request
// reconciliation (:10652). Removing the exemption would break all four. It is
// protecting a capability that IS used, so the fix belongs at the window.
//
// THE MODAL EDITS TWO FIELDS: payType and pin. It has no business owning
// anyone's timeOff, and now it does not.
//
//   node scripts/settings-roster-window-test.mjs
import { readFileSync } from "node:fs";
import { applyRosterEdits, SETTINGS_FIELDS } from "../src/rosterEdits.js";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const CUR = () => [
  { id: 1, name: "Ann", payType: "hourly", pin: "1111", timeOff: [{ reqId: "R1", start: "2026-11-02" }], pushToken: "tok-1" },
  { id: 2, name: "Bob", payType: "hourly", pin: "2222", timeOff: [] },
  { id: 3, name: "Cid", payType: "salary", pin: "3333", timeOff: [] },
];

console.log("\n1. ONLY THE EDITED FIELDS, ONLY ON THE EDITED PEOPLE");
{
  // The draft is STALE on purpose: it was taken before Ann's leave was approved
  // and before her phone registered. That is the whole defect.
  const draft = [
    { id: 1, name: "Ann", payType: "salary", pin: "1111", timeOff: [], pushToken: null },
    { id: 2, name: "Bob", payType: "hourly", pin: "9999", timeOff: [] },
    { id: 3, name: "Cid", payType: "salary", pin: "3333", timeOff: [] },
  ];
  const out = applyRosterEdits(CUR(), draft, SETTINGS_FIELDS);
  ok("Ann's payType change is applied", out.find(p => p.id === 1).payType, "salary");
  ok("...and her APPROVED LEAVE survives", out.find(p => p.id === 1).timeOff, [{ reqId: "R1", start: "2026-11-02" }]);
  ok("...and her push token survives", out.find(p => p.id === 1).pushToken, "tok-1");
  ok("Bob's pin change is applied", out.find(p => p.id === 2).pin, "9999");
  ok("Cid, unedited, is the CURRENT record untouched", out.find(p => p.id === 3), CUR()[2]);
}

console.log("\n2. THE ROSTER ITSELF IS NOT RESHAPED");
{
  // reconcileDeletions tombstones ids absent from a POST, so dropping or
  // reordering anyone here is a delete. The result must be the CURRENT array.
  const draft = [{ id: 2, name: "Bob", payType: "salary", pin: "2222" }];
  const out = applyRosterEdits(CUR(), draft, SETTINGS_FIELDS);
  ok("everyone in the current roster is still present", out.map(p => p.id), [1, 2, 3]);
  ok("...in the current order", out.map(p => p.name), ["Ann", "Bob", "Cid"]);
  ok("a draft that omits people deletes nobody", out.length, 3);
  ok("the one it does carry is still applied", out.find(p => p.id === 2).payType, "salary");
}
{
  // Somebody added to people.json while the modal was open must not vanish.
  const cur = [...CUR(), { id: 4, name: "Dee", payType: "hourly", pin: "4444" }];
  const out = applyRosterEdits(cur, CUR(), SETTINGS_FIELDS);
  ok("a person added while the modal was open survives", out.map(p => p.id), [1, 2, 3, 4]);
}
{
  // And a draft row for somebody since removed must not resurrect them.
  const draft = [...CUR(), { id: 9, name: "Ghost", payType: "hourly", pin: "0000" }];
  const out = applyRosterEdits(CUR(), draft, SETTINGS_FIELDS);
  ok("a draft row for somebody no longer in the roster is ignored", out.map(p => p.id), [1, 2, 3]);
}

console.log("\n3. THE FIELD LIST IS THE WHOLE OF WHAT IT MAY TOUCH");
{
  ok("it is exactly payType and pin", SETTINGS_FIELDS, ["payType", "pin"]);
  const draft = CUR().map(p => ({ ...p, name: "HACKED", userRole: "admin", adminPerms: { approveTimeOff: true } }));
  const out = applyRosterEdits(CUR(), draft, SETTINGS_FIELDS);
  ok("a field outside the list is ignored, whatever the draft says", out.map(p => p.name), ["Ann", "Bob", "Cid"]);
  ok("...including permission fields", out.find(p => p.id === 1).userRole, undefined);
}
{
  // An undefined value in the draft is a field the modal never set, not an
  // instruction to clear one.
  const draft = [{ id: 1, payType: undefined, pin: "7777" }];
  const out = applyRosterEdits(CUR(), draft, SETTINGS_FIELDS);
  ok("an absent field leaves the stored value alone", out.find(p => p.id === 1).payType, "hourly");
  ok("...while the field beside it still applies", out.find(p => p.id === 1).pin, "7777");
}

console.log("\n4. EDGES THAT MUST NOT THROW OR EMPTY THE ROSTER");
{
  ok("a null draft changes nothing", applyRosterEdits(CUR(), null, SETTINGS_FIELDS).map(p => p.id), [1, 2, 3]);
  ok("a null roster returns an empty list, never undefined", applyRosterEdits(null, CUR(), SETTINGS_FIELDS), []);
  ok("mixed id types still match", applyRosterEdits(CUR(), [{ id: "1", payType: "salary" }], SETTINGS_FIELDS).find(p => p.id === 1).payType, "salary");
  ok("a null row in either list is skipped", applyRosterEdits([null, ...CUR()], [null, { id: 2, pin: "5" }], SETTINGS_FIELDS).find(p => p?.id === 2).pin, "5");
}

// SUPERSEDED BY #150's CLOSURE (2026-10-15): the modal no longer re-reads and POSTs a roster at
// all — it sends only the fields the admin changed, which the server applies inside one
// conditional write (people-fields-test). applyRosterEdits above is still the tested merge; the
// modal's contract is now the one below.
console.log("\n5. THE MODAL SENDS ONLY ITS EDITS, NEVER A ROSTER");
{
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("saveSettings diffs the draft against the snapshot it opened with",
    /fieldEdits\(tsSettingsBaseRef\.current, tsSettingsDraft, SETTINGS_FIELDS\)/.test(CODE), true);
  ok("...and sends only those edits",
    /savePeopleFields\(_edits, getToken, orgCode\)/.test(CODE), true);
  ok("the snapshot is no longer the payload",
    /savePeople\(tsSettingsDraft, getToken, orgCode\)/.test(CODE), false);
  ok("and local state takes the merged roster, not the draft",
    /setPeople\(tsSettingsDraft\);/.test(CODE), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
