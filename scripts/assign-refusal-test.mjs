// #424 — an assignment is checked the way a drag is, minus the checks that are
// about MOVING.
//
// `commitAssign` — the Jobs-list assignee cell and the `+ Assign` popover — built
// a mover with `reassigned: true` and went straight to `commitLanding`, the
// overlap backstop, never calling `refuseLanding`. One of refuseDragMove's layers
// reached it: the active-clock guard #393 lifted into the commit by hand.
//
//   layer                  drag   commitAssign (before)
//   record                 yes    no
//   active clock           yes    YES (isReplannable)
//   department             yes    no
//   time off               yes    no
//   past                   yes    no
//   overlap                yes    yes (commitLanding)
//
// MEASURED: of 414 (constrained op x person) pairs on Matrix, 353 (85.3%) are
// cross-department. Every one is refused if you drag the bar and accepted
// silently from the assignee cell.
//
// TWO OF THE FOUR DO NOT TRANSFER, and that is the substance of this suite:
//
//   RECORD is drag-layer state. `isRecord` is set on the GRABBED BAR — "a
//   cross-row bar, a record of work done" — not on an op. commitAssign has no bar
//   and nothing to pass; forcing it would mean inventing a flag.
//
//   PAST tests the LANDING DATE (`m.to.start < nowDay`). An assignment does not
//   change dates, so applying it as-is would refuse EVERY reassignment of every
//   already-started op — including correcting who actually did last week's work.
//   That is not what the rule is for.
//
// So the fix is not "call refuseLanding from commitAssign" alone. Both date-shaped
// rules are made conditional on the dates ACTUALLY MOVING, which is derived from
// the mover rather than passed as a flag — a `past` refusal for something that is
// not moving in time is wrong on every caller, not just this one.
//
//   node scripts/assign-refusal-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import * as D from "../src/dragMove.js";
import { overlapContext } from "../src/overlapRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// Newlines normalised on every read. `eol-safety-test` enforces it, because a
// multi-line pattern silently never matches against CRLF on disk.
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const octx = overlapContext(SETTINGS, "2026-09-30");
const PEOPLE = [
  { id: "wire1", name: "Wendy", departments: ["Wire"] },
  { id: "cut1", name: "Carl", departments: ["Cut"] },
  { id: "any1", name: "Avery", departments: [] },
];
const tasksWith = (op) => [{ id: "j1", title: "Job", subs: [{ id: "p1", title: "Panel", subs: [op] }] }];
const ctxFor = (tasks, over = {}) => ({
  isLocked: () => false, isLive: () => false, isOverdue: () => false, timeOff: () => [],
  nowDay: "2026-09-30", nowHour: 10, business: true, tasks, overlapCtx: octx, people: PEOPLE, ...over,
});
// What commitAssign builds: same dates on both sides, only the crew differs.
const assignMover = (op, nextTeam) => {
  const at = { start: op.start, end: op.end, startHour: op.startHour ?? null, endHour: op.endHour ?? null };
  return [{ id: String(op.id), node: op, reassigned: true,
    from: { ...at, team: op.team || [] }, to: { ...at, team: nextTeam } }];
};
const OP = (extra = {}) => ({ id: "o1", title: "Op", start: "2026-10-01", end: "2026-10-01", startHour: 8, hpd: 4, team: ["wire1"], ...extra });

console.log("\n1. DEPARTMENT — the layer this whole pass exists for");
{
  const op = OP({ requiredDepartments: ["Wire"] });
  const t = tasksWith(op);
  // REWRITTEN 2026-10-07 by #427, which reversed the ruling: a cross-department
  // assignment is no longer REFUSED, it rewrites the op's department to where the
  // work went. What #424 delivered is unchanged and is still what these assert —
  // the department layer REACHES this path at all. New rule, not the old one with
  // its answer flipped (R3).
  ok("assigning someone OUT of department is no longer refused",
    D.refuseDragMove(assignMover(op, ["cut1"]), ctxFor(t)), null);
  ok("...the department follows the work instead",
    D.applyDragMove(t, assignMover(op, ["cut1"]), { date: "d", movedBy: "m", people: PEOPLE })[0]
      .subs[0].subs[0].requiredDepartments, ["Cut"]);
  ok("someone IN department is allowed", D.refuseDragMove(assignMover(op, ["wire1"]), ctxFor(t)), null);
  ok("an unconstrained op takes anyone",
    D.refuseDragMove(assignMover(OP(), ["cut1"]), ctxFor(tasksWith(OP()))), null);
  // Already on the team and out of department: not an ADDED person, so not refused.
  const mixed = OP({ requiredDepartments: ["Wire"], team: ["cut1"] });
  ok("a member already on it is not re-judged",
    D.refuseDragMove(assignMover(mixed, ["cut1", "wire1"]), ctxFor(tasksWith(mixed))), null);
}

console.log("\n2. TIME OFF — applies, but only to what the edit actually changes");
{
  const op = OP();
  const t = tasksWith(op);
  const off = (pid) => ctxFor(t, { timeOff: (p) => (p === pid ? [{ start: "2026-10-01", end: "2026-10-01", reason: "PTO" }] : []) });
  ok("RED: assigning someone who is OFF that day is refused",
    D.refuseDragMove(assignMover(op, ["cut1"]), off("cut1"))?.kind, "pto");
  ok("...and is fine when they are off a different day",
    D.refuseDragMove(assignMover(op, ["cut1"]), ctxFor(t, { timeOff: () => [{ start: "2026-10-05", end: "2026-10-05" }] })), null);
  // THE CASE THAT MAKES THIS CONDITIONAL. The dates are not changing, so a member
  // who was already on the op is not newly colliding with their own leave — and
  // refusing here would block an edit that does not touch them at all.
  ok("a member ALREADY on it, on leave, does not refuse an unrelated crew change",
    D.refuseDragMove(assignMover(op, ["wire1", "cut1"]), off("wire1"))?.kind, undefined);
  // ...but on a DRAG the dates do change, so everyone is re-judged against them.
  const moved = [{ id: "o1", node: op, reassigned: false,
    from: { start: "2026-10-01", end: "2026-10-01", startHour: 8, endHour: null, team: ["wire1"] },
    to: { start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: null, team: ["wire1"] } }];
  ok("...while a MOVE onto their leave still refuses, same person, unchanged team",
    D.refuseDragMove(moved, ctxFor(t, { timeOff: (p) => (p === "wire1" ? [{ start: "2026-10-05", end: "2026-10-05" }] : []) }))?.kind, "pto");
  // A RESIZE IS A CHANGE TO WHEN, even when the start never moves. `resize-test`
  // caught this: growing an op across its own assignee's day off stopped being
  // refused while "did the dates move" meant start/end/startHour alone.
  const grown = [{ id: "o1", node: op, reassigned: false,
    from: { start: "2026-10-01", end: "2026-10-01", startHour: 8, endHour: 10, team: ["wire1"], hpd: 2 },
    to: { start: "2026-10-01", end: "2026-10-01", startHour: 8, endHour: 16, team: ["wire1"], hpd: 8 } }];
  ok("a RESIZE over the assignee's own leave still refuses",
    D.refuseDragMove(grown, off("wire1"))?.kind, "pto");
  const sameSize = [{ id: "o1", node: op, reassigned: false,
    from: { start: "2026-10-01", end: "2026-10-01", startHour: 8, endHour: 10, team: ["wire1"], hpd: 2 },
    to: { start: "2026-10-01", end: "2026-10-01", startHour: 8, endHour: 10, team: ["wire1"], hpd: 2 } }];
  ok("...and an identical no-op does not", D.refuseDragMove(sameSize, off("wire1")), null);
}

console.log("\n3. PAST — does NOT transfer, because an assignment moves nothing in time");
{
  // The op already started. Correcting who did it must not be refused as "the past".
  const old = OP({ start: "2026-09-01", end: "2026-09-01" });
  const t = tasksWith(old);
  ok("RED: reassigning an op that already started is NOT refused as the past",
    D.refuseDragMove(assignMover(old, ["any1"]), ctxFor(t)), null);
  ok("...nor is a no-op re-save of it", D.refuseDragMove(assignMover(old, ["wire1"]), ctxFor(t)), null);
  // ...and the rule still does its job when something really is being moved back.
  const back = [{ id: "o1", node: old, reassigned: false,
    from: { start: "2026-10-01", end: "2026-10-01", startHour: 8, endHour: null, team: ["wire1"] },
    to: { start: "2026-09-01", end: "2026-09-01", startHour: 8, endHour: null, team: ["wire1"] } }];
  ok("a real move into the past is still refused", D.refuseDragMove(back, ctxFor(t))?.kind, "past");
  // An hour-only move backwards on the same day is still a move.
  const earlier = [{ id: "o1", node: OP({ start: "2026-09-30" }), reassigned: false,
    from: { start: "2026-09-30", end: "2026-09-30", startHour: 11, endHour: null, team: ["wire1"] },
    to: { start: "2026-09-30", end: "2026-09-30", startHour: 8, endHour: null, team: ["wire1"] } }];
  ok("...including an hour-only move back past now", D.refuseDragMove(earlier, ctxFor(t))?.kind, "past");
  // A mover with no `from` cannot be shown to be standing still, so it is checked.
  const noFrom = [{ id: "o1", node: old, to: { start: "2026-09-01", end: "2026-09-01", startHour: 8, team: ["wire1"] } }];
  ok("a mover with no `from` is treated as moving, not as standing still",
    D.refuseDragMove(noFrom, ctxFor(t))?.kind, "past");
}

console.log("\n4. RECORD — does not transfer either, and there is nothing to pass");
{
  // `isRecord` is set on the grabbed BAR by planDragMove, never read off an op.
  const src = read("../src/dragMove.js");
  ok("isRecord is read from the grabbed bar, not the node",
    /isRecord: !!m\.isRecord/.test(src), true);
  ok("...and refuseDragMove still refuses one when a drag supplies it",
    D.refuseDragMove([{ id: "o1", node: OP(), isRecord: true, from: {}, to: { start: "2026-10-01", end: "2026-10-01", team: [] } }], ctxFor(tasksWith(OP())))?.kind, "record");
  ok("an assign mover carries no isRecord, so the layer is silent",
    D.refuseDragMove(assignMover(OP(), ["wire1"]), ctxFor(tasksWith(OP()))), null);
}

console.log("\n5. IT IS WIRED — commitAssign runs the chain");
{
  const CODE = codeOf(read("../src/TRAQS.jsx"));
  const at = CODE.indexOf("const commitAssign = (op, nextTeam) => {");
  ok("commitAssign was found", at > 0, true);
  const body = at > 0 ? CODE.slice(at, CODE.indexOf("const commitDates =", at)) : "";
  ok("RED: it calls refuseLanding", /const refusal = refuseLanding\(/.test(body), true);
  ok("...and shows the refusal instead of committing",
    /if \(refusal\) \{ showLandingRefusal\(refusal\); return false; \}/.test(body), true);
  // ORDERING ASSERTIONS MUST REQUIRE BOTH ENDS. `indexOf` returns -1 when absent,
  // and -1 is less than everything, so "A comes before B" is green whenever A is
  // MISSING — which is exactly the state this suite was written to catch. The
  // first version of this line passed on the unfixed code.
  const order = (a, b) => { const i = body.indexOf(a), j = body.indexOf(b); return i >= 0 && j >= 0 && i < j; };
  ok("...before commitLanding, not after", order("refuseLanding(", "commitLanding("), true);
  ok("the active-clock guard it already had is kept", /isReplannable\(op, people\)/.test(body), true);
  ok("...and still runs first, so its specific message survives",
    order("isReplannable(", "refuseLanding("), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
