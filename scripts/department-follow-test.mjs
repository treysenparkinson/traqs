// Department follows the work (#427). Reverses root cause 7 chunk B.
//
// A drop that put someone outside the op's required department on it used to be
// REFUSED and the department named. It now SUCCEEDS and the op's department
// becomes where the work went: if it moves to someone in Cut, it is Cut work.
//
// THREE RULINGS, each with the reasoning that decided it:
//
//   REPLACE, NOT UNION. Union produces a value nobody can read as intent —
//   "Wire or Cut or Layout" is indistinguishable from someone having ticked three
//   boxes. Replace keeps one meaning: this is where the work went. The replaced
//   set goes in the moveLog, and THAT is the whole difference from #341, which
//   wrote a guess into the data and left nowhere to look afterwards.
//
//   THE OP ONLY. Its panel and job are untouched. Nothing inherits today (#425:
//   23 ops state their own, zero inherit), so this is the first thing that will
//   ever exercise the precedence rule — see #426 for the trap that creates.
//
//   ON THE REFUSAL PATH ONLY. A drop onto an op that said "anyone" writes
//   NOTHING. Narrowing a stated department in the direction the work went is
//   editing a fact; creating one on an unconstrained op is inventing a constraint
//   from a gesture, and 89 of Matrix's 112 ops (79%) would acquire one a drag at
//   a time. Different operations wearing the same gesture, and only one persists.
//
//   node scripts/department-follow-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import * as D from "../src/dragMove.js";
import { overlapContext } from "../src/overlapRules.js";
import { unitDepartments } from "../src/scheduleRules.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const octx = overlapContext(SETTINGS, "2026-09-30");
const PEOPLE = [
  { id: "wire1", name: "Wendy", departments: ["Wire"] },
  { id: "cut1", name: "Carl", departments: ["Cut"] },
  { id: "both1", name: "Billie", departments: ["Cut", "Layout"] },
  { id: "free1", name: "Avery", departments: [] },
];
const OP = (extra = {}) => ({ id: "o1", title: "Op", start: "2026-10-01", end: "2026-10-01", startHour: 8, hpd: 4, team: ["wire1"], ...extra });
const tree = (op, panelExtra = {}, jobExtra = {}) =>
  [{ id: "j1", title: "Job", ...jobExtra, subs: [{ id: "p1", title: "Panel", ...panelExtra, subs: [op] }] }];
const assign = (op, nextTeam) => {
  const at = { start: op.start, end: op.end, startHour: op.startHour ?? null, endHour: op.endHour ?? null };
  return [{ id: String(op.id), node: op, reassigned: true,
    from: { ...at, team: op.team || [] }, to: { ...at, team: nextTeam } }];
};
const apply = (op, nextTeam, opts = {}) => D.applyDragMove(opts.tasks || tree(op), assign(op, nextTeam),
  { date: "2026-10-01", movedBy: "Trey", reason: "Assigned", people: PEOPLE, ...opts });
const opOf = (t) => t[0].subs[0].subs[0];

console.log("\n1. THE DROP SUCCEEDS, AND THE DEPARTMENT FOLLOWS");
{
  const op = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire" });
  const ctx = { isLocked: () => false, isLive: () => false, isOverdue: () => false, timeOff: () => [],
    nowDay: "2026-09-30", nowHour: 10, business: true, tasks: tree(op), overlapCtx: octx, people: PEOPLE };
  // RED: this returned { kind: "department" }.
  ok("RED: a cross-department assignment is no longer refused", D.refuseDragMove(assign(op, ["cut1"]), ctx), null);
  const out = opOf(apply(op, ["cut1"]));
  ok("RED: the op's department becomes the one the work went to", out.requiredDepartments, ["Cut"]);
  ok("...and the team is written", out.team, ["cut1"]);
  // The legacy string trails the array so iOS keeps decoding (scheduleRules).
  ok("...and the legacy single value trails it", out.requiredDepartment, "Cut");
}

console.log("\n2. REPLACE, NOT UNION");
{
  const op = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire" });
  ok("the old department is GONE, not kept beside the new one", opOf(apply(op, ["cut1"])).requiredDepartments, ["Cut"]);
  // A person holding two departments gives both — that is their statement, not a
  // merge with the op's old one.
  ok("a person in two departments gives both", opOf(apply(op, ["both1"])).requiredDepartments, ["Cut", "Layout"]);
  ok("...and still not the old one", opOf(apply(op, ["both1"])).requiredDepartments.includes("Wire"), false);
}

console.log("\n3. THE REPLACED SET IS RECORDED — the whole difference from #341");
{
  const op = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire" });
  const entry = opOf(apply(op, ["cut1"])).moveLog.at(-1);
  ok("the moveLog says what it was", entry.fromDepartments, ["Wire"]);
  ok("...and what it became", entry.toDepartments, ["Cut"]);
  ok("...alongside the crew change that caused it", [entry.fromTeam, entry.toTeam], [["wire1"], ["cut1"]]);
  // A move that changes no department carries neither key, so the log does not
  // fill with noise that reads like a change.
  const plain = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire" });
  const same = opOf(apply(plain, ["wire1"])).moveLog.at(-1);
  ok("a move that changes nothing records no department keys",
    ["fromDepartments", "toDepartments"].filter(k => k in same), []);
}

console.log("\n4. ON THE REFUSAL PATH ONLY — an unconstrained op is left alone");
{
  // 89 of Matrix's 112 ops say nothing. A gesture must not give them a constraint.
  const free = OP();
  const out = opOf(apply(free, ["cut1"]));
  ok("an op that said ANYONE still says anyone", out.requiredDepartments, undefined);
  ok("...and gains no legacy value either", out.requiredDepartment, undefined);
  ok("...and its moveLog records no department change",
    ["fromDepartments", "toDepartments"].filter(k => k in out.moveLog.at(-1)), []);
  ok("...but the team still moved", out.team, ["cut1"]);
  // An in-department drop changes nothing either.
  const okDrop = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire" });
  ok("a drop onto someone already IN the department rewrites nothing",
    opOf(apply(okDrop, ["wire1"])).requiredDepartments, ["Wire"]);
}

console.log("\n5. THE OP ONLY — its panel and job are untouched");
{
  const op = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire" });
  const t = apply(op, ["cut1"], { tasks: tree(op, { requiredDepartments: ["Wire"], requiredDepartment: "Wire" }) });
  ok("the op changed", t[0].subs[0].subs[0].requiredDepartments, ["Cut"]);
  ok("the PANEL did not", t[0].subs[0].requiredDepartments, ["Wire"]);
  ok("...nor its legacy value", t[0].subs[0].requiredDepartment, "Wire");
  // An op whose department is INHERITED gains its own — the condition reads the
  // effective set, the write lands on the op. Nothing inherits on live data
  // (#425), so this is the first thing that would ever exercise it (#426).
  const bare = OP();
  const inh = apply(bare, ["cut1"], { tasks: tree(bare, { requiredDepartments: ["Wire"], requiredDepartment: "Wire" }) });
  ok("an op inheriting from its panel gains its OWN value", inh[0].subs[0].subs[0].requiredDepartments, ["Cut"]);
  ok("...and the panel still says what it said", inh[0].subs[0].requiredDepartments, ["Wire"]);
  ok("...so unitDepartments now resolves them differently (#426)",
    [unitDepartments(inh[0].subs[0].subs[0], inh[0].subs[0], inh[0]), unitDepartments({}, inh[0].subs[0], inh[0])],
    [["Cut"], ["Wire"]]);
}

console.log("\n6. EDGES THAT MUST NOT THROW OR INVENT");
{
  const op = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire" });
  ok("no people supplied — nothing is rewritten",
    opOf(D.applyDragMove(tree(op), assign(op, ["cut1"]), { date: "d", movedBy: "m" })).requiredDepartments, ["Wire"]);
  ok("an unknown person id rewrites nothing",
    opOf(apply(op, ["ghost"])).requiredDepartments, ["Wire"]);
  // Dropping on somebody with NO department WIDENS the op to "anyone", which is
  // the one case that removes a constraint rather than narrowing. Coherent — the
  // work went to someone unrestricted — and unreachable on Matrix, where all 18
  // people hold exactly one department.
  ok("a person with no department widens the op to anyone",
    opOf(apply(op, ["free1"])).requiredDepartments, []);
  ok("...and that is recorded too", opOf(apply(op, ["free1"])).moveLog.at(-1).toDepartments, []);
  // A move that is not a reassignment never touches departments. THE TEAMS HERE
  // DIFFER DELIBERATELY: applyDragMove only writes `team` when `reassigned`, so a
  // mover carrying a different `to.team` without the flag must not change the
  // department either — it would rewrite a constraint while leaving the crew
  // alone. A fixture with the SAME team on both sides proved nothing, because the
  // added-people filter already empties it.
  const notReassigned = [{ id: "o1", node: op, reassigned: false,
    from: { start: "2026-10-01", end: "2026-10-01", startHour: 8, endHour: null, team: ["wire1"] },
    to: { start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: null, team: ["cut1"] } }];
  const nrOut = opOf(D.applyDragMove(tree(op), notReassigned, { date: "d", movedBy: "m", people: PEOPLE }));
  ok("a move that is not a reassignment leaves the department alone", nrOut.requiredDepartments, ["Wire"]);
  ok("...and leaves the team alone too", nrOut.team, ["wire1"]);
  // SOMEBODY ALREADY ON THE OP IS NOT RE-JUDGED. The op has been out of department
  // since before this edit; adding an in-department person must not rewrite it on
  // the strength of the one who was already there.
  const stale = OP({ requiredDepartments: ["Wire"], requiredDepartment: "Wire", team: ["cut1"] });
  ok("an existing out-of-department member does not trigger a rewrite",
    opOf(apply(stale, ["cut1", "wire1"])).requiredDepartments, ["Wire"]);
  ok("...and the newly added in-department person is simply added",
    opOf(apply(stale, ["cut1", "wire1"])).team, ["cut1", "wire1"]);
}

console.log("\n7. THE REFUSAL IS GONE, AND SO IS ITS MESSAGE");
{
  const src = read("../src/dragMove.js");
  ok("refuseDragMove no longer returns a department refusal", /kind: "department"/.test(src), false);
  ok("...and refusalMessage no longer has a case for one", /case "department":/.test(src), false);
  // R3: when the behaviour goes, the thing that invoked it goes with it.
  ok("the message text is gone too", /isn't in \$\{r\.department\}/.test(src), false);
}

console.log("\n8. EVERY CALLER PASSES people, OR THE REWRITE SILENTLY DOES NOT HAPPEN");
{
  // This is the failure mode the change creates: the refusal is deleted, so a
  // caller that does not pass `people` accepts the drop AND leaves the department
  // stale — a third behaviour, worse than either of the two we had.
  const CODE = codeOf(read("../src/TRAQS.jsx"));
  // A WINDOW FROM EACH CALL, not a pattern that assumes the shape around it. The
  // first version required a trailing `))`, which only the three wrapped in
  // recalcBounds have — so it found 3, and "every one passes people" was green
  // over those 3 while three others were untouched. The COUNT assertion is what
  // caught it (LESSONS #14): a filter over a short list reports nothing wrong.
  const calls = [];
  for (let i = CODE.indexOf("applyDragMove("); i >= 0; i = CODE.indexOf("applyDragMove(", i + 1))
    calls.push(CODE.slice(i, i + 300));
  ok("all six call sites were found", calls.length, 6);
  ok("every one passes people", calls.filter(c => !/\bpeople\b/.test(c)).length, 0);
}

console.log("\n9. THE SERVER ACCEPTS IT — checked, not assumed");
{
  // scheduleRules' department rule reads the INCOMING node, so the new set and the
  // new team arrive together and agree. A rule that compared against the STORED
  // department would reject every rewrite and the feature would fail on write.
  const rules = read("../src/scheduleRules.js");
  ok("the server reads the incoming node's departments",
    /const depts = unitDepartments\(n, after\.panel, after\.job\);/.test(rules), true);
  ok("...not the stored copy's", /const depts = unitDepartments\(before\./.test(rules), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
