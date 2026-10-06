// #383/#392 — THE CURSOR ANCHOR MUST NEVER PAINT A BAR EARLIER THAN ITS DATA.
//
// Trey lost a day to a bar that would not move. The trace settled it:
//
//     start 2026-10-07 08:00        what the op holds
//     paintedDay   "2026-10-06"     = TD, today
//     paintedHour  10.833245555…    = shopHour(Date.now()), the wall clock
//     paintedVsStoredH 9            a full working day apart
//
// The bar was PINNED TO THE CURSOR: `_layoutStart = TD` and
// `_barStartH = shopHour(now)` (TRAQS.jsx:16299-16310), set for any op in
// `cursorAnchored`, which rowPushHours fills at statsMath.js:1041 when an op is
// idle and has no worked hours. Trey on #383: "almost like there HAS to be a job
// at the cursor at all times." That is this, described from outside.
//
// WHY IT MADE THE DROP A NO-OP. The drag anchors on the PAINTED origin (#25,
// deliberately). Painted was 6.2 working hours behind stored, the cursor moved
// +36px = +6.2 working hours, so the landing computed to exactly the stored
// value. The commit wrote what was already there — only moveLog moved, 102 ->
// 103 — and the next render pinned the bar back to the cursor. No drop could
// move it while the pin held, which is why the save path, the arithmetic and the
// renderer all read as correct: each was doing exactly what it was told.
//
// THE RULE, which rowPushHours already states for the PUSH and does not hold for
// the PIN: "Only ever forward — this moves a bar OFF idle time, it never drags
// one backwards into the past." Painting an op scheduled for TOMORROW at TODAY's
// clock is dragging it backwards.
//
// TWO PLACES, ONE RULE, because the trace cannot say which branch fired — by the
// arithmetic (sp = startProd(op), idleTarget = nowProd - ownWorked) an op
// starting ahead of the cursor gives idleTarget - sp < 0, so `> push` is false
// and it should never have been pinned. It was. So the condition is made
// explicit AND the paint is guarded, and each is tested on its own.
//
//   node scripts/cursor-anchor-test.mjs
import { rowPushHours, cursorAnchorStart } from "../src/statsMath.js";
import { workCalendar } from "../src/scheduleRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const cal = workCalendar({ workDays: [1, 2, 3, 4, 5] });
const cfg = { workStartH: 8, totalWorkH: 9, productiveHoursPerDay: 7.5, diffBD: (a, b) => cal.diffSigned(a, b) };
// Mon 2026-10-05 .. Fri 2026-10-09 are working days.
const op = (o) => ({ id: "OP", start: "2026-10-07", end: "2026-10-08", startHour: 8, ownWorkedHours: 0, ...o });

// A NOTE ON WHAT THIS SUITE DOES NOT PROVE, recorded because mutation testing
// said so rather than because it was noticed by reading.
//
// Mutating `if (ownWorked <= 0 && sp < nowProd)` back to `if (ownWorked <= 0)` in
// rowPushHours SURVIVES every assertion here. That term is redundant under the
// code as written — it follows from the enclosing `idleTarget - sp > push` with
// push >= 0 — so no fixture can distinguish the two. It is kept as a statement of
// what the anchor means, not as a working guard, and this comment exists so the
// next person does not read its presence as coverage.
//
// WHICH MATTERS, because Trey's bar WAS anchored while scheduled a day ahead of
// the cursor, and that should have been impossible by the same arithmetic. The
// fixtures here cannot reproduce however that happened. THE LOAD-BEARING FIX IS
// THEREFORE cursorAnchorStart AT THE PAINT, which holds whatever set the anchor;
// the rowPushHours term is documentation sitting next to it.
console.log("\n1. THE DEFECT — an op scheduled AHEAD of the cursor is not pinned to it");
{
  // Trey's exact case: stored tomorrow at 08:00, cursor today at 10:50.
  const r = rowPushHours({ ops: [op({})], nowDay: "2026-10-06", nowHour: 10.8332, cfg });
  ok("an op starting TOMORROW is not cursor-anchored", r.atCursor.has("OP"), false);
  ok("...and takes no push toward the cursor", r.pushes.get("OP") || 0, 0);
}

console.log("\n2. THE BEHAVIOUR THAT MUST SURVIVE — a genuinely idle op still pins");
{
  // Scheduled on Monday, nothing worked, cursor now on Wednesday. This is what
  // the anchor is FOR, and a fix that removed it would be a different bug.
  // end AFTER nowDay on purpose: rowPushHours drops an op whose window already
  // closed (`op.end < nowDay` -> continue, the active horizon), and a fixture that
  // trips that guard asserts nothing about anchoring at all. My first version did.
  const r = rowPushHours({ ops: [op({ start: "2026-10-05", end: "2026-10-09" })], nowDay: "2026-10-07", nowHour: 10.5, cfg });
  ok("an op left behind by the cursor IS anchored", r.atCursor.has("OP"), true);
  ok("...and is pushed forward, never backward", (r.pushes.get("OP") || 0) > 0, true);
}

console.log("\n3. The boundary — an op starting exactly at the cursor");
{
  const r = rowPushHours({ ops: [op({ start: "2026-10-06", startHour: 8 })], nowDay: "2026-10-06", nowHour: 8, cfg });
  ok("an op starting exactly at the cursor is not dragged anywhere", (r.pushes.get("OP") || 0), 0);
  ok("...and needs no anchor, because it is already there", r.atCursor.has("OP"), false);
}

console.log("\n4. Worked hours still place the bar behind the cursor, unpinned");
{
  // The idle-left rule: a worked op lands SHORT of the cursor by its own worked
  // hours and is placed from the push, not snapped to now. Unchanged.
  const r = rowPushHours({ ops: [op({ start: "2026-10-05", end: "2026-10-09", ownWorkedHours: 3 })], nowDay: "2026-10-07", nowHour: 10.5, cfg });
  ok("a WORKED idle op is pushed", (r.pushes.get("OP") || 0) > 0, true);
  ok("...but is NOT cursor-anchored, because it lands short of the cursor", r.atCursor.has("OP"), false);
}

console.log("\n5. cursorAnchorStart — the paint can never go backwards");
{
  const at = (day, hour) => ({ day, hour });
  // The guard, stated directly: the anchor is the LATER of the cursor and the
  // op's own scheduled position.
  ok("a cursor AHEAD of the schedule wins — the op really is idle",
    cursorAnchorStart({ scheduledStart: "2026-10-05", scheduledHour: 8, cursorDay: "2026-10-07", cursorHour: 10.5, cfg }),
    at("2026-10-07", 10.5));
  ok("a cursor BEHIND the schedule does NOT — this is Trey's bar",
    cursorAnchorStart({ scheduledStart: "2026-10-07", scheduledHour: 8, cursorDay: "2026-10-06", cursorHour: 10.8332, cfg }),
    at("2026-10-07", 8));
  ok("the same day, cursor earlier in it, keeps the schedule",
    cursorAnchorStart({ scheduledStart: "2026-10-07", scheduledHour: 13, cursorDay: "2026-10-07", cursorHour: 9, cfg }),
    at("2026-10-07", 13));
  ok("the same day, cursor later in it, takes the cursor",
    cursorAnchorStart({ scheduledStart: "2026-10-07", scheduledHour: 9, cursorDay: "2026-10-07", cursorHour: 13, cfg }),
    at("2026-10-07", 13));
  ok("equal positions are a no-op",
    cursorAnchorStart({ scheduledStart: "2026-10-07", scheduledHour: 9, cursorDay: "2026-10-07", cursorHour: 9, cfg }),
    at("2026-10-07", 9));
  // A TIE MUST KEEP THE SCHEDULE, and this is the case that can tell. With equal
  // hours the two branches return identical values, so `>` and `>=` are
  // indistinguishable — a mutation to `>=` survived the assertion above. Here the
  // cursor hour is MISSING and the scheduled hour is the work start, which is
  // still a tie on the axis but a visible difference in the result: taking the
  // cursor hands the paint an undefined hour.
  ok("a tie keeps the schedule, so the paint never gets an undefined hour",
    cursorAnchorStart({ scheduledStart: "2026-10-07", scheduledHour: 8, cursorDay: "2026-10-07", cursorHour: null, cfg }),
    at("2026-10-07", 8));
  ok("a missing scheduled start yields the cursor rather than throwing",
    cursorAnchorStart({ scheduledStart: null, scheduledHour: null, cursorDay: "2026-10-07", cursorHour: 11, cfg }),
    at("2026-10-07", 11));
  ok("a missing cursor yields the schedule",
    cursorAnchorStart({ scheduledStart: "2026-10-07", scheduledHour: 9, cursorDay: null, cursorHour: null, cfg }),
    at("2026-10-07", 9));
}

console.log("\n6. RED PROOF — the old pin, reproduced");
{
  // What the paint did: TD and the wall clock, unconditionally, for any anchored
  // op. Against Trey's values that is a day and 6.17 working hours backwards.
  const painted = { day: "2026-10-06", hour: 10.8332 };
  const stored = { day: "2026-10-07", hour: 8 };
  const axis = (p) => cfg.diffBD("2026-10-06", p.day) * cfg.totalWorkH + (p.hour - cfg.workStartH);
  ok("RED: the unguarded anchor paints the bar BEFORE its data", axis(painted) < axis(stored), true);
  ok("...by the gap the trace reported", +(axis(stored) - axis(painted)).toFixed(2), 6.17);
  ok("...and the guard removes exactly that",
    cursorAnchorStart({ scheduledStart: stored.day, scheduledHour: stored.hour, cursorDay: painted.day, cursorHour: painted.hour, cfg }),
    { day: "2026-10-07", hour: 8 });
}

console.log("\n7. The paint uses it");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  ok("TRAQS.jsx imports the guard", /cursorAnchorStart/.test(CODE), true);
  // The two lines that produced the lie, by their values rather than their names.
  ok("the layout start is no longer TD unconditionally",
    /_layoutStart = TD;/.test(CODE), false);
  ok("the bar start hour is no longer the raw wall clock",
    /_barStartH = _rpv \? _rpv\.startHour : _atCursor\s*\n?\s*\? shopHour\(_nowForBar\.getTime\(\)\)/.test(CODE), false);
  // Both the day and the hour come out of the one call, not two conditions that
  // could drift apart — which is how the paint and the push disagreed to begin with.
  ok("...both come from the guard instead", /_anchored\s*=\s*_atCursor[\s\S]{0,80}?cursorAnchorStart\(/.test(CODE), true);
  ok("...the layout start is the guard's day", /_layoutStart = _anchored\.day;/.test(CODE), true);
  ok("...and the bar start hour is the guard's hour", /_anchored\s*\n?\s*\?\s*_anchored\.hour/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
