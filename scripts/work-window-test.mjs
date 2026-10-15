// A working window that closes at or before it opens is invalid input — #354, ruled 2026-10-15
// ("the editor should refuse it ... For data already saved: fall back to the org default and
// surface it once — don't silently repair, because someone chose those numbers and should know
// they didn't take").
//
// The guards across six sites disagreed only on such a window, and both editors let one through.
// Now: the rule is one function in orgDefaults.js; both editors refuse at entry; a stored invalid
// window falls back to the default in withOrgDefaults (which the server's overlap context uses
// too); and the web tells whoever can change org settings, once per load, without writing back.
//
//   node scripts/work-window-test.mjs

import { readFileSync } from "node:fs";
import { withOrgDefaults, invalidWorkWindow, workWindowError, DEFAULT_ORG_SETTINGS } from "../src/orgDefaults.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// ── the rule ──
ok("#354 a normal window is fine", workWindowError("07:00", "15:00") === null);
ok("#354 closing before opening is refused", typeof workWindowError("09:00", "08:00") === "string");
ok("#354 closing AT opening is refused", typeof workWindowError("09:00", "09:00") === "string");
ok("a missing or malformed value is not this rule's business (defaults handle it)", workWindowError(null, "15:00") === null && workWindowError("7", "15:00") === null);
ok("#354 a stored invalid window is reported with what was chosen", JSON.stringify(invalidWorkWindow({ workStart: "09:00", workEnd: "08:00" })) === JSON.stringify({ workStart: "09:00", workEnd: "08:00" }));
ok("...a valid one is not", invalidWorkWindow({ workStart: "07:00", workEnd: "15:00" }) === null);
const fixed = withOrgDefaults({ workStart: "09:00", workEnd: "08:00", workDays: [1, 2] });
ok("#354 an invalid stored window falls back to the org default", fixed.workStart === DEFAULT_ORG_SETTINGS.workStart && fixed.workEnd === DEFAULT_ORG_SETTINGS.workEnd);
ok("...and nothing else is touched", JSON.stringify(fixed.workDays) === "[1,2]");
ok("a valid stored window is kept", withOrgDefaults({ workStart: "08:00", workEnd: "17:00" }).workEnd === "17:00");

// ── the editors refuse, the load surfaces (comments stripped, R4) ──
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const sAt = S.indexOf('} else if (sec === "org-schedule") {');
const save = S.slice(sAt, S.indexOf("} else if (sec ===", sAt + 10));
ok("#354 Settings → Schedule refuses an invalid window before it saves", /const (\w+) = workWindowError\(dd\.workStart, dd\.workEnd\);\s*if \(\1\) throw /.test(save) && save.search(/workWindowError/) < save.search(/setOrgSettings/));
const opensAt = S.indexOf("const newStart = e.target.value;");
const closesAt = S.indexOf("const newEnd = e.target.value;");
ok("#354 the inline Opens input refuses one", /workWindowError\(newStart,/.test(S.slice(opensAt, opensAt + 400)));
ok("#354 the inline Closes input refuses one", /workWindowError\([^)]*newEnd\)/.test(S.slice(closesAt, closesAt + 400)));
const lAt = S.indexOf("fetchOrgSettings(getToken, orgCode)");
ok("#354 the load notices an invalid stored window", /invalidWorkWindow\(server\)/.test(S.slice(lAt, lAt + 1500)));
const effAt = S.indexOf("const canFixOrgSettings = can(\"orgSettings\");");
const eff = S.slice(effAt, S.indexOf("}, [workWindowNotice, canFixOrgSettings]);", effAt));
ok("#354 ...shown only to whoever can change org settings", effAt > 0 && /!canFixOrgSettings\) return;/.test(eff));
ok("#354 ...and only once per load", /workWindowNoticeShownRef\.current \|\|/.test(eff) && /workWindowNoticeShownRef\.current = true;/.test(eff) && eff.indexOf("workWindowNoticeShownRef.current = true;") < eff.indexOf("setConfirmMove("));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
