// Functions that silently relied on their caller — #83, #66, #67.
//
// #83 walkProductiveHours read its dead windows in the order given and skipped any window that
//     ended before the clock, so out-of-order windows dropped dead time silently. Measured in
//     walkProductiveHoursBack's own comment: 6 productive hours from 08:00 with a 10:00 break
//     and a 12:00 lunch ends at 14.75 ascending and 14.50 descending. The backward walk sorted;
//     the forward one did not. It sorts now (only when it has to — it runs per bar per render).
// #66 rowPushHours assumed its ops were sorted and took the first as the anchor; only the caller
//     sorted. It sorts by the caller's exact key now, so the caller's sort is a no-op on it.
// #67 the schedule still passed hasActiveSession to rowPushHours, which stopped reading it.
//
//   node scripts/sort-contracts-test.mjs

import { readFileSync } from "node:fs";
import { walkProductiveHours, buildDayWindows, rowPushHours } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ── #83 ──
{
  const cfg = buildDayWindows(8, 17, [{ time: "10:00", durationMinutes: 15 }], { time: "12:00", durationMinutes: 30 });
  const asc = walkProductiveHours(8, 6, cfg);
  const desc = walkProductiveHours(8, 6, { ...cfg, deadWindows: [...cfg.deadWindows].reverse() });
  ok("#83 the walk ends at 14.75 with windows in order", near(asc.endHour, 14.75));
  ok("#83 ...and at the same hour with them reversed", near(desc.endHour, asc.endHour) && desc.days === asc.days && near(desc.columns, asc.columns));
  const before = cfg.deadWindows.map(w => w.start).join(",");
  walkProductiveHours(8, 6, { ...cfg, deadWindows: [...cfg.deadWindows].reverse() });
  ok("#83 ...without reordering the caller's array", cfg.deadWindows.map(w => w.start).join(",") === before);
}

// ── #66 ──
{
  const DAYS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
  const cfg = { workStartH: 8, totalWorkH: 8, productiveHoursPerDay: 7.5, diffBD: (a, b) => DAYS.indexOf(b) - DAYS.indexOf(a) };
  const op = (id, start, startHour = 8, hpd = 7.5) => ({ id, start, startHour, hpd, teamSize: 1, workedHoursShown: 0, isFullyWorked: false });
  const sorted = [op("a", "2026-09-14"), op("b", "2026-09-14", 12), op("c", "2026-09-15")];
  const shuffled = [sorted[2], sorted[0], sorted[1]];
  const asObj = (r) => JSON.stringify(Object.fromEntries([...r.pushes.entries()].sort()));
  const s = rowPushHours({ ops: sorted, nowDay: "2026-09-16", nowHour: 8, cfg });
  const u = rowPushHours({ ops: shuffled, nowDay: "2026-09-16", nowHour: 8, cfg });
  ok("#66 shuffled ops push exactly as sorted ones", asObj(s) === asObj(u) && JSON.stringify([...s.atCursor].sort()) === JSON.stringify([...u.atCursor].sort()));
  ok("#66 ...and the caller's array is not reordered", shuffled[0].id === "c");
}

// ── #67 ──
{
  const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
  const at = S.indexOf("const _rowPush = rowPushHours({");
  const call = S.slice(at, S.indexOf("});", at));
  ok("#67 the schedule's rowPushHours call is found", at > 0);
  ok("#67 ...and no longer passes the ignored hasActiveSession", !/hasActiveSession/.test(call));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
