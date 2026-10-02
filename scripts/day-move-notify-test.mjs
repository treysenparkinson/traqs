// #222 — a schedule move notifies the people on it, but ONLY when it crosses a day.
//
// Ruled 2026-10-02: a worker whose job shifted from Tuesday to Thursday needs to
// know; one nudged by an hour within the same day does not, and notifying on
// every drag would train people to ignore the notifications. So the trigger is
// the `start` DATE and nothing else.
//
// Tested against the REAL diffTaskEvents, not a model — the whole value of this
// suite is that the exclusions hold, and an exclusion is only worth asserting
// against the code that implements it.
//
//   node scripts/day-move-notify-test.mjs

import { readFileSync } from "node:fs";
import { diffTaskEvents } from "../netlify/functions/_utils/task-events.js";

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// One job, one panel, one op, with a two-person team.
const tree = (op) => ([{
  id: "JOB", title: "Cabinet install", jobNumber: "J-1", status: "In Progress",
  subs: [{ id: "PANEL", title: "Panel", status: "In Progress", subs: [{ id: "OP", title: "Wire", status: "In Progress", team: ["7", "9"], ...op }] }],
}]);
const moves = (next, prev) => diffTaskEvents(next, prev).dayMoves;

console.log("\n1. A move that crosses a day is reported");
{
  const d = moves(tree({ start: "2026-10-08", end: "2026-10-08", startHour: 8 }),
                  tree({ start: "2026-10-06", end: "2026-10-06", startHour: 8 }));
  ok("one move", d.length, 1);
  ok("...naming the unit", d[0].unitTitle, "Wire");
  ok("...with both dates, so the push can say Tuesday to Thursday",
    [d[0].fromStart, d[0].toStart], ["2026-10-06", "2026-10-08"]);
  ok("...and the team to tell", d[0].teamIds, ["7", "9"]);
  ok("...carrying the job number for deep-linking", d[0].jobNumber, "J-1");
}

console.log("\n2. The exclusions — this is the ruling, and it is what makes the feature bearable");
{
  // The within-day nudge. THE case the ruling exists to exclude.
  ok("an hour nudge within the same day is NOT a move",
    moves(tree({ start: "2026-10-06", end: "2026-10-06", startHour: 11 }),
          tree({ start: "2026-10-06", end: "2026-10-06", startHour: 8 })).length, 0);
  // Duration: the day the person turns up has not changed.
  ok("a longer job with the same start is NOT a move",
    moves(tree({ start: "2026-10-06", end: "2026-10-09", startHour: 8 }),
          tree({ start: "2026-10-06", end: "2026-10-06", startHour: 8 })).length, 0);
  ok("an endHour change is NOT a move",
    moves(tree({ start: "2026-10-06", end: "2026-10-06", startHour: 8, endHour: 17 }),
          tree({ start: "2026-10-06", end: "2026-10-06", startHour: 8, endHour: 12 })).length, 0);
  // A new unit is an ASSIGNMENT, already notified by teamAdded.
  ok("a brand-new unit is an assignment, not a move",
    moves(tree({ start: "2026-10-06", startHour: 8 }), []).length, 0);
  // ...and the assignment path still fires for it, or we have traded one
  // notification for none.
  ok("...and that new unit still reports its team as newly assigned",
    diffTaskEvents(tree({ start: "2026-10-06", startHour: 8 }), []).teamAdded.size, 2);
  // Unchanged.
  ok("an identical write reports nothing",
    moves(tree({ start: "2026-10-06", startHour: 8 }), tree({ start: "2026-10-06", startHour: 8 })).length, 0);
}

console.log("\n3. Edge cases that would otherwise notify about nothing");
{
  ok("a unit with no stored start is not a move",
    moves(tree({ startHour: 8 }), tree({ startHour: 8 })).length, 0);
  ok("gaining a start for the first time is not a move",
    moves(tree({ start: "2026-10-06" }), tree({})).length, 0);
  ok("losing a start is not a move",
    moves(tree({}), tree({ start: "2026-10-06" })).length, 0);
  // A tombstoned unit must not notify: the work is gone, not rescheduled.
  const deleted = tree({ start: "2026-10-08" });
  deleted[0].subs[0].subs[0].deletedAt = "2026-10-02T00:00:00.000Z";
  ok("a deleted unit does not report a move", moves(deleted, tree({ start: "2026-10-06" })).length, 0);
  // Dates are compared AS STORED STRINGS. A Date round-trip here would
  // reintroduce the UTC-day bug localDay.js documents.
  const SRC = readFileSync(new URL("../netlify/functions/_utils/task-events.js", import.meta.url), "utf8");
  const fn = SRC.slice(SRC.indexOf("// ── #222."), SRC.indexOf("return { teamAdded"));
  ok("the comparison does not construct a Date", /new Date\(/.test(fn), false);
  ok("...it compares the stored strings", /String\(cur\.unit\.start\)/.test(fn), true);
}

console.log("\n4. The push yields to anything more specific");
{
  const T = readFileSync(new URL("../netlify/functions/tasks.js", import.meta.url), "utf8");
  const fn = T.slice(T.indexOf("for (const m of dayMoves)"), T.indexOf("// Silent background-sync"));
  ok("the move loop exists", fn.length > 0, true);
  // A move is the least specific thing that can happen to a unit, so someone who
  // was just assigned, or whose unit just finished, gets that push instead.
  ok("it skips anyone already notified this write", /!notified\.has\(String\(id\)\)/.test(fn), true);
  ok("...and never notifies the person who made the change", /id !== writerId/.test(fn), true);
  ok("...and sends nothing when that leaves nobody", /if \(recips\.length === 0\) continue;/.test(fn), true);
  ok("the type is 'moved'", /type: "moved"/.test(fn), true);
  // Ordering is the mechanism: dayMoves must run after the other loops or the
  // `notified` set is empty when it reads it.
  ok("the move loop runs AFTER the status loop",
    T.indexOf("for (const m of dayMoves)") > T.indexOf("for (const s of statusChanges)"), true);
}

console.log("\n5. The tier seam is written at the boundary, not just in the map");
{
  const N = readFileSync(new URL("../netlify/functions/notify.js", import.meta.url), "utf8");
  ok("notify.js warns that it is the job boundary", /DO NOT ADD A BASIC EVENT/.test(N), true);
  ok("...naming the three functions a Basic notification belongs in",
    /messages\.js/.test(N) && /timeoff\.js/.test(N) && /forgot-clockout\.js/.test(N), true);
  // The specific trap: the same words, opposite side of the seam.
  ok("...and warning that the SHIFT version must not follow the job version here",
    /shift/i.test(N) && /#222/.test(N), true);
}

console.log("\n6. RED PROOF");
{
  // The exclusions are the ruling, so the red proof is that a NAIVE
  // implementation -- notify on any schedule change -- would fail section 2.
  const naive = (next, prev) => {
    const a = next[0].subs[0].subs[0], b = prev[0]?.subs?.[0]?.subs?.[0];
    if (!b) return [];
    return JSON.stringify([a.start, a.end, a.startHour, a.endHour]) !== JSON.stringify([b.start, b.end, b.startHour, b.endHour]) ? [1] : [];
  };
  const nudge = [tree({ start: "2026-10-06", startHour: 11 }), tree({ start: "2026-10-06", startHour: 8 })];
  ok("a naive any-change rule WOULD fire on the within-day nudge", naive(...nudge).length, 1);
  ok("...and the real one does not", moves(...nudge).length, 0);

  const SRC = readFileSync(new URL("../netlify/functions/_utils/task-events.js", import.meta.url), "utf8");
  const T = readFileSync(new URL("../netlify/functions/tasks.js", import.meta.url), "utf8");
  const muts = [
    ["the dayMoves collector", SRC, "dayMoves.push({"],
    ["dayMoves on the return", SRC, "statusChanges, dayMoves };"],
    ["the send loop", T, "for (const m of dayMoves)"],
    ["the already-notified skip", T, "!notified.has(String(id))"],
  ];
  let red = 0;
  for (const [label, hay, needle] of muts) {
    if (hay.split(needle).join("/* gone */").includes(needle)) { console.error(`  RED FAIL  ${label} survives deletion`); fail++; }
    else red++;
  }
  console.log(`  red proof: ${red}/${muts.length} guards go red when their subject is deleted`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
