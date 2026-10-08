// #460 — the finish-approval card read payroll hours, and it is the number an
// admin approves against.
//
// Four surfaces computed "hours on this op" from `timeclock` rows whose
// `jobRefs` mention it. Two of them print `{h} logged` on a Finish Requests
// card; the other two resolve `lastWorker`, the PERSON named on that card.
//
// `jobRefs` WAS NEVER THE RIGHT SOURCE, AND THE CODEBASE ALREADY SAID SO. #188's
// note, still in `finishedOpFields`: "this read PAYROLL entries — `timeclock`
// rows whose jobRefs mention the op — and summed their `hours`, which is the
// whole SHIFT, counted once per job the worker picked at clock-in … an op
// worked for 2h inside an 8h shift was recorded as having taken 8." #188 fixed
// the WRITE and left four READS, so this was the fifth implementation of "hours
// on an op" and the only one with an approve button beside it.
//
// MEASURED 2026-10-08: `timeclock.json` has 177 rows of which 5 carry a
// non-empty `jobRefs`, reaching 4 ops and 30.59 h. `productionhours.json` has
// 270 rows, 55 ops, 1,109.54 h. The card could see 2.8% of the hours that exist,
// and across every op with hours the two formulas disagreed 31 of 31 — the card
// read 0.00h where the rest of the app read 5.16h, 24.00h, 53.03h.
//
// TWO FAILURE MODES, NEITHER RIGHT: `jobRefs` empty (172 of 177 rows) gives
// ZERO; `jobRefs` populated gives THE WHOLE SHIFT.
//
//   node scripts/finish-approval-hours-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { producedHoursByScope, lastWorkedByScope } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));

console.log("\n1. RED PROOF — no surface reads hours or a worker from payroll jobRefs");
{
  // The exact shapes that were there. A grep for `jobRefs` alone would be wrong:
  // the field is legitimate for "which jobs did this person pick at clock-in",
  // which is what the live-status chips and the timesheet rows render.
  ok("no hours are summed from jobRefs",
    /timeclock\.filter\(e => e\.jobRefs\?\.some\(r => r\.opId === op\.id\)\)\s*\.reduce/.test(CODE.replace(/\s+/g, " ")), false);
  ok("no worker is resolved from the last jobRefs row",
    /\[\.\.\.timeclock\]\.reverse\(\)\.find\(e => e\.jobRefs\?\.some\(r => r\.opId === op\.id\)\)/.test(CODE), false);
  ok("...and no `.reduce` over a jobRefs filter survives at all",
    /jobRefs[^\n]{0,80}\.reduce\(/.test(CODE), false);

  // What jobRefs IS still for, which must NOT be swept away with it.
  ok("the live-status chip still reads a person's picked jobs",
    /p\.activeClockIn\?\.jobRefs \|\| \[\]/.test(CODE), true);
  ok("...and the timesheet row still lists them", /\(e\.jobRefs \|\| \[\]\)\.map/.test(CODE), true);
}

console.log("\n2. THE CARDS USE THE ONE SHARED ANSWER");
{
  // `_opHoursPair` is the canonical implementation and already carries the
  // reasoning: "Logged = JOB-clock time recorded against THIS op — NOT payroll
  // hours." Using it is what stops this being a sixth implementation.
  const uses = (CODE.match(/_opHoursPair\(op\)\.logged/g) || []).length;
  ok("both Finish Requests cards take their hours from _opHoursPair", uses >= 2, true);
  ok("the shared helper still exists exactly once",
    (CODE.match(/const _opHoursPair = \(op\) =>/g) || []).length, 1);
  ok("both cards resolve the worker through the shared lookup",
    (CODE.match(/lastWorkerFor\(op\)/g) || []).length >= 2, true);
  ok("the worker lookup exists exactly once",
    (CODE.match(/const lastWorkerFor = /g) || []).length, 1);
}

console.log("\n3. lastWorkedByScope — the lookup, scoped like producedHoursByScope");
{
  const rows = [
    { personId: "a", jobId: "J", panelId: "P", opId: "O1", hours: 2, clockOut: "2026-10-01T10:00:00Z" },
    { personId: "b", jobId: "J", panelId: "P", opId: "O1", hours: 3, clockOut: "2026-10-03T10:00:00Z" },
    { personId: "c", jobId: "J", panelId: "P", opId: null, hours: 4, clockOut: "2026-10-05T10:00:00Z" },
  ];
  const s = lastWorkedByScope(rows);
  ok("the most recent session on an op wins", s.byOp.get("O1"), "b");
  ok("...not the first one in the array", s.byOp.get("O1") !== "a", true);
  // Hours are recorded against whatever somebody clocked into, so a panel-level
  // session has a null opId. The scope fallback is the same one `producedFor`
  // uses, or a panel-level clock-in would name nobody.
  ok("a panel-level session is reachable at panel scope", s.byPanel.get("P"), "c");
  ok("...and at job scope", s.byJob.get("J"), "c");
  ok("an unknown id is nobody", s.byOp.get("nope"), undefined);

  // Ordering is by when the work ENDED. A row still running has no clockOut and
  // must not be treated as the oldest.
  const running = lastWorkedByScope([
    { personId: "x", opId: "O", hours: 1, clockOut: "2026-10-01T00:00:00Z" },
    { personId: "y", opId: "O", hours: 0, clockIn: "2026-10-09T00:00:00Z" },
  ]);
  ok("a session still running is the most recent", running.byOp.get("O"), "y");

  ok("junk does not throw", [lastWorkedByScope(null).byOp.size, lastWorkedByScope([null, {}]).byOp.size], [0, 0]);
  ok("a tombstoned row is ignored",
    lastWorkedByScope([{ personId: "z", opId: "O", deletedAt: "x", clockOut: "2026-10-09T00:00:00Z" }]).byOp.get("O"), undefined);
  // It must agree with producedHoursByScope about WHICH ids exist, or one card
  // shows hours against a name the other cannot find.
  const h = producedHoursByScope(rows), w = lastWorkedByScope(rows);
  ok("the two scopes index the same ops", [...h.byOp.keys()].sort(), [...w.byOp.keys()].sort());
  ok("...and the same panels", [...h.byPanel.keys()].sort(), [...w.byPanel.keys()].sort());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
