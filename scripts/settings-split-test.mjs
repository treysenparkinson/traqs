// A screen that mixes permissions shows only what you can change — #298 (the rest), ruled
// 2026-10-15 ("split the rows. A screen that mixes permissions should hide what you can't change
// rather than accept and discard it. If that means two sections where there was one, that's fine").
//
// Org-setting rows need orgSettings; rows that write PEOPLE (pay type, PINs, worker permissions)
// need manageTeam — people.js keeps another person's row verbatim for anyone without it, so those
// edits were accepted on screen and discarded on save. Two surfaces mixed them:
//   - Settings → Organization: the whole group was gated on orgSettings, Worker permissions
//     included (all people rows), and Time Clock mixed both kinds.
//   - the Time Clock Settings modal on the timesheet: every group on isAdmin.
// Each row now asks for its own permission, the group/section shows if any of its rows would, and a
// save writes only the parts the user may change.
//
// Scoped, comments stripped (R4).
//
//   node scripts/settings-split-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const slice = (from, to) => { const a = S.indexOf(from); return a < 0 ? "" : S.slice(a, S.indexOf(to, a + from.length)); };

// ── Settings → Organization ──
const allowed = slice("const orgSectionAllowed = ", ";\n");
ok("#298 each Organization section has its own permission", allowed.length > 0);
ok("#298 ...Worker permissions needs manageTeam", /"org-permissions" \? can\("manageTeam"\)/.test(allowed));
ok("#298 ...Time Clock needs either", /"org-timeclock" \? \(can\("orgSettings"\) \|\| can\("manageTeam"\)\)/.test(allowed));
ok("#298 the nav lists only the sections the user may open", (S.match(/SETTINGS_ORG_CHILDREN\.filter\(c => orgSectionAllowed\(c\.key\)\)/g) || []).length >= 1 && !/\{can\("orgSettings"\) && <optgroup label="Organization">/.test(S));
const body = slice("const renderSettingsBody = () => {", "\n  };");
ok("#298 a section the user may not open renders nothing, even if navigated to", /settingsSection\.startsWith\("org-"\) && !orgSectionAllowed\(settingsSection\)\) return null;/.test(body));
const tc = slice("const renderSettingsTimeClock = () => {", "\n  };");
ok("#298 Time Clock's org rows show only with orgSettings", /\{_canOrg && sRow\("Pay period"/.test(tc) && /\{_canOrg && sRow\("Hours cap"/.test(tc) && /\{_canOrg && sRow\("Clock events"/.test(tc) && /\{_canOrg && sRow\("Mobile clock-in"/.test(tc));
ok("#298 ...its people rows (PINs, pay type) only with manageTeam", /\{_canTeam && sRow\("Clock-in PINs"/.test(tc) && /\{_canTeam && <div className="rv-mside">/.test(tc));
const save = slice('} else if (sec === "org-timeclock") {', '} else if (sec === "customization")');
ok("#298 its save writes org settings only with orgSettings", /if \(can\("orgSettings"\)\) setOrgSettings\(/.test(save));
ok("#298 ...and people only with manageTeam", /if \(can\("manageTeam"\)\) \{[\s\S]*savePeople(Fields)?\(/.test(save));

// ── the Time Clock Settings modal ──
const modal = slice("const renderSettingsPanel = () => {", "\n    };");
ok("#298 the modal's org groups ask for orgSettings", (modal.match(/\{can\("orgSettings"\) && <div>/g) || []).length >= 4);
ok("#298 ...its Team group asks for manageTeam", /\{can\("manageTeam"\) && \(/.test(modal));
ok("#298 ...and so does its Save, which writes people", /\{can\("manageTeam"\) && <button onClick=\{saveSettings\}/.test(modal));
ok("#298 ...and it opens for either", /\(can\("orgSettings"\) \|\| can\("manageTeam"\)\) && \(\s*<button onClick=\{openSettings\}/.test(S));
ok("#298 no group in the modal is gated on isAdmin alone any more", !/\{isAdmin && <div>/.test(modal) && !/\{isAdmin && \(/.test(modal));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
