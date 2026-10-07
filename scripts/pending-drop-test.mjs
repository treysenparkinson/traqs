// #414 — handlePendingItemDrop, the last schedule-field writer outside the
// shared commits. And #436, the dedupe that compares with `===`.
//
// THE TRAY wrote `start`, `end`, `team` and `status` with a bare `setTasks` tree
// map: no refusal chain, no overlap backstop, no moveLog, no recalcBounds, and
// no department follow. Five layers every other schedule writer goes through.
//
// ─── THE RULING THAT TOOK A TURN TO SETTLE ───
//
// The tray ADDS a person to the team where `commitDates` REPLACES, and routing
// it through unchanged looked like a silent product change. It was not, and the
// reason the question was hard is that the code CARRIED A WRONG ANSWER:
// TRAQS.jsx said the tray adds "because several people can pile onto one item".
// That was inference stated as fact, and two measurements contradict it.
//
//   The tray is filled ONLY from `editAddedIds` — nodes created in the edit
//   session that just ended. `addPanel` and `addOp` both make `team: []`, and
//   for an empty team ADD AND REPLACE ARE THE SAME ARRAY. The distinction is
//   invisible on the path the feature was built for.
//
//   A card leaves the tray on its FIRST drop, so the tray is structurally
//   incapable of being how several people pile onto one item.
//
//   MEASURED on Matrix: 0 of 230 panels and ops carry more than one person.
//   0 templates (the only tray source that can seed a team). Of 4 undated nodes,
//   1 carries a team at all.
//
// So no merge mode. `commitDates` takes an ABSOLUTE team and derives
// `reassigned` by comparing from/to, and `applyDragMove` writes `m.to.team`
// wholesale — the merge is the CALLER'S ARITHMETIC, not the commit's. The tray
// passes the union as a value and behaviour is preserved exactly.
//
// ─── THE TWO THINGS THAT MUST NOT RIDE ALONG SILENTLY ───
//
// STATUS. The tray sets "Not Started" -> "Pending" and `applyDragMove` does not
// carry status, so routing and changing nothing else would DELETE that
// transition inside a change advertised as mechanical. Kept, deliberately:
// removing it is a product decision and this pass is a consolidation. Carried
// through the plan as `m.to.status`, mirroring the `m.to.hpd` passthrough that
// was already there, so it stays ONE write, ONE undo frame and lands in the
// moveLog like every other field.
//
// THE CARD. `setPendingScheduleItems(... filter ...)` ran unconditionally after
// the write. With a refusal chain in front of it, a refused drop would destroy
// the card AND leave the op undated — strictly worse than the old behaviour,
// which at least placed it. The removal moves BELOW the commit and is gated on
// it, which is #434's ordering lesson a second time.
//
//   node scripts/pending-drop-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import * as D from "../src/dragMove.js";
import { overlapContext, withPerson, withoutPerson } from "../src/overlapRules.js";
import { membershipViolations } from "./_membership-lint.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const RAW = read("../src/TRAQS.jsx");
const CODE = codeOf(RAW);
// SECTION 8 READS `RAW`, NOT `CODE`, and the difference is the whole point of
// that section: `codeOf` STRIPS COMMENTS, so an assertion about a comment run
// against the code view can never fail. Written against CODE first, all three
// were green on unfixed code — LESSONS #1, caught here only because the rest of
// the suite was red at the same moment and three greens in the middle of it
// looked wrong.

// THE BLOCK UNDER TEST, sliced so a presence assertion cannot be satisfied by
// some other part of a 31,000-line file (R4).
const HANDLER = (() => {
  const at = CODE.indexOf("const handlePendingItemDrop = (");
  if (at < 0) return "";
  const end = CODE.indexOf("\n  const delTask = (", at);
  return end > at ? CODE.slice(at, end) : CODE.slice(at);
})();

const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const octx = overlapContext(SETTINGS, "2026-09-30");
const PEOPLE = [
  { id: "wire1", name: "Wendy", departments: ["Wire"] },
  { id: "cut1", name: "Carl", departments: ["Cut"] },
];
const ctxFor = (tasks, over = {}) => ({
  isLocked: () => false, isLive: () => false, isOverdue: () => false, timeOff: () => [],
  nowDay: "2026-09-30", nowHour: 10, business: true, tasks, overlapCtx: octx, people: PEOPLE, ...over,
});
// What the tray builds once it goes through commitDates: dates AND crew move.
// Mirrors `commitDates` exactly, INCLUDING the conditional `status` on `from` —
// without that this helper would quietly diverge from the thing it stands in
// for, and the moveLog assertion below would be testing the helper rather than
// the code.
const mover = (node, next) => {
  const from = { start: node.start, end: node.end, startHour: node.startHour ?? null, endHour: node.endHour ?? null, team: node.team || [],
    ...(next && next.status != null ? { status: node.status ?? null } : {}) };
  const to = { ...from, ...next };
  const teamChanged = JSON.stringify((from.team || []).map(String)) !== JSON.stringify((to.team || []).map(String));
  return [{ id: String(node.id), node, from, to, ...(teamChanged ? { reassigned: true } : {}) }];
};

console.log("\n1. #436 RED PROOF — the dedupe that compares with ===");
{
  // `Array.from(new Set([...team, pid]))` is what the tray used. A Set dedupes
  // by ===, so a person stored as the NUMBER 7 and dropped as the STRING "7"
  // survives twice. This is the person-id-type-drift family: it does not throw,
  // it just quietly puts the same human on the op twice.
  ok("the raw Set keeps both spellings of one person",
    Array.from(new Set([...[7], "7"])), [7, "7"]);
  ok("withPerson sees through the type and adds nothing",
    withPerson([7], "7"), [7]);
  ok("...and the other way round", withPerson(["7"], 7), ["7"]);

  ok("a genuinely new person is appended", withPerson(["a"], "b"), ["a", "b"]);
  ok("an already-present person is a no-op", withPerson(["a", "b"], "b"), ["a", "b"]);
  ok("order is preserved — the crew is not reshuffled by a drop",
    withPerson(["c", "a"], "b"), ["c", "a", "b"]);
  ok("an empty team takes the person", withPerson([], "a"), ["a"]);
  ok("a missing team is not a crash", withPerson(undefined, "a"), ["a"]);
  ok("a null team is not a crash", withPerson(null, "a"), ["a"]);
  // The safe direction: a null/undefined person must not be written INTO a team,
  // because `onTeam` would then never match it and it can never be removed.
  ok("a null person is refused rather than stored", withPerson(["a"], null), ["a"]);
  ok("...and undefined too", withPerson(["a"], undefined), ["a"]);

  // THE MIRROR, and it fails the other way. `team.filter(id => id !== pid)`
  // against a drifted type removes NOBODY and reports success — a request to
  // take someone off a job that silently leaves them on it.
  ok("the raw filter removes nobody when the type drifted",
    [7].filter(id => id !== "7"), [7]);
  ok("withoutPerson removes them anyway", withoutPerson([7], "7"), []);
  ok("...and the other way round", withoutPerson(["7"], 7), []);
  ok("the others are left alone", withoutPerson(["a", "b", "c"], "b"), ["a", "c"]);
  ok("removing someone absent is a no-op", withoutPerson(["a"], "z"), ["a"]);
  ok("a null person removes nothing", withoutPerson(["a", "b"], null), ["a", "b"]);
  ok("a missing team is not a crash", withoutPerson(undefined, "a"), []);
  // add then remove is identity, whichever spelling the id arrived in
  ok("add then remove returns the original crew",
    withoutPerson(withPerson(["a"], 7), "7"), ["a"]);
}

console.log("\n1b. #436 — THE AI ACTION HANDLER, where the id has no provenance");
{
  // `input.person_id` comes from the MODEL. Both halves of the pair were raw,
  // and the extended ratchet is what found them — they are not in the tray and
  // nobody was looking there.
  // `case "assign_person_to_job"` appears TWICE — once in the label switch that
  // renders "Add X to Y", once in the handler that writes. Anchored on the
  // WRITE, found by the `jobExists` guard that only the handler has, or this
  // section would be reading the label switch and passing for the wrong reason.
  const ai = (() => {
    const re = /case "assign_person_to_job":\s*\n\s*changed = jobExists/;
    const m = re.exec(CODE);
    if (!m) return "";
    const end = CODE.indexOf(`case "update_operation"`, m.index);
    return CODE.slice(m.index, end > m.index ? end : m.index + 1200);
  })();
  ok("the AI assign/remove pair was found", ai.length > 0, true);
  ok("...and it is the handler, not the label switch", /jobExists/.test(ai), true);
  ok("...and it contains both halves of the pair",
    /remove_person_from_job/.test(ai), true);
  ok("the raw Set union is gone from it", /new Set\(/.test(ai), false);
  ok("...and the raw !== filter too", /!==\s*input\.person_id/.test(ai), false);
  ok("assign goes through withPerson", /withPerson\(t\.team, input\.person_id\)/.test(ai), true);
  ok("remove goes through withoutPerson", /withoutPerson\(t\.team, input\.person_id\)/.test(ai), true);
}

console.log("\n2. #436 — the lint ratchet learns the Set spelling");
{
  // The ratchet only knew `.includes(` on team. The tray's line passed clean
  // through every build for five months.
  const tray = `team: Array.from(new Set([...(op.team || []), personId])),`;
  ok("the tray's exact line is now caught", membershipViolations(tray).length, 1);
  ok("...and the finding names the member being added",
    membershipViolations(tray)[0]?.member, "personId");

  ok("the spread without the || [] is caught too",
    membershipViolations(`const t = new Set([...pnl.team, pid]);`).length, 1);
  ok("the minified spelling is caught",
    membershipViolations(`team:Array.from(new Set([...(op.team||[]),personId]))`).length, 1);

  // What must NOT be flagged, or the guard gets switched off (LESSONS #4).
  ok("the safe form is clean", membershipViolations(`team: withPerson(node.team, personId)`).length, 0);
  ok("a Set over something that is not a team is clean",
    membershipViolations(`const s = new Set([...job.deps, depId]);`).length, 0);
  ok("a Set over a team with NOTHING added is clean — that is a dedupe, not a join",
    membershipViolations(`const s = new Set([...(op.team || [])]);`).length, 0);
  // LESSONS #5: a comment explaining the banned form must not violate itself.
  ok("a line comment quoting it is not a violation of itself",
    membershipViolations(`// never write new Set([...op.team, pid])`).length, 0);
  ok("a block comment quoting it is not either",
    membershipViolations(`/* was: new Set([...op.team, pid]) */\nconst a = 1;`).length, 0);
  // And the old family still works.
  ok("the .includes family is untouched",
    membershipViolations(`if ((op.team || []).includes(pid)) n++;`).length, 1);
}

console.log("\n3. THE HANDLER ROUTES THROUGH THE SHARED COMMIT");
{
  ok("handlePendingItemDrop still exists", HANDLER.length > 0, true);
  ok("the bare setTasks tree map is gone", /setTasks\(/.test(HANDLER), false);
  ok("...and so is the hand-rolled Set union", /new Set\(/.test(HANDLER), false);
  ok("it commits through the shared path", /commitDates\(/.test(HANDLER), true);
  ok("the union is passed as a VALUE, not a merge mode",
    /team:\s*withPerson\(/.test(HANDLER), true);
  ok("the node is resolved from the tree, not rebuilt from the item",
    /findTaskNode\(/.test(HANDLER), true);
  ok("a panel card resolves to its panel and an op card to its op",
    /item\.kind === "op"\s*\?\s*item\.opId\s*:\s*item\.panelId/.test(HANDLER), true);
  // The permission check is STRICTER here than on the other commits (editJobs as
  // well), because the drop creates the placement rather than adjusting one.
  ok("the three permissions are still demanded",
    /\["editJobs", "moveJobs", "reassign"\]/.test(HANDLER), true);
}

console.log("\n4. THE CARD REMOVAL IS GATED ON THE COMMIT (#434's lesson again)");
{
  // Every index must be FOUND. `indexOf` returns -1 when absent and -1 is less
  // than everything, so a bare `a < b` ordering check passes when the first
  // thing is missing — which is R4's second face and has been green on broken
  // code in this campaign before.
  const order = (...names) => {
    const at = names.map(n => HANDLER.indexOf(n));
    const missing = names.filter((_, i) => at[i] < 0);
    if (missing.length) return missing;
    return at.every((v, i) => i === 0 || at[i - 1] < v) ? [] : ["out of order"];
  };
  ok("the commit runs BEFORE the card is removed",
    order("commitDates(", "setPendingScheduleItems("), []);
  ok("a refused commit returns before the removal is reached",
    /commitDates\([^;]*\)\s*===\s*false\)\s*return/.test(HANDLER.replace(/\n\s*/g, " ")), true);
  ok("the removal is not also sitting above the commit",
    (HANDLER.match(/setPendingScheduleItems\(/g) || []).length, 1);
}

console.log("\n5. STATUS IS CARRIED BY THE PLAN, NOT WRITTEN BESIDE IT");
{
  // KEPT ON PURPOSE. Measured: only 3 of 230 nodes are "Pending" while 181 of
  // 226 DATED nodes are still "Not Started", so placement does not imply Pending
  // anywhere else in this product. That makes the tray an outlier — but removing
  // an outlier is a product decision, and this pass is a consolidation. It is
  // preserved, and recorded as #437 for a ruling of its own.
  const op = { id: "o1", title: "Op", start: "", end: "", team: [], status: "Not Started" };
  const t = [{ id: "j1", title: "J", subs: [{ id: "p1", title: "P", subs: [op] }] }];
  const m = mover(op, { start: "2026-10-01", end: "2026-10-01", team: ["wire1"], status: "Pending" });
  const after = D.applyDragMove(t, m, { date: "d", movedBy: "m", people: PEOPLE })[0].subs[0].subs[0];
  ok("the plan carries status through to the node", after.status, "Pending");
  ok("...and the dates landed with it", [after.start, after.end], ["2026-10-01", "2026-10-01"]);
  ok("...and the crew", after.team, ["wire1"]);

  // No status in the plan must leave the node's own status alone — every other
  // caller passes no status at all, and `to.status` is undefined for them.
  const m2 = mover({ ...op, status: "In Progress" }, { start: "2026-10-02", end: "2026-10-02" });
  const after2 = D.applyDragMove(
    [{ id: "j1", title: "J", subs: [{ id: "p1", title: "P", subs: [{ ...op, status: "In Progress" }] }] }],
    m2, { date: "d", movedBy: "m", people: PEOPLE })[0].subs[0].subs[0];
  ok("a plan with no status does not blank the node's status", after2.status, "In Progress");

  // It lands in the moveLog, like hpd and the departments do.
  const log = after.moveLog[after.moveLog.length - 1];
  ok("the status change is recorded in the moveLog",
    [log.fromStatus, log.toStatus], ["Not Started", "Pending"]);
  const log2 = after2.moveLog[after2.moveLog.length - 1];
  ok("...and is ABSENT when nothing set it, so the log does not read like a change",
    "toStatus" in log2, false);

  ok("the handler only promotes a Not Started node",
    /"Not Started"/.test(HANDLER), true);
  ok("...and only to a status the org actually has, since statusOpts is editable",
    /STATUSES\.includes\(/.test(HANDLER), true);
}

console.log("\n5b. THE STATUS WIRING, not just its ingredients");
{
  // BOTH ASSERTIONS ABOVE SURVIVED MUTATION. Deleting the status from the commit
  // call left them green, because `promoted` was still COMPUTED — an unused
  // variable keeps every ingredient in the file. Checking that a thing is
  // mentioned is not checking that it is connected.
  const call = (() => {
    const at = HANDLER.indexOf("commitDates(");
    const end = HANDLER.indexOf("=== false", at);
    return at < 0 || end < 0 ? "" : HANDLER.slice(at, end);
  })();
  ok("the commit call was found", call.length > 0, true);
  ok("...and `promoted` is passed INTO it, not merely computed above it",
    /promoted\s*\?\s*\{\s*status:\s*"Pending"\s*\}/.test(call), true);
  ok("...alongside the dates", /start,\s*end/.test(call), true);
  ok("...and the crew", /team:\s*withPerson\(/.test(call), true);

  // `mover` at the top of this file is a COPY of commitDates, so a mutation to
  // the real one cannot reach it — which is exactly what mutation testing found.
  // The conditional that keeps `status` off `from` for every other caller is
  // asserted HERE, against the source, where the copy cannot stand in for it.
  const cd = CODE.slice(CODE.indexOf("const commitDates = "), CODE.indexOf("const selectableOpIdsOf"));
  ok("commitDates was found", cd.length > 0, true);
  ok("status joins `from` only when the caller is setting one",
    /next && next\.status != null \? \{ status: op\.status \?\? null \}/.test(cd), true);
  ok("...and never unconditionally, or every date typed on the Jobs list logs a status change",
    /team: op\.team \|\| \[\],\s*status:/.test(cd), false);
}

console.log("\n6. THE FIVE GAPS THE ROUTING CLOSES");
{
  const base = { id: "o1", title: "Op", start: "", end: "", startHour: null, endHour: null, team: [], hpd: 4 };
  const tasksWith = (o) => [{ id: "j1", title: "Job", start: "", end: "", subs: [{ id: "p1", title: "Panel", start: "", end: "", subs: [o] }] }];

  // (1) REFUSAL CHAIN — three layers the tray never consulted.
  const past = mover(base, { start: "2026-09-28", end: "2026-09-28", team: ["wire1"] });
  ok("a drop into the past is refused",
    D.refuseDragMove(past, ctxFor(tasksWith(base)))?.kind, "past");
  const onPto = mover(base, { start: "2026-10-01", end: "2026-10-01", team: ["wire1"] });
  ok("a drop onto time off is refused",
    D.refuseDragMove(onPto, ctxFor(tasksWith(base), {
      timeOff: () => [{ start: "2026-10-01", end: "2026-10-01" }] }))?.kind, "pto");
  ok("a drop onto a clocked-in op is refused",
    D.refuseDragMove(onPto, ctxFor(tasksWith(base), { isLive: () => true }))?.kind, "live");
  ok("an ordinary drop is allowed",
    D.refuseDragMove(onPto, ctxFor(tasksWith(base))), null);

  // (2) OVERLAP BACKSTOP is commitLanding's, and commitDates goes through it.
  ok("the handler reaches the backstop by using the shared commit",
    /commitDates\(/.test(HANDLER), true);

  // (3) moveLog — the tray wrote none at all.
  const placed = D.applyDragMove(tasksWith(base), onPto, { date: "2026-09-30", movedBy: "Trey", people: PEOPLE })[0].subs[0].subs[0];
  ok("the placement is logged", (placed.moveLog || []).length, 1);
  ok("...with where it came from and went to",
    [placed.moveLog[0].fromStart, placed.moveLog[0].toStart], ["", "2026-10-01"]);
  ok("...and who did it", placed.moveLog[0].movedBy, "Trey");
  ok("...and that the crew changed", placed.moveLog[0].toTeam, ["wire1"]);

  // (4) recalcBounds — the parent's dates follow. commitDates wraps it.
  ok("the shared commit recalculates the parents", /recalcBounds\(/.test(
    CODE.slice(CODE.indexOf("const commitDates = "), CODE.indexOf("const selectableOpIdsOf"))), true);

  // (5) departmentFollow comes free, inside applyDragMove.
  const deptOp = { ...base, requiredDepartments: ["Wire"] };
  const toCut = mover(deptOp, { start: "2026-10-01", end: "2026-10-01", team: ["cut1"] });
  const moved = D.applyDragMove(tasksWith(deptOp), toCut, { date: "d", movedBy: "m", people: PEOPLE })[0].subs[0].subs[0];
  ok("the department follows the work on a tray drop too", moved.requiredDepartments, ["Cut"]);
  ok("...and the replaced set is recoverable from the log",
    moved.moveLog[0].fromDepartments, ["Wire"]);
}

console.log("\n7. A PANEL CARD IS A UNIT TOO");
{
  // "A new panel with no ops gets its own card", so panel-level drops are real.
  // applyDragMove maps job -> panel -> op and `put`s at every level, and
  // occupyingUnits counts a childless panel as a unit, so the refusal chain and
  // the backstop both see it.
  const panel = { id: "p1", title: "Panel", start: "", end: "", team: [], hpd: 4, subs: [] };
  const t = [{ id: "j1", title: "Job", start: "", end: "", subs: [panel] }];
  const m = mover(panel, { start: "2026-10-01", end: "2026-10-01", team: ["wire1"] });
  const after = D.applyDragMove(t, m, { date: "d", movedBy: "m", people: PEOPLE })[0].subs[0];
  ok("a childless panel is placed by the same machinery", [after.start, after.team], ["2026-10-01", ["wire1"]]);
  ok("...and logged", (after.moveLog || []).length, 1);
  ok("a drop onto a childless panel on time off is refused",
    D.refuseDragMove(m, ctxFor(t, { timeOff: () => [{ start: "2026-10-01", end: "2026-10-01" }] }))?.kind, "pto");
}

console.log("\n8. THE COMMENT THAT CARRIED THE WRONG ANSWER (R2)");
{
  // The claim stood in the file for months and is why this took a turn to
  // settle. Correcting it in place is the rule; deleting it quietly is not,
  // because the next reader needs to know the question was asked and answered.
  const anchor = RAW.indexOf("const [placingTask, setPlacingTask] = useState(");
  ok("the anchor the comment sits above is still there", anchor > 0, true);
  const near = RAW.slice(Math.max(0, anchor - 2200), anchor);
  ok("the wrong justification is gone",
    /several people can pile onto one item/.test(near), false);
  ok("...and the correction cites the measurement rather than just deleting it",
    /measure/i.test(near), true);
  ok("...and names what the tray actually holds",
    /editAddedIds/.test(near), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
