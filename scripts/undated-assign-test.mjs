// An assigned operation with no dates can still be unassigned from the Jobs list — #397.
//
// The assignee cell offered its picker only when the op had dates (canQuickAssign), and showed
// its "can't assign until dates are set" hint only when nobody was on it. An op WITH a team and
// NO dates matched neither, so it rendered plain names: no picker, no way to clear the crew from
// here. Now that op gets the picker with ONE option, Unassign — assigning someone else still
// needs dates, taking people off does not. The clear goes through commitAssign like every other
// assignment (refusal chain, moveLog); that path was executed on an undated op before building
// on it and returns no refusal.
//
// Scoped to the cell, comments stripped (R4).
//
//   node scripts/undated-assign-test.mjs

import { readFileSync } from "node:fs";
import { applyDragMove, refuseDragMove } from "../src/dragMove.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// The commit path, executed: clearing the team of an undated op is not refused and is logged.
{
  const tasks = [{ id: "j", title: "J", subs: [{ id: "p", title: "P", subs: [{ id: "o", title: "O", start: null, end: null, team: ["7"] }] }] }];
  const at = { start: null, end: null, startHour: null, endHour: null };
  const mover = { id: "o", reassigned: true, from: { ...at, team: ["7"] }, to: { ...at, team: [] } };
  ok("#397 the refusal chain does not refuse clearing an undated op", refuseDragMove([mover], { tasks, people: [], isLive: () => false, isLocked: () => false, isOverdue: () => false }) === null);
  const o = applyDragMove(tasks, [mover], { date: "2026-10-15", movedBy: "T", reason: "Unassigned", people: [] })[0].subs[0].subs[0];
  ok("#397 ...the team clears, the dates stay empty, and it is logged", JSON.stringify(o.team) === "[]" && o.start === null && (o.moveLog || []).length === 1);
}

const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const at = S.indexOf("const canQuickAssign = canReassign && hasDates;");
const cell = S.slice(at, S.indexOf("onChange={v => {", at) + 200);
ok("#397 an undated op with a team is its own case", /const canClearUndated = canReassign && !hasDates && who\.length > 0;/.test(cell));
ok("#397 ...it gets the picker", /\(canQuickAssign \|\| canClearUndated\) \?/.test(cell));
ok("#397 ...offering only Unassign", /if \(canClearUndated\) return \[\{ value: "__clear"/.test(cell));
ok("an op with dates still gets the full picker", /assignPickerFor\(_ad, _panel, _job\)/.test(cell));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
