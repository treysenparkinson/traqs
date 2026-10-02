// One overlap rule — SCHEDULE_MAP root cause 5 (#62, #24, #53, #61).
//
//   node scripts/overlap-test.mjs
//
// Part 1 runs the shared rule (src/overlapRules.js) on the fixture set the five old
// rules disagreed on, and checks the PRODUCT verdict: a person can't be doing two
// things at once, measured on the time they actually work (half-open blocks on
// working days, a unit's share of hpd walked through productive time). Part 2
// executes the web's own call sites, sliced out of TRAQS.jsx, on the same fixtures.
// Part 3 is the server rule in tasks.js, Business only, behind OVERLAP_RULE_MODE.
import { readFileSync } from "node:fs";
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

let O, tasksFn;
try {
  O = await import(new URL("../src/overlapRules.js", import.meta.url).href);
  tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the modules under test:", e); process.exit(2); }
for (const f of ["overlapContext", "occupyingUnits", "overlapsWith", "clearOverlaps", "planPushes", "overlapViolations", "capacityWarnings"]) {
  if (typeof O[f] !== "function") { console.error("overlapRules.js does not export", f); process.exit(2); }
}

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// 08:00–17:00, lunch 12:00 for 60 min → 8 productive hours; Mon–Fri; today Wed 2026-09-30.
const SETTINGS = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const TODAY = "2026-09-30";
const ctx = O.overlapContext(SETTINGS, TODAY);
const MON = "2026-10-05";
const job = (...ops) => [{ id: "J", title: "Job", subs: [{ id: "P", title: "Panel", subs: ops }] }];
const op = (id, f) => ({ id, title: id, team: [7], status: "Not Started", ...f });
const hits = (tasks, candidateId) => {
  const units = O.occupyingUnits(tasks, ctx);
  const me = units.find(u => u.unit.id === candidateId).unit;
  return O.overlapsWith(me, units, ctx).map(h => h.other.unit.id);
};

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. The shared rule, on the fixtures the old rules disagreed on");
const F = {
  "adjacent 08–10 / 10–12":                  [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 2 }), op("X", { start: MON, end: MON, startHour: 10, hpd: 2 })), []],
  "overlapping 08–11 / 10–12":               [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 3 }), op("X", { start: MON, end: MON, startHour: 10, hpd: 2 })), ["Y"]],
  "same day with a gap 08–10 / 13–15":       [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 2 }), op("X", { start: MON, end: MON, startHour: 13, hpd: 2 })), []],
  "same day, no hours, both from 08:00":     [job(op("Y", { start: MON, end: MON, hpd: 4 }), op("X", { start: MON, end: MON, hpd: 4 })), ["Y"]],
  "Fri→Mon vs a Saturday op":                [job(op("Y", { start: "2026-10-03", end: "2026-10-03", startHour: 8, hpd: 4 }), op("X", { start: "2026-10-02", end: MON, hpd: 16 })), []],
  "Y finished":                              [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4, status: "Finished" }), op("X", { start: MON, end: MON, startHour: 9, hpd: 2 })), []],
  "Y in the past (history)":                 [job(op("Y", { start: "2026-09-29", end: "2026-09-29", startHour: 8, hpd: 4 }), op("X", { start: TODAY, end: TODAY, startHour: 9, hpd: 2 })), []],
  "ids 7 and \"7\"":                          [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4, team: ["7"] }), op("X", { start: MON, end: MON, startHour: 9, hpd: 2 })), ["Y"]],
  "Y is a 2-person 8 h op (4 h each)":        [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 8, team: [7, 8] }), op("X", { start: MON, end: MON, startHour: 10, hpd: 2 })), ["Y"]],
  "…and X starts after Y's 4 h share":       [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 8, team: [7, 8] }), op("X", { start: MON, end: MON, startHour: 13, hpd: 2 })), []],
  "Y locked (a lock doesn't free its time)": [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4, locked: true }), op("X", { start: MON, end: MON, startHour: 9, hpd: 2 })), ["Y"]],
  "Y tombstoned":                            [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4, deletedAt: "2026-09-30T00:00:00Z" }), op("X", { start: MON, end: MON, startHour: 9, hpd: 2 })), []],
  "different people":                        [job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4, team: [8] }), op("X", { start: MON, end: MON, startHour: 9, hpd: 2 })), []],
};
for (const [label, [tasks, want]] of Object.entries(F)) ok(label, hits(tasks, "X"), want);

console.log("\n2. Clearing overlaps is sequential (#53)");
{
  const tasks = job(op("C", { start: MON, end: MON, hpd: 8 }), op("A", { start: MON, end: MON, hpd: 8 }), op("B", { start: MON, end: MON, hpd: 8 }));
  const { tasks: after, moved } = O.clearOverlaps(tasks, ["A", "B"], ctx);
  const at = (id) => after[0].subs[0].subs.find(o => o.id === id).start;
  ok("A and B, both touched, land on different days", [at("C"), at("A"), at("B")], [MON, "2026-10-06", "2026-10-07"]);
  ok("and nothing overlaps afterwards", O.occupyingUnits(after, ctx).flatMap(u => O.overlapsWith(u.unit, O.occupyingUnits(after, ctx), ctx)).length, 0);
  ok("each move is reported", moved.map(m => [m.id, m.days]), [["A", 1], ["B", 2]]);
  const locked = job(op("C", { start: MON, end: MON, hpd: 8 }), op("L", { start: MON, end: MON, hpd: 8, locked: true }));
  // RE-POINTED 2026-10-02. op.locked is retired (ruling 3: the only real lock is
  // an active clock; a clocked-out op moves freely, including one already worked
  // on). This module only ever sees STORED units, so it could never check the
  // real lock — the flag it checked was set by the split on already-worked work,
  // which is exactly what the ruling frees. Asserted in the new direction rather
  // than deleted, so a stray flag on older data cannot start pinning again.
  ok("a stray locked flag no longer pins a unit", O.clearOverlaps(locked, ["L"], ctx).tasks[0].subs[0].subs[1].start !== MON, true);
}

console.log("\n3. Pushes");
{
  const tasks = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 8 }), op("Z", { start: "2026-10-06", end: "2026-10-06", startHour: 8, hpd: 8 }));
  const moving = op("X", { start: MON, end: MON, startHour: 8, hpd: 8 });
  const r = O.planPushes(tasks, moving, ctx);
  ok("landing on Y pushes it a day, which pushes Z (cascade)", r.pushes.map(p => [p.opId, p.newStart]), [["Y", "2026-10-06"], ["Z", "2026-10-07"]]);
  const adj = O.planPushes(tasks, op("X", { start: "2026-10-02", end: "2026-10-02", startHour: 8, hpd: 8 }), ctx);
  ok("a move that touches nothing pushes nothing", adj.pushes.length, 0);
  const lockedT = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 8, locked: true }));
  // Was "a locked unit in the way blocks the move". Nothing blocks on the flag
  // now; `blocked` means only that the cascade could not settle inside maxDays.
  ok("a stray locked flag in the way no longer blocks the move", O.planPushes(lockedT, moving, ctx).blocked, false);
  ok("...and the unit is pushed like any other", O.planPushes(lockedT, moving, ctx).pushes.length > 0, true);
}

console.log("\n4. Capacity is a separate warning (#61)");
{
  const people = [{ id: 7, cap: 0 }, { id: 8, cap: 4 }];
  const two6 = job(op("A", { start: MON, end: MON, startHour: 8, hpd: 6 }), op("B", { start: MON, end: MON, startHour: 14, hpd: 6 }));
  ok("12 h on an 8 h day warns", O.capacityWarnings(two6, people, ctx).map(w => [w.personId, w.day, w.load]), [["7", MON, 12]]);
  const fm = job(op("W", { start: "2026-10-02", end: MON, hpd: 16 }));
  ok("a Fri→Mon op loads Fri and Mon, not the weekend", O.capacityWarnings(fm, people, ctx).length, 0);
  ok("cap is per person", O.capacityWarnings(job(op("S", { start: MON, end: MON, hpd: 6, team: [8] })), people, ctx).map(w => [w.personId, w.cap]), [["8", 4]]);
}

console.log("\n5. The server's check only looks at what a write changes");
{
  const stored = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4 }), op("X", { start: MON, end: MON, startHour: 9, hpd: 2 }));
  const renamed = JSON.parse(JSON.stringify(stored)); renamed[0].title = "Renamed";
  ok("an overlap already stored doesn't block an unrelated save", O.overlapViolations(renamed, stored, ctx).length, 0);
  const clean = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4 }), op("X", { start: MON, end: MON, startHour: 13, hpd: 2 }));
  const moved = JSON.parse(JSON.stringify(clean)); moved[0].subs[0].subs[1].startHour = 9;
  ok("moving X onto Y is reported once", O.overlapViolations(moved, clean, ctx).map(v => [v.rule, v.id, v.withId, v.personId, v.day]), [["overlap", "X", "Y", "7", MON]]);
}

console.log("\n5b. Placement helpers the auto-schedulers and the save use (#303)");
if (typeof O.nextFreeStart !== "function" || typeof O.schedulerAvailability !== "function") {
  ok("overlapRules exports nextFreeStart and schedulerAvailability", false, true);
} else {
  const busy = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 3 }));
  const units = O.occupyingUnits(busy, ctx);
  ok("next free start after Y's 08–11 is 11:00 the same day",
     O.nextFreeStart(op("X", { start: MON, end: MON, hpd: 2 }), MON, units, ctx), { start: MON, end: MON, startHour: 11, endHour: 14 });
  const full = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 8 }));
  ok("a full day rolls to the next working day", O.nextFreeStart(op("X", { start: MON, end: MON, hpd: 2 }), MON, O.occupyingUnits(full, ctx), ctx)?.start, "2026-10-06");
  ok("another person's work doesn't block", O.nextFreeStart(op("X", { start: MON, end: MON, hpd: 2, team: [8] }), MON, units, ctx)?.startHour, 8);
  // The source of the live double-bookings: four same-day units for one person in one
  // run. Each placement is booked before the next is checked.
  const avail = O.schedulerAvailability([], ctx, { people: [{ id: 7 }] });
  const placed = [];
  for (let i = 0; i < 4; i++) {
    let d = MON;
    while (!avail.free(7, d, d)) d = O.shiftWorkingDays(d, 1, ctx);
    avail.book(7, d, d); placed.push(d);
  }
  ok("four units for one person in one run land on four days, not one", placed, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
  const av2 = O.schedulerAvailability(busy, ctx, { people: [{ id: 7, timeOff: [{ start: "2026-10-06", end: "2026-10-06" }] }] });
  ok("existing work and time off both block", [av2.free(7, MON, MON), av2.free(7, "2026-10-06", "2026-10-06"), av2.free(7, "2026-10-07", "2026-10-07")], [false, false, true]);
  ok("the run's own job can be excluded", O.schedulerAvailability(busy, ctx, { excludeJobId: "J", people: [] }).free(7, MON, MON), true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. The web's call sites use the shared rule (sliced from TRAQS.jsx and run)");
const SRC = readFileSync(process.env.OVERLAP_SRC || new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const slice = (anchor) => {
  const at = SRC.indexOf(anchor); if (at < 0) return null;
  let i = SRC.indexOf("{", SRC.indexOf("=>", at)), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === "{") depth++; else if (SRC[i] === "}" && --depth === 0) break; }
  return SRC.slice(SRC.indexOf("=", at) + 1, i + 1);
};
const build = (code, deps) => new Function("scope", `with (scope) { return (${code}); }`)(new Proxy(deps, {
  has: (_, k) => typeof k === "string" && k !== "globalThis",
  get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (k in globalThis) return globalThis[k]; throw new Error("missing dep: " + String(k)); },
}));
const webDeps = { ...O, overlapCtx: ctx, isOpLocked: (o) => !!o?.locked, toDS: () => TODAY, onTeam: (t, p) => (t || []).map(String).includes(String(p)),
  sameId: (a, b) => a != null && b != null && String(a) === String(b),
  billingTier: "business", people: [{ id: 7 }, { id: 8 }], T: { accent: "#000" }, isOff: () => false, fm: (d) => d, productiveHoursPerDay: ctx.productiveHoursPerDay,
  orgSettings: SETTINGS, workStartH: 8, workEndH: 17, capacityOf: (p, d) => d,
  // Real date helpers: the sites loop over days, so identity stubs would never end.
  addD: (ds, n) => { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
  addBD: (ds, n) => O.shiftWorkingDays(ds, n, ctx),
  diffBD: (a, b) => { let n = 0; for (let d = a; d < b; d = O.shiftWorkingDays(d, 1, ctx)) n++; return n; },
  dayShiftToClear: () => 0 };
const run = (name, anchor) => { const src = slice(anchor); if (!src) { ok(`${name} found in TRAQS.jsx`, false, true); return null; } try { return build(src, webDeps); } catch (e) { ok(`${name} builds`, String(e.message), "ok"); return null; } };
{
  const enforceNoOverlap = run("enforceNoOverlap", "const enforceNoOverlap = (taskList, touchedIds) => {");
  if (enforceNoOverlap) {
    const tasks = job(op("C", { start: MON, end: MON, hpd: 8 }), op("A", { start: MON, end: MON, hpd: 8 }), op("B", { start: MON, end: MON, hpd: 8 }));
    let r; try { r = enforceNoOverlap(tasks, ["A", "B"]); } catch (e) { r = { error: e.message }; }
    ok("enforceNoOverlap: two touched ops land on different days (#53)", r.tasks ? r.tasks[0].subs[0].subs.map(o => o.start) : r, [MON, "2026-10-06", "2026-10-07"]);
  }
  // Root cause 7 D: nothing pushes any more — previewPush and the push dialog are gone, and a
  // landing onto someone's work is REFUSED by the shared check (dragMove.refuseDragMove). The
  // same two cases it used to cover: adjacent is not an overlap, and "7" and 7 are one person.
  ok("previewPush is gone (nothing pushes)", SRC.includes("const previewPush = ("), false);
  {
    const D = await import(new URL("../src/dragMove.js", import.meta.url).href);
    const { overlapContext } = await import(new URL("../src/overlapRules.js", import.meta.url).href);
    const tasks = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 2, team: ["7"] }), op("X", { start: "2026-10-06", end: "2026-10-06", startHour: 10, hpd: 2 }));
    const X = tasks[0].subs[0].subs[1];
    const ctx = { isLocked: () => false, isLive: () => false, isOverdue: () => false, timeOff: () => [], nowDay: "2026-09-30", nowHour: 8, business: true, tasks, overlapCtx: overlapContext({ workStart: "08:00", workEnd: "17:00", breaks: [], lunch: { time: "12:00", durationMinutes: 60 } }, "2026-09-30"), people: [] };
    const mover = (h) => [{ id: "X", node: X, shareH: 2, isRecord: false, reassigned: false, from: X, to: { start: MON, end: MON, startHour: h, endHour: h + 2, team: [7] } }];
    ok("refuse: X next to Y (adjacent) is allowed", D.refuseDragMove(mover(10), ctx), null);
    ok("refuse: X onto Y is refused, matching \"7\" and 7", D.refuseDragMove(mover(9), ctx)?.other?.unit?.id, "Y");
  }
  const checkOverlapsPure = run("checkOverlapsPure", "const checkOverlapsPure = (taskList, opsToCheck) => {");
  if (checkOverlapsPure) {
    const tasks = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4 }));
    const X = { personId: 7, start: MON, end: MON, startHour: 9, hpd: 2, team: [7], teamLength: 1, excludeOpId: "X", opTitle: "X", panelTitle: "P" };
    // A thrown error is a failure in its own right, never a result: a crash that returns
    // "something" would satisfy a length check.
    let r; try { r = checkOverlapsPure(tasks, [X]); } catch (e) { r = { error: e.message }; }
    ok("save check: a real hour overlap refuses (the capacity sum missed it)", Array.isArray(r) ? r.filter(c => !c.warnOnly).map(c => c.opTitle) : r, ["Y"]);
    let w; try { w = checkOverlapsPure(job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 6 })), [{ ...X, startHour: 15, hpd: 6 }]); } catch (e) { w = { error: e.message }; }
    ok("save check: over-booking the day only warns", Array.isArray(w) ? [w.filter(c => !c.warnOnly).length, w.some(c => c.warnOnly)] : w, [0, true]);
  }
  const reflowSrc = (() => { const at = SRC.indexOf("const reflowPhaseOps = (ops, opts) => {"); return at < 0 ? null : slice("const reflowPhaseOps = (ops, opts) => {"); })();
  if (!reflowSrc) ok("reflowPhaseOps found", false, true);
  else {
    const reflow = build(reflowSrc, { ...webDeps, isDated: (o) => !!(o && o.start && o.end), isAssigned: (o) => (o.team || []).length > 0 });
    const same = [op("A", { start: MON, end: MON, startHour: 8, hpd: 2 }), op("B", { start: MON, end: MON, startHour: 13, hpd: 2 })];
    let r; try { r = reflow(same, { overlap: ctx }); } catch (e) { r = e.message; }
    ok("reflow: two same-day ops that don't touch stay put", r, null);
    const lockedPair = [op("A", { start: MON, end: MON, startHour: 8, hpd: 4 }), op("L", { start: MON, end: MON, startHour: 9, hpd: 4, locked: true })];
    let r2; try { r2 = reflow(lockedPair, { overlap: ctx }); } catch (e) { r2 = e.message; }
    // reflow seeded its obstacle list from locked ops alone; with the flag gone
    // it starts empty and places every dated op, which is what "a clocked-out op
    // moves freely" means on this path.
    ok("reflow: a stray locked flag does not exempt an op", r2 instanceof Map ? r2.has("L") : r2, true);
  }
  // Root cause 7: the week/month ghost and drop both go through dragMove.refuseDragMove,
  // which asks the shared rule (overlapsWith) for every mover.
  const _dragSrc = readFileSync(new URL("../src/dragMove.js", import.meta.url), "utf8");
  ok("drag ghost asks the shared rule", SRC.includes("const _refusal = _refuse(_plan);") && _dragSrc.includes("overlapsWith(unit, standing"), true);
  ok("week/month drop re-checks the result", (SRC.match(/const _refusal = _refuse\(_plan\);/g) || []).length === 2 && SRC.includes("enforceNoOverlap(_build(tasks)"), true);
  // Root cause 7 B: the day view goes through the same refuseDragMove as week/month.
  ok("day-view drag checks overlap", SRC.includes("const refusal = _refuse(plan);") && SRC.includes("refuseDragMove(plan, { ..._refuseCtx"), true);
  // FIVE now: the three scheduler free-checks, the re-plan preflight, and the
  // run's own commit backstop (#344). Each asks the SAME oracle rather than
  // modelling availability itself — a preview, or a verifier, that answered "is
  // this person free" its own way is just another scheduler wearing a different
  // name, which is the thing the consolidation removed.
  //
  // The backstop is the sharpest case for this rule. What it replaced was a
  // hand-rolled date-interval scan that disagreed with the oracle in BOTH
  // directions: it called same-day-different-hours work a clash, and it could
  // not see hours, work days or time off at all. On a disagreement the run
  // aborted and discarded every placement it had made.
  //
  // The count is the weak half of this assertion; the reason is the strong
  // half. A SIXTH caller is fine if it asks this oracle, and the failure to
  // care about is a caller that does not appear here at all because it rolled
  // its own again.
  ok("every free-check goes through the shared oracle (three schedulers, the preflight, the backstop)",
    (SRC.match(/schedulerAvailability\(tasks, overlapCtx/g) || []).length, 5);
  // And the scan it replaced must not come back.
  ok("…and no hand-rolled date-interval scan stands beside it",
    /\.start\s*<=\s*\w+\.end\s*&&\s*\w+\.end\s*>=\s*\w+\.start[\s\S]{0,120}?overlapErrors/.test(SRC), false);
  ok("…and no longer compare whole days themselves", /const isPersonFree(Local|Global)?\s*=\s*\(pid,\s*(checkStart|s)\b[^\n]*\n\s*const pp\s*=/.test(SRC), false);
  ok("the save seeds start hours from the shared rule, siblings included", SRC.includes("nextFreeStart(") && SRC.includes("_seeded.push("), true);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. Server: overlap in log mode (OVERLAP_RULE_MODE), Business only");
{
  let logs = [];
  const realWarn = console.warn;
  console.warn = (...a) => { if (typeof a[0] === "string" && a[0].startsWith("{")) { try { const o = JSON.parse(a[0]); if (o.tag) { logs.push(o); return; } } catch {} } realWarn(...a); };
  const K = { tasks: "orgs/TESTORG/tasks.json", people: "orgs/TESTORG/people.json", settings: "orgs/TESTORG/settings.json", billing: "orgs/TESTORG/billing.json" };
  const clean = job(op("Y", { start: MON, end: MON, startHour: 8, hpd: 4 }), op("X", { start: MON, end: MON, startHour: 13, hpd: 2 }));
  const seed = (mode, tier) => {
    if (mode === undefined) delete process.env.OVERLAP_RULE_MODE; else process.env.OVERLAP_RULE_MODE = mode;
    process.env.SCHEDULE_RULES_MODE = "off"; process.env.TASK_CONFLICT_MODE = "off"; delete process.env.PERMISSION_GATES_MODE;
    logs = []; globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
    globalThis.__S3 = { [K.tasks]: JSON.parse(JSON.stringify(clean)), [K.people]: [{ id: 1, userRole: "admin" }, { id: 7 }], [K.settings]: SETTINGS, ...(tier ? { [K.billing]: { tier } } : {}) };
    globalThis.__AUTH = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
  };
  const moveOnto = () => { const t = JSON.parse(JSON.stringify(clean)); t[0].subs[0].subs[1].startHour = 9; return t; };
  const post = (t) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(t) });
  const overlapLogs = () => logs.filter(l => l.tag === "schedule-rule" && l.rule === "overlap").map(l => [l.mode, l.id]);
  seed(undefined, "business");
  { const r = await post(moveOnto()); ok("log (default): accepted, the overlap is logged", [r.statusCode, overlapLogs()], [200, [["log", "X"]]]); }
  seed("enforce", "business");
  { const r = await post(moveOnto()); ok("enforce: refused with 422 naming it", [r.statusCode, (r.body?.violations || []).map(v => v.rule)], [422, ["overlap"]]); }
  seed("enforce", null);
  { const r = await post(moveOnto()); ok("Basic (no billing record): double-booking allowed, nothing logged", [r.statusCode, overlapLogs()], [200, []]); }
  seed("off", "business");
  { const r = await post(moveOnto()); ok("off: accepted, nothing logged", [r.statusCode, overlapLogs()], [200, []]); }
  console.warn = realWarn;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
