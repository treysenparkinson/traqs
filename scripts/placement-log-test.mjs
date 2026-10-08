#!/usr/bin/env node
// #494. THE FOUR WRITERS THAT MOVED WORK WITHOUT SAYING SO.
//
// #492 measured the moveLog at 14% coverage: of 36 leaf units that moved in four
// months, 31 left no trace. The writers responsible were named there, and this
// gives each of them an entry:
//
//   1. the scheduler run's Apply   one entry per op, sharing a runId
//   2. the AI's update_job / update_operation
//   3. updTask's parent->child date cascade   ONE entry, on the parent
//   4. the wizard's override-start path       per op, not just the panel
//
// ONE ENTRY PER OP, NOT ONE PER RUN, on Trey's ruling: the log's unit is "this
// op moved from A to B" everywhere else, and a run-level entry would be the
// first thing in it that cannot answer "where did this bar come from". The
// `runId` is what makes twenty entries readable as one action.
//
// `placementEntry` is the shared shape. `moveLogEntry` could not be reused: it
// takes a MOVER from planDragMove with `from`/`to` branches, and none of these
// four has one — they have a node before and a node after.
//
//   node scripts/placement-log-test.mjs
import { readFileSync } from "node:fs";
import { placementEntry, moveLogEntry } from "../src/dragMove.js";
import { codeOf } from "./_code-view.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(SRC);

const was = { id: "o1", start: "2026-09-01", end: "2026-09-03", startHour: 8, endHour: 15, hpd: 8, team: ["p1"] };
const now = { id: "o1", start: "2026-10-05", end: "2026-10-08", startHour: 9, endHour: 16, hpd: 8, team: ["p1"] };

console.log("\n1. THE SHARED ENTRY SHAPE");
{
  const e = placementEntry(was, now, { date: "2026-10-08", movedBy: "Scheduler", reason: "Scheduled", runId: "r1" });
  ok("it states where the op came FROM", [e.fromStart, e.fromEnd], ["2026-09-01", "2026-09-03"]);
  ok("...and where it went TO", [e.toStart, e.toEnd], ["2026-10-05", "2026-10-08"]);
  ok("...with the hours on both sides", [e.fromStartHour, e.toStartHour, e.fromEndHour, e.toEndHour], [8, 9, 15, 16]);
  ok("...who and when", [e.movedBy, e.date], ["Scheduler", "2026-10-08"]);
  ok("...and why", e.reason, "Scheduled");
  ok("the runId rides on the entry", e.runId, "r1");
  // #458's lesson: the detail fields are what a narrowing client eats, so the
  // shape must match what moveLogEntry writes or the guard protects two shapes.
  const drag = moveLogEntry({ from: was, to: now }, { date: "2026-10-08", movedBy: "Trey" });
  ok("it is the SAME SHAPE the drag writes",
    Object.keys(e).filter(k => k !== "runId").sort(), Object.keys(drag).sort());
}

console.log("\n2. WHAT IT MUST NOT DO");
{
  // No runId on a single-op gesture — a drag needs none, and 22 bytes on every
  // entry that cannot use them is the kind of cost #493 counted.
  const e = placementEntry(was, now, { date: "d", movedBy: "m" });
  ok("no runId means no key, not an empty one", "runId" in e, false);
  // A team change is only recorded when it IS a change, matching moveLogEntry.
  ok("an unchanged team is not reported as a reassignment", "fromTeam" in e, false);
  const re = placementEntry(was, { ...now, team: ["p2"] }, { date: "d", movedBy: "m" });
  ok("...and a changed one is", [re.fromTeam, re.toTeam], [["p1"], ["p2"]]);
  // An op that did not move must not produce an entry at all — that is what
  // turns a log into noise, and #493 counted the bytes.
  ok("a node that did not move yields null", placementEntry(was, { ...was }, { date: "d", movedBy: "m" }), null);
  ok("...and an hour-only change still counts as a move",
    placementEntry(was, { ...was, startHour: 10 }, { date: "d", movedBy: "m" })?.toStartHour, 10);
  ok("a missing before-node does not throw", placementEntry(null, now, { date: "d", movedBy: "m" })?.toStart, "2026-10-05");
}

console.log("\n3. THE FOUR WRITERS ARE WIRED");
{
  // Pinned per writer. A count would be green with the wrong four (R4).
  // THE CALL SITE, NOT THE HELPER'S BODY. Five mutants survived the first run
  // because every assertion here pinned the `placementEntry(...)` inside the
  // helper — which a mutant removing the CALL does not touch. R4 for the fourth
  // time: asserting that a thing is defined is not asserting that it runs.
  ok("1. the scheduler's helper builds the entry with the run's id",
    /placementEntry\(was, op, \{ date: TD, movedBy: _schedBy, reason: "Scheduled by the planner", runId: _runId \}\)/.test(CODE), true);
  ok("...and the replan branch CALLS it", /return _logPlace\(was, _strip\(op\)\);/.test(CODE), true);
  ok("...and so does the full-schedule branch",
    /subs: \(pn\.subs\|\|\[\]\)\.map\(o => _logPlace\(_wasOps\.get\(String\(o\.id\)\), _strip\(o\)\)\) \}\)\);/.test(CODE), true);
  ok("...and it APPENDS rather than replacing",
    /return e \? \{ \.\.\.op, moveLog: \[\.\.\.\(op\.moveLog \|\| \[\]\), e\] \} : op;/.test(CODE), true);
  ok("...and the run's id is minted once for the whole run",
    /const _runId = uid\(\);/.test(CODE), true);
  ok("2. the AI path logs a job's date change",
    /placementEntry\(_wasJob, \{ \.\.\._wasJob, \.\.\.upd \}, \{ date: TD, movedBy: _aiBy, reason: "Moved by TRAQS AI" \}\)/.test(CODE), true);
  ok("...and an operation's",
    /placementEntry\(_wasOp, \{ \.\.\._wasOp, \.\.\.opUpd \}, \{ date: TD, movedBy: _aiBy, reason: "Moved by TRAQS AI" \}\)/.test(CODE), true);
  ok("3. updTask's cascade logs ONCE, on the parent",
    /placementEntry\(t, updated, \{ date: TD, movedBy: _by, reason: "Moved with its parent" \}\)/.test(CODE), true);
  // ...and only when the caller did not already write one, or a single AI date
  // change produces two entries for one action.
  ok("...and defers to a caller that already wrote one",
    /if \(upd\.moveLog === undefined\) \{/.test(CODE), true);
  ok("4. the override builds an entry for each op it places",
    /placementEntry\(sub, _placed, \{ date: TD, movedBy: _ovBy, reason: "Override start date", runId: _ovRunId \}\)/.test(CODE), true);
  ok("...and PUSHES the logged op, not the bare one",
    /placedSubs\.push\(_oe \? \{ \.\.\._placed, moveLog: \[\.\.\.\(sub\.moveLog \|\| \[\]\), _oe\] \} : _placed\);/.test(CODE), true);
  ok("...and the panel's own entry survives alongside them", /overrideEntry/.test(CODE), true);
}

console.log("\n4. EVERY ENTRY IS APPENDED, NEVER REPLACED");
{
  // #465's rule is that stored entries survive. A writer that assigns moveLog
  // instead of appending would be refused by the server and lose the history.
  const appends = CODE.match(/moveLog: \[\.\.\.\((\w+)\.moveLog \|\| \[\]\), /g) || [];
  ok("every new writer appends to what is there", appends.length >= 5, true);
  ok("no writer assigns a bare one-entry moveLog on an existing node",
    /moveLog: \[placementEntry\(/.test(CODE), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
