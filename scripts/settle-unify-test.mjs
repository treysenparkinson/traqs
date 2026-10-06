// #404 — ONE WAY OF SETTLING THE BOARD, not two that disagree on every op.
//
// `updTask` ran its own settle (`reflowJob`) while every consolidated commit used
// `recalcBounds` + `enforceNoOverlap`. MEASURED ON MATRIX, 2026-10-06:
//
//   reflowJob on the board as it stands     31 ops moved, 22 parent dates shifted
//     ...from the assigned-overlap push      0
//     ...from the UNASSIGNED QUEUE rule     31
//     ...entirely in the PAST               31   (all of them)
//   enforceNoOverlap over every dated op     1 moved, 0 refused
//   ops the two AGREE on                     0 of 32
//
// The intersection is EMPTY. `reflowPhaseOps` sees one phase; `clearOverlaps` sees
// the board. They cannot see the same conflicts even in principle.
//
// Three answers, not one — they were never a duplicate pair:
//
//   A  THE ROLLUP            `rollUpJobDates` is right, `recalcBounds` is the
//                            duplicate AND is actively wrong (#84).
//   B  THE OVERLAP RESPONSE  refusal is right and already ruled (#398).
//                            reflow's silent push is the duplicate.
//   C  THE QUEUE RULE        answers a question nothing else answers. KEPT, with
//                            the predicate the rest of the app already uses.
//
//   + THE TRIGGER            `datesMoved` was a hasOwnProperty test, so a
//                            title-only edit settled the board. See src/settle.js.
//
//   node scripts/settle-unify-test.mjs
import { readFileSync } from "node:fs";
import { overlapContext, takesPart } from "../src/overlapRules.js";
import { scheduleSignature, movesSchedule } from "../src/settle.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// 08:00–17:00, lunch 12:00/60 → 8 productive hours; Mon–Fri; today Tue 2026-10-06,
// which is the day the live measurement above was taken.
const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const TODAY = "2026-10-06";
const ctx = overlapContext(SETTINGS, TODAY);
const MON = "2026-10-12", TUE = "2026-10-13", WED = "2026-10-14";
const OPTS = { workDays: SETTINGS.workDays, holidays: SETTINGS.holidays, today: TODAY };

// ── the real code, sliced out of TRAQS.jsx and executed ─────────────────────
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const slice = (anchor) => {
  const at = SRC.indexOf(anchor);
  if (at < 0) return null;
  let i = SRC.indexOf("{", SRC.indexOf("=>", at)), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === "{") depth++; else if (SRC[i] === "}" && --depth === 0) break; }
  return SRC.slice(SRC.indexOf("=", at) + 1, i + 1);
};
const build = (code, deps) => new Function("scope", `with (scope) { return (${code}); }`)(new Proxy(deps, {
  has: (_, k) => typeof k === "string" && k !== "globalThis",
  get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (k in globalThis) return globalThis[k]; throw new Error("missing dep: " + String(k)); },
}));
const O = await import(new URL("../src/overlapRules.js", import.meta.url).href);
const isDated = (n) => !!(n && n.start && n.end);
const isAssigned = (n) => !!(n && (n.team || []).length > 0);
const deps = {
  ...O, isDated, isAssigned, takesPart,
  // Real calendar helpers: the queue rule loops over working days, so identity
  // stubs would place everything on one day and prove nothing.
  addBD: (ds, n) => O.shiftWorkingDays(ds, n, ctx),
  diffBD: (a, b) => { let n = 0; for (let d = a; d < b; d = O.shiftWorkingDays(d, 1, ctx)) n++; return n; },
};
// An EXPRESSION-bodied arrow has no `{` to balance, so it is sliced to its `;`.
const sliceExpr = (anchor) => {
  const at = SRC.indexOf(anchor);
  if (at < 0) return null;
  const eq = SRC.indexOf("=", at), end = SRC.indexOf(";", eq);
  return end < 0 ? null : SRC.slice(eq + 1, end);
};
// A MISSING ANCHOR ABORTS. It must not be one more FAIL line, because the sections
// below are guarded on the slice: when `const recalcBounds = (taskList, movedBy)`
// became `_movedBy`, the anchor missed, the guard skipped TEN assertions, and the
// suite still printed a cheerful pass count. A suite that cannot find the code
// under test has not tested it, and saying so quietly is worse than saying nothing.
const need = (name, anchor, how = slice) => {
  const src = how(anchor);
  if (src) return src;
  console.error(`\n  ABORT  could not slice ${name} out of TRAQS.jsx — anchor moved:\n         ${anchor}`);
  process.exit(2);
};
const reflowPhaseOps = build(need("reflowPhaseOps", "const reflowPhaseOps = (ops, opts) => {"), deps);
const rollUpJobDates = build(need("rollUpJobDates", "const rollUpJobDates = (job) => {"), deps);
const recalcBounds = build(need("recalcBounds", "const recalcBounds = (taskList, _movedBy) =>", sliceExpr), { ...deps, rollUpJobDates });

const op = (id, f) => ({ id, title: id, status: "Not Started", ...f });
// JSON.stringify(new Map()) is "{}" FOR EVERY MAP, so comparing raw results would
// have read two different sets of moves as equal. Entries, sorted, or null.
const res = (r) => (r instanceof Map ? [...r.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : r);
// The push needs the overlap context to fire at all (`const ctx = opts?.overlap`).
// Section B's assertions MUST pass it or they are green against code that still
// has the push — which is how the first version of this file read.
const OPTS_BIZ = { ...OPTS, overlap: ctx };

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nA. THE ROLLUP — recalcBounds must stop inventing parent dates (#84)");
{
  // `"" < "2026-06-25"` is TRUE, so one undated child won the `earliest` reduce and
  // the parent came back {start: null, end: null}. MEASURED: 2 live panels on Matrix
  // hold an undated op, and 3 live parents already carry a bound the two disagree on.
  const withUndated = [{ id: "J", start: "2026-10-01", end: "2026-10-02", subs: [
    { id: "P", start: "2026-10-01", end: "2026-10-02", subs: [
      op("dated", { start: "2026-10-01", end: "2026-10-02" }),
      op("undated", {}),
    ] },
  ] }];
  const r = recalcBounds(withUndated, "me")[0];
  ok("RED: one undated sibling must not blank the panel", [r.subs[0].start, r.subs[0].end], ["2026-10-01", "2026-10-02"]);
  ok("RED: ...nor the job", [r.start, r.end], ["2026-10-01", "2026-10-02"]);

  // A tombstone is not work. It dragged the panel's start back six years.
  const withTomb = [{ id: "J", start: "2026-10-01", end: "2026-10-02", subs: [
    { id: "P", start: "2026-10-01", end: "2026-10-02", subs: [
      op("dated", { start: "2026-10-01", end: "2026-10-02" }),
      op("tomb", { start: "2020-01-01", end: "2020-01-02", deletedAt: "2026-01-01T00:00:00Z" }),
    ] },
  ] }];
  const t = recalcBounds(withTomb, "me")[0];
  ok("RED: a tombstoned op must not drag the start back to 2020", [t.subs[0].start, t.subs[0].end], ["2026-10-01", "2026-10-02"]);

  // ...while the thing a rollup is FOR still happens.
  const moved = [{ id: "J", start: "2026-10-01", end: "2026-10-01", subs: [
    { id: "P", start: "2026-10-01", end: "2026-10-01", subs: [
      op("a", { start: "2026-10-05", end: "2026-10-06" }),
      op("b", { start: "2026-10-07", end: "2026-10-09" }),
    ] },
  ] }];
  const m = recalcBounds(moved, "me")[0];
  ok("a phase still spans its ops", [m.subs[0].start, m.subs[0].end], ["2026-10-05", "2026-10-09"]);
  ok("...and the job still spans its phases", [m.start, m.end], ["2026-10-05", "2026-10-09"]);
  // One rollup, so the two must now agree by construction on every shape above.
  for (const [name, fixture] of [["undated", withUndated], ["tombstone", withTomb], ["moved", moved]])
    ok(`the two rollups agree on the ${name} fixture`,
      JSON.stringify(recalcBounds(fixture, "me")[0]), JSON.stringify(rollUpJobDates(fixture[0])));
  // A deleted job keeps its slot: callers index the result against the input.
  ok("the array keeps its length and order", recalcBounds([{ id: "A", subs: [] }, { id: "B", deletedAt: "x", subs: [] }], "me").map(j => j.id), ["A", "B"]);
  ok("an empty list is fine", recalcBounds([], "me"), []);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nB. THE OVERLAP RESPONSE — reflow must not silently push assigned work");
{
  // Refusal is the ruled answer (#398, accepted). A second mechanism that MOVES
  // instead is the duplicate, and it was the one with no moveLog and no toast.
  const clash = [
    op("A", { start: MON, end: MON, startHour: 8, hpd: 4, team: [7] }),
    op("B", { start: MON, end: MON, startHour: 9, hpd: 4, team: [7] }),
  ];
  ok("RED: two overlapping ops on one person are LEFT for the refusal to catch",
    res(reflowPhaseOps(clash, OPTS_BIZ)), null);
  // The case B's deletion must not break: ops that never overlapped still stay put.
  ok("non-touching same-day ops on one person stay put", res(reflowPhaseOps([
    op("A", { start: MON, end: MON, startHour: 8, hpd: 2, team: [7] }),
    op("B", { start: MON, end: MON, startHour: 13, hpd: 2, team: [7] }),
  ], OPTS_BIZ)), null);
  // A three-way pile-up: the push used to cascade up to 260 days. None of it now.
  ok("...and a three-way pile-up is left whole", res(reflowPhaseOps([
    op("A", { start: MON, end: MON, startHour: 8, hpd: 8, team: [7] }),
    op("B", { start: MON, end: MON, startHour: 8, hpd: 8, team: [7] }),
    op("C", { start: MON, end: MON, startHour: 8, hpd: 8, team: [7] }),
  ], OPTS_BIZ)), null);
  // An assigned op is still an OBSTACLE for the queue — it occupies the phase's
  // timeline even though nothing may push it. Deleting the push must not delete that.
  const mixed = reflowPhaseOps([
    op("ASSIGNED", { start: MON, end: TUE, team: [7] }),
    op("QUEUED", { start: MON, end: MON }),
  ], OPTS_BIZ);
  ok("an assigned op still holds its place against the queue",
    res(mixed), [["QUEUED", { start: WED, end: WED }]]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nC. THE QUEUE RULE — kept, with the predicate the rest of the app uses");
{
  // THE WHOLE OF THE MEASURED DAMAGE. The unassigned branch asked NOTHING — no
  // status, no `today`, no overlap rule — so it re-dated history: 31 live ops,
  // every one unassigned and entirely in the past, inside six jobs, five of them
  // Finished. `takesPart` is what every other surface asks.
  const past = [
    op("A", { start: "2026-01-05", end: "2026-01-05" }),
    op("B", { start: "2026-01-05", end: "2026-01-05" }),
  ];
  ok("RED: two unassigned ops wholly in the PAST are not re-dated", res(reflowPhaseOps(past, OPTS_BIZ)), null);
  const fin = [
    op("A", { start: MON, end: MON }),
    op("FIN", { start: MON, end: MON, status: "Finished" }),
  ];
  ok("RED: a FINISHED unassigned op is not moved", res(reflowPhaseOps(fin, OPTS_BIZ)), null);
  ok("...nor does finished work push a live op down the queue",
    res(reflowPhaseOps([op("FIN", { start: MON, end: TUE, status: "Finished" }), op("LIVE", { start: MON, end: MON })], OPTS_BIZ)), null);
  const tomb = [
    op("A", { start: MON, end: MON }),
    op("T", { start: MON, end: MON, deletedAt: "2026-01-01T00:00:00Z" }),
  ];
  ok("a tombstoned op is not moved", res(reflowPhaseOps(tomb, OPTS_BIZ)), null);
  // THE BOUNDARY THE GATE WOULD GET WRONG IF IT COMPARED THE WRONG DATE. An op
  // that STARTED last week but runs into next week is live work: `takesPart` tests
  // the END (`(unit.end || unit.start) >= ctx.today`). It must still hold its place
  // in the queue. A gate written against `start` would drop it and let a live op
  // slide underneath work that is genuinely still running.
  ok("an op running from the past INTO the future still holds the queue", res(reflowPhaseOps([
    op("SPANS", { start: "2026-10-01", end: WED }),
    op("LIVE2", { start: MON, end: MON }),
  ], OPTS_BIZ)), [["LIVE2", { start: "2026-10-15", end: "2026-10-15" }]]);

  // ...and the rule itself still does its job on live, future work.
  ok("two live unassigned ops on one day are still queued", res(reflowPhaseOps([
    op("FIRST", { start: MON, end: MON }),
    op("SECOND", { start: MON, end: MON }),
  ], OPTS_BIZ)), [["SECOND", { start: TUE, end: TUE }]]);
  // A multi-day op keeps its length when it is queued, in working days.
  ok("a queued op keeps its working-day length", res(reflowPhaseOps([
    op("FIRST", { start: MON, end: MON }),
    op("SECOND", { start: MON, end: TUE }),
  ], OPTS_BIZ)), [["SECOND", { start: TUE, end: WED }]]);
  // The gate must not need a tier: re-dating finished work is not a paid feature,
  // and on Basic `enforceNoOverlap` does nothing at all, so this is the only guard.
  ok("the gate holds with no overlap context at all (Basic)",
    res(reflowPhaseOps(past, { workDays: SETTINGS.workDays, holidays: SETTINGS.holidays, today: TODAY })), null);
  ok("...and the queue still runs on Basic", res(reflowPhaseOps([
    op("FIRST", { start: MON, end: MON }),
    op("SECOND", { start: MON, end: MON }),
  ], { workDays: SETTINGS.workDays, holidays: SETTINGS.holidays, today: TODAY })), [["SECOND", { start: TUE, end: TUE }]]);
  // Without a `today` the predicate still drops Finished and tombstoned work; only
  // the past test needs a date to compare against.
  ok("no `today` still drops Finished", res(reflowPhaseOps(fin, { workDays: SETTINGS.workDays, holidays: SETTINGS.holidays })), null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nD. THE TRIGGER — a key being present is not a move");
{
  const job = { id: "J", start: MON, end: TUE, team: [], subs: [
    { id: "P", start: MON, end: TUE, team: [], subs: [op("O", { start: MON, end: MON, team: [7] })] },
  ] };
  const clone = JSON.parse(JSON.stringify(job));
  ok("an identical tree has an identical signature", scheduleSignature(job), scheduleSignature(clone));
  ok("...so a title-only patch does NOT settle", movesSchedule(job, { ...job, title: "Renamed" }), false);
  ok("a status-only patch does not settle", movesSchedule(job, { ...job, status: "On Hold" }), false);
  ok("re-sending the SAME dates does not settle", movesSchedule(job, { ...job, start: MON, end: TUE }), false);
  ok("a real start change does settle", movesSchedule(job, { ...job, start: TUE }), true);
  ok("a real end change does settle", movesSchedule(job, { ...job, end: WED }), true);
  ok("a team change does settle", movesSchedule(job, { ...job, team: [9] }), true);
  // THE CASE THAT MAKES VALUE-COMPARISON SAFE. The Edit Job modal's edits arrive
  // inside `subs` while the job's own start/end are recomputed from them — so a
  // shallow compare would stop the parents rolling up.
  const movedChild = JSON.parse(JSON.stringify(job));
  movedChild.subs[0].subs[0].start = WED;
  ok("a date change INSIDE subs settles, though the job's own dates did not move",
    movesSchedule(job, movedChild), true);
  const reTeamedChild = JSON.parse(JSON.stringify(job));
  reTeamedChild.subs[0].subs[0].team = [8];
  ok("...and so does a reassignment inside subs", movesSchedule(job, reTeamedChild), true);
  const renamedChild = JSON.parse(JSON.stringify(job));
  renamedChild.subs[0].subs[0].title = "Renamed op";
  ok("...but renaming a child does not", movesSchedule(job, renamedChild), false);
  // Hours are placement too: a bar that moves within a day has moved.
  const hour = JSON.parse(JSON.stringify(job));
  hour.subs[0].subs[0].startHour = 13;
  ok("an hour change settles", movesSchedule(job, hour), true);
  // Team order and id TYPE are not changes — ids are mixed string/number (#411).
  ok("[7] and [\"7\"] are one team", movesSchedule(job, (() => { const c = JSON.parse(JSON.stringify(job)); c.subs[0].subs[0].team = ["7"]; return c; })()), false);
  ok("team order is not a change", movesSchedule({ ...job, team: [7, 8] }, { ...job, team: [8, 7] }), false);
  // Structure counts: an op added or removed changes the board.
  const added = JSON.parse(JSON.stringify(job));
  added.subs[0].subs.push(op("NEW", { start: WED, end: WED }));
  ok("an added op settles", movesSchedule(job, added), true);
  const removed = JSON.parse(JSON.stringify(job));
  removed.subs[0].subs = [];
  ok("a removed op settles", movesSchedule(job, removed), true);
  // It must never decide "no change" because it could not look.
  ok("a missing `before` settles", movesSchedule(null, job), true);
  ok("a missing `after` settles", movesSchedule(job, null), true);
  ok("a node with no subs is fine", movesSchedule({ id: "X" }, { id: "X" }), false);
  ok("subs that are not an array are ignored, not thrown on", movesSchedule({ id: "X", subs: null }, { id: "X", subs: undefined }), false);
  ok("a team that is not an array is ignored", movesSchedule({ id: "X", team: null }, { id: "X", team: undefined }), false);
  // A TRUTHY non-array is the case `|| []` would let through, and `"79".sort` is
  // not a function — it would THROW, on the save path, inside setTasks. Ids are
  // mixed string/number across web and iOS (#411), so a bare id where a list was
  // expected is the shape this codebase actually produces.
  ok("a team that is a bare string does not throw, and reads as no team",
    (() => { try { return movesSchedule({ id: "X", team: "79" }, { id: "X" }); } catch (e) { return `threw: ${e.message}`; } })(), false);
  ok("...nor does an object team", (() => { try { return movesSchedule({ id: "X", team: { 0: 7 } }, { id: "X" }); } catch (e) { return `threw: ${e.message}`; } })(), false);
  // The same guard on `subs`: a non-array there would end the walk, not crash it.
  ok("a subs that is a string does not throw", (() => { try { return movesSchedule({ id: "X", subs: "nope" }, { id: "X" }); } catch (e) { return `threw: ${e.message}`; } })(), false);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\nE. IT IS WIRED — each statement named separately");
{
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(SRC);
  // A. One rollup. `recalcBounds` keeps its NAME so all nine call sites move
  // together and nothing can be left behind, but its BODY is now the other one.
  ok("recalcBounds delegates to rollUpJobDates",
    /const recalcBounds = \(taskList, _movedBy\) => \(taskList \|\| \[\]\)\.map\(rollUpJobDates\);/.test(CODE), true);
  ok("...and no longer reduces over panel.subs itself",
    /const earliest = ops\.reduce\(/.test(CODE), false);
  // B. The push is gone, named by its own statement rather than by the function.
  ok("the assigned-overlap push is deleted",
    /shiftWorkingDays\(op\.start, n, ctx\)/.test(CODE), false);
  ok("...and reflow no longer builds an obstacle list for overlapsWith",
    /overlapsWith\(cur, placed, ctx\)/.test(CODE), false);
  // C. The gate, by its statement.
  ok("the queue rule is gated on takesPart",
    /takesPart\(o, \{ today: opts\?\.today \?\? null \}\)/.test(CODE), true);
  ok("takesPart is imported from the shared rule",
    /import \{[^}]*\btakesPart\b[^}]*\} from "\.\/overlapRules\.js"/.test(CODE), true);
  // The tier branch on the settle is gone: re-dating finished work is not a feature.
  ok("the settle no longer branches on billingTier",
    /overlap: billingTier === "business" \? overlapCtx : null/.test(CODE), false);
  ok("...and passes today instead",
    /reflowJob\(t, \{ \.\.\.schedOpts, today: shopDay\(\) \}\)/.test(CODE), true);
  // THE TRIGGER. Named as the statement, not as the identifier: a bare
  // /movesSchedule/ would pass on the import line alone, which is how #70's
  // wiring assertion let a deleted CALL through.
  ok("updTask compares values, not key presence",
    /const datesMoved = !_storedNode \|\| movesSchedule\(_storedNode, \{ \.\.\._storedNode, \.\.\.upd \}\);/.test(CODE), true);
  ok("...and reads the stored node to compare against",
    /const _storedNode = findTaskNode\(id\);/.test(CODE), true);
  ok("the hasOwnProperty trigger is gone",
    /hasOwnProperty\.call\(upd, "start"\)/.test(CODE), false);
  ok("settle.js is imported", /from "\.\/settle\.js"/.test(CODE), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
