// #402 — THE SCHEDULER DECIDED DAYS WITH ONE QUESTION AND HOURS WITH ANOTHER.
//
// Both auto-schedule runs asked the shared availability oracle WITHOUT a start
// hour, while the drag and the Jobs-list assign cell both pass one:
//
//     TRAQS.jsx:23566   _localAvail.free(pid, s, eDate)
//     TRAQS.jsx:24320   _applyAvail.free(pid, s, eDate)
//     the drag          avail.free(pid, op.start, op.end, op.startHour ?? null)
//
// `free(pid, s, e, startH = null)` builds its probe as `startHour: startH ??
// undefined`, so omitting the argument asks a DIFFERENT QUESTION — one that
// cannot see an hour-level clash. The run then placed an op onto days the same
// person already had work on, and wrote no moveLog, so the only way it ever
// surfaced was by measuring the board (#402: 2057-01 and 2057-03 Layout, both
// 2026-10-05..07, same person, h12.5 and h15.5).
//
// The hour the run WOULD have written is a separate story and is already fixed:
// #344 removed `startHour: _autoStartH` on 2026-10-02, so nothing in the current
// run assigns an hour at all. What remains is the asking.
//
//   node scripts/scheduler-hour-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { schedulerAvailability } from "../src/overlapRules.js";
import { buildDayWindows, personShareHours } from "../src/statsMath.js";
import { workCalendar } from "../src/scheduleRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
const bodyFrom = (anchor) => {
  const at = CODE.indexOf(anchor);
  if (at < 0) return "";
  let i = CODE.indexOf("{", at), depth = 0;
  for (let j = i; j < CODE.length; j++) {
    if (CODE[j] === "{") depth++;
    else if (CODE[j] === "}") { depth--; if (depth === 0) return CODE.slice(at, j + 1); }
  }
  return "";
};

const cal = workCalendar({ workDays: [1, 2, 3, 4, 5] });
const cfg = buildDayWindows(8, 17, [{ time: "10:00", durationMinutes: 15 }, { time: "15:00", durationMinutes: 15 }], { time: "12:00", durationMinutes: 60 });
const ctx = { cfg, productiveHoursPerDay: 7.5, isWorkDay: (d) => cal.isWorkDay(d), today: "2026-09-28",
  shareHours: (u) => personShareHours(u.hpd, Math.max(1, (u.team || []).length), 7.5) };
const PERSON = "P1";
// One op already on the board, 08:00, three hours. The question is whether a
// second op for the same person on the same day is "free".
const board = [{ id: "J", title: "J", subs: [{ id: "PA", title: "PA", subs: [
  { id: "SITTING", title: "Sitting", start: "2026-09-28", end: "2026-09-28", startHour: 8, hpd: 3, team: [PERSON], status: "Not Started" },
] }] }];
const people = [{ id: PERSON, name: "Pat" }];

console.log("\n1. THE ARGUMENT CHANGES THE ANSWER — this is the whole defect");
{
  const av = schedulerAvailability(board, ctx, { excludeOpIds: [], people });
  // Day granularity: no hour, so the probe cannot see WHERE in the day it lands.
  const dayOnly = av.free(PERSON, "2026-09-28", "2026-09-28");
  // Hour granularity: 08:00 collides with the sitting op, 14:00 does not.
  const at8 = av.free(PERSON, "2026-09-28", "2026-09-28", 8);
  const at14 = av.free(PERSON, "2026-09-28", "2026-09-28", 14);
  ok("asked at 08:00 — the hour the sitting op occupies — it is NOT free", at8, false);
  ok("asked at 14:00 it IS free", at14, true);
  ok("the two differ, so the hour is load-bearing", at8 !== at14, true);
  // And the no-hour form answers one of them, whichever it is, for BOTH.
  ok("asked with NO hour it gives one answer for every hour of the day",
    [dayOnly === at8, dayOnly === at14].filter(Boolean).length, 1);
}

console.log("\n2. BOTH RUNS PASS THE HOUR");
{
  // Asserted on the helper AND on every call site, because a helper that accepts
  // an hour nobody passes is the same defect with a wider signature.
  ok("the preview run's helper takes an hour",
    /const isAvailLocal = \(pid, s, eDate, sh\) => _localAvail\.free\(pid, s, eDate, sh \?\? null\);/.test(CODE), true);
  ok("the apply run's helper takes an hour",
    /const isAvail=\(pid,s,eDate,sh\) => _applyAvail\.free\(pid,s,eDate,sh \?\? null\);/.test(CODE), true);
  const localCalls = (CODE.match(/isAvailLocal\([^)]*\)/g) || []).filter(c => !c.includes("=>"));
  const applyCalls = (CODE.match(/isAvail\([^)]*\)/g) || []).filter(c => !c.includes("=>") && !c.includes("isAvailLocal"));
  ok("every isAvailLocal call passes an hour", localCalls.filter(c => !/_opH/.test(c)), []);
  ok("every isAvail call passes an hour", applyCalls.filter(c => !/_opH/.test(c)), []);
  ok("...and there are six of them in total", localCalls.length + applyCalls.length, 6);
  // The hour comes from the op being placed, not from a constant.
  ok("the preview run reads it off the op", /const _opH = \(typeof op === "object" && op\) \? \(op\.startHour \?\? null\) : null;/.test(bodyFrom("const pickTeamLocal = (op, minStart = null) => {")), true);
  ok("the apply run reads it off the op", /const _opH=\(typeof op === "object" && op\) \? \(op\.startHour \?\? null\) : null;/.test(CODE), true);
}

console.log("\n3. THE BACKSTOP — PER OP, NOT PER RUN");
{
  // DELIBERATE DEVIATION FROM THE LITERAL INSTRUCTION, flagged rather than
  // silently taken: "go through commitLanding" would ABORT the whole run on one
  // clash, and #344 removed exactly that ("The run never aborts: per-op outcomes
  // instead"). The backstop is applied and its findings are turned into the same
  // per-op noWindow outcome the verifier already produces.
  const body = bodyFrom("const _refuse=(node,label) => {");
  ok("the verifier still asks with the hour", /_verify\.free\(pid,node\.start,node\.end,node\.startHour\?\?null\)/.test(body), true);
  ok("enforceNoOverlap runs over the run's result", /enforceNoOverlap\(/.test(CODE), true);
  ok("...and the scheduler feeds it the ops it placed",
    /const _bsIds = newSubs\.flatMap/.test(CODE), true);
  // Its findings become the SAME per-op outcome the verifier produces, and that
  // is what makes them act: `_blockedIds` is derived from `runOutcomes`, and the
  // write path already keeps a blocked op's ORIGINAL record (#344). So the
  // ordering is the assertion — pushing after `_blockedIds` was computed would
  // be a no-op that still reads correct.
  ok("...converting what it reports into per-op noWindow outcomes",
    /runOutcomes\.push\(\{ id, op: \{ id, title: "" \}, outcome: OUTCOME\.noWindow/.test(CODE), true);
  const pushAt = CODE.indexOf("runOutcomes.push({ id, op: { id, title: \"\" }, outcome: OUTCOME.noWindow");
  const blockedAt = CODE.indexOf("const _blockedIds = new Set(runOutcomes.filter");
  ok("...BEFORE _blockedIds reads runOutcomes, or they never take effect",
    pushAt > 0 && blockedAt > pushAt, true);
  ok("the run still never aborts", /return p;\s*\/\/ abort/.test(CODE), false);
}

console.log("\n4. RED PROOF — the question the old call asked");
{
  const av = schedulerAvailability(board, ctx, { excludeOpIds: [], people });
  ok("RED: the no-hour call cannot distinguish 08:00 from 14:00",
    av.free(PERSON, "2026-09-28", "2026-09-28") === av.free(PERSON, "2026-09-28", "2026-09-28"), true);
  ok("...while the hour-aware call does", av.free(PERSON, "2026-09-28", "2026-09-28", 8) !== av.free(PERSON, "2026-09-28", "2026-09-28", 14), true);
  ok("RED: no bare `free(pid, s, eDate)` three-arg call remains in the schedulers",
    /free\(pid, s, eDate\)|free\(pid,s,eDate\)/.test(CODE), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
