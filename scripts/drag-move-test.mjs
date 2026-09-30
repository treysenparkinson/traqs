// Week/month schedule move (root cause 7, chunk A). One landing for the ghost, every check
// and the commit; every mover checked; a moveLog on every moved op; the dead path gone.
//
// Red-first hooks: DRAG_SRC points the module import at another copy (a placeholder),
// DRAG_WEB_SRC points the web checks at another TRAQS.jsx (HEAD).
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = await import(pathToFileURL(process.env.DRAG_SRC ? path.resolve(process.env.DRAG_SRC) : path.join(root, "src/dragMove.js")).href);
const SM = await import(pathToFileURL(path.join(root, "src/statsMath.js")).href);
const { workCalendar } = await import(pathToFileURL(path.join(root, "src/scheduleRules.js")).href);
const { overlapContext } = await import(pathToFileURL(path.join(root, "src/overlapRules.js")).href);

let pass = 0, fail = 0;
const check = (name, fn) => {
  let ok = false, why = "";
  try { const r = fn(); ok = r === true; if (!ok) why = ` (got ${JSON.stringify(r)})`; } catch (e) { why = ` (threw ${e.message})`; }
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${why}`); }
};
const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : { got: a, want: b });

// Matrix's shape: 08:00–17:00, lunch 12:00 for 60, breaks 10:00 and 14:00 for 15 → 7.5 h.
const settings = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [{ time: "10:00", durationMinutes: 15 }, { time: "14:00", durationMinutes: 15 }], workDays: [1, 2, 3, 4, 5], holidays: [] };
const cfg = SM.buildDayWindows(8, 17, settings.breaks, settings.lunch);
const cal = workCalendar(settings);
const octx = overlapContext(settings, "2026-09-30");
const base = { cfg, cal, workStartH: 8, workEndH: 17 };
const op = (id, start, end, startHour, hpd, team, extra = {}) => ({ id, title: id, start, end, startHour, hpd, team, ...extra });
const jobOf = (...ops) => [{ id: "j1", title: "Job", subs: [{ id: "p1", title: "Panel", subs: ops }] }];
const ctxFor = (tasks, over = {}) => ({
  isLocked: n => !!n.locked, isLive: () => false, isOverdue: () => false, timeOff: () => [],
  nowDay: "2026-09-30", nowHour: 10, business: true, tasks, overlapCtx: octx, ...over,
});

console.log("1. #25 — the drag starts where the bar is PAINTED, and the drop is tested where it lands");
{
  // Stored Tue 08:00, painted at the cursor Wed 10:00; dragged one day right → Thu 10:00.
  const o = op("o1", "2026-09-29", "2026-09-30", 8, 15, ["a"]);
  const movers = D.planDragMove({ grabbed: { id: "o1", node: o, fromDay: "2026-09-30", fromHour: 10, shareH: 15 }, drop: { day: "2026-10-01", hour: 10 }, origPerson: "a", dropPerson: "a", ...base });
  check("lands at Thu 10:00, where the ghost showed it", () => eq([movers[0].to.start, movers[0].to.startHour], ["2026-10-01", 10]));
  check("…and is NOT refused as the past", () => eq(D.refuseDragMove(movers, ctxFor(jobOf(o))), null));
  const back = D.planDragMove({ grabbed: { id: "o1", node: o, fromDay: "2026-09-30", fromHour: 10, shareH: 15 }, drop: { day: "2026-09-30", hour: 8 }, origPerson: "a", dropPerson: "a", ...base });
  check("a landing before now IS refused as the past", () => eq(D.refuseDragMove(back, ctxFor(jobOf(o)))?.kind, "past"));
}

console.log("2. #22 #23 — one end for PTO, overlap and the commit");
{
  // 7.5 h dropped at 11:00: the walk crosses lunch and both breaks → ends Fri 10:15... whatever the walk says.
  const o = op("o1", "2026-10-05", "2026-10-05", 8, 7.5, ["a"]);
  const movers = D.planDragMove({ grabbed: { id: "o1", node: o, fromDay: "2026-10-05", fromHour: 8, shareH: 7.5 }, drop: { day: "2026-10-01", hour: 11 }, origPerson: "a", dropPerson: "a", ...base });
  const w = SM.walkProductiveHours(11, 7.5, cfg);
  const want = { start: "2026-10-01", end: cal.add("2026-10-01", w.days - 1), endHour: w.endHour };
  check("landing end is the walk's", () => eq({ start: movers[0].to.start, end: movers[0].to.end, endHour: movers[0].to.endHour }, want));
  check("…which crosses into the next day (lunch and breaks counted)", () => eq(movers[0].to.end, "2026-10-02"));
  const pto = (d) => ctxFor(jobOf(o), { timeOff: pid => (pid === "a" ? [{ start: d, end: d, reason: "PTO" }] : []) });
  check("time off on the landing's LAST day refuses", () => eq(D.refuseDragMove(movers, pto("2026-10-02"))?.kind, "pto"));
  check("time off the day after does not", () => eq(D.refuseDragMove(movers, pto("2026-10-05")), null));
  const next = D.applyDragMove(jobOf(o), movers, { date: "2026-09-30", movedBy: "T" });
  const written = next[0].subs[0].subs[0];
  check("the commit writes that same end", () => eq([written.start, written.startHour, written.end, written.endHour], [want.start, 11, want.end, want.endHour]));
}

console.log("3. #18 — every member is checked, not just the grabbed bar");
{
  const g = op("g", "2026-10-05", "2026-10-05", 8, 2, ["a"]);
  const m = op("m", "2026-10-05", "2026-10-05", 13, 2, ["b"]);
  const busy = op("busy", "2026-10-06", "2026-10-06", 13, 2, ["b"]);
  const tasks = jobOf(g, m, busy);
  const plan = (drop) => D.planDragMove({ grabbed: { id: "g", node: g, fromDay: "2026-10-05", fromHour: 8, shareH: 2 }, members: [{ id: "m", node: m, day: m.start, hour: 13, shareH: 2 }], drop, origPerson: "a", dropPerson: "a", ...base });
  const tomorrow = plan({ day: "2026-10-06", hour: 8 });
  check("member follows the move (Tue 13:00)", () => eq([tomorrow[1].to.start, tomorrow[1].to.startHour], ["2026-10-06", 13]));
  const r = D.refuseDragMove(tomorrow, ctxFor(tasks));
  check("a MEMBER landing on someone's work refuses, naming the member", () => eq([r?.kind, r?.id, r?.other?.unit?.id], ["overlap", "m", "busy"]));
  check("…the same move with the member's slot free is allowed", () => eq(D.refuseDragMove(tomorrow, ctxFor(jobOf(g, m))), null));
  check("a member landing on its person's time off refuses", () =>
    eq(D.refuseDragMove(tomorrow, ctxFor(jobOf(g, m), { timeOff: pid => (pid === "b" ? [{ start: "2026-10-06", end: "2026-10-06" }] : []) }))?.id, "m"));
  // Grabbed Thu 08:00 → Wed 11:00 (fine, now is Wed 10:00); the member Wed 13:00 → Tue 16:00, the past.
  const g2 = op("g", "2026-10-01", "2026-10-01", 8, 2, ["a"]), m2 = op("m", "2026-09-30", "2026-09-30", 13, 2, ["b"]);
  const early = D.planDragMove({ grabbed: { id: "g", node: g2, fromDay: "2026-10-01", fromHour: 8, shareH: 2 }, members: [{ id: "m", node: m2, day: m2.start, hour: 13, shareH: 2 }], drop: { day: "2026-09-30", hour: 11 }, origPerson: "a", dropPerson: "a", ...base });
  check("a member landing in the past refuses, naming it", () => eq([D.refuseDragMove(early, ctxFor(jobOf(g2, m2)))?.kind, D.refuseDragMove(early, ctxFor(jobOf(g2, m2)))?.id], ["past", "m"]));
  check("a member someone is clocked into refuses", () =>
    eq(D.refuseDragMove(tomorrow, ctxFor(jobOf(g, m), { isLive: n => n.id === "m" }))?.kind, "live"));
  check("member hour shift rolls over the end of the day", () => {
    const late = D.shiftStart({ day: "2026-10-01", hour: 15 }, { bdDelta: 0, hourDelta: 3 }, base);
    return eq([late.day, late.hour], ["2026-10-02", 9]);
  });
  check("member day shift skips the weekend", () => eq(D.shiftStart({ day: "2026-10-02", hour: 8 }, { bdDelta: 1, hourDelta: 0 }, base).day, "2026-10-05"));
}

console.log("4. #4 — a locked op can't be moved, grabbed or carried");
{
  const g = op("g", "2026-10-05", "2026-10-05", 8, 2, ["a"], { locked: true });
  const m = op("m", "2026-10-05", "2026-10-05", 13, 2, ["a"], { locked: true });
  const free = op("f", "2026-10-05", "2026-10-05", 8, 2, ["a"]);
  const one = D.planDragMove({ grabbed: { id: "g", node: g, fromDay: g.start, fromHour: 8, shareH: 2 }, drop: { day: "2026-10-06", hour: 8 }, origPerson: "a", dropPerson: "a", ...base });
  check("grabbed locked op → refused 'locked'", () => eq(D.refuseDragMove(one, ctxFor(jobOf(g)))?.kind, "locked"));
  const carry = D.planDragMove({ grabbed: { id: "f", node: free, fromDay: free.start, fromHour: 8, shareH: 2 }, members: [{ id: "m", node: m, day: m.start, hour: 13, shareH: 2 }], drop: { day: "2026-10-06", hour: 8 }, origPerson: "a", dropPerson: "a", ...base });
  check("a locked MEMBER refuses the drag, naming it", () => eq([D.refuseDragMove(carry, ctxFor(jobOf(free, m)))?.kind, D.refuseDragMove(carry, ctxFor(jobOf(free, m)))?.id], ["locked", "m"]));
  check("locked applies on Basic too", () => eq(D.refuseDragMove(one, ctxFor(jobOf(g), { business: false }))?.kind, "locked"));
}

console.log("5. #20 — a member over its estimate refuses the drag and is named");
{
  const g = op("g", "2026-10-05", "2026-10-05", 8, 2, ["a"]), m = op("m", "2026-10-05", "2026-10-05", 13, 2, ["a"]);
  const mv = D.planDragMove({ grabbed: { id: "g", node: g, fromDay: g.start, fromHour: 8, shareH: 2 }, members: [{ id: "m", node: m, day: m.start, hour: 13, shareH: 2 }], drop: { day: "2026-10-06", hour: 8 }, origPerson: "a", dropPerson: "a", ...base });
  const r = D.refuseDragMove(mv, ctxFor(jobOf(g, m), { isOverdue: n => n.id === "m" }));
  check("refused 'overdue' naming the member", () => eq([r?.kind, r?.id], ["overdue", "m"]));
  check("the message names it", () => (D.refusalMessage(r).includes('"m"') ? true : D.refusalMessage(r)));
}

console.log("6. #19 — multi-select reassign: the grabbed bar's row follows, other rows keep their person");
{
  const g = op("g", "2026-10-05", "2026-10-05", 8, 2, ["a"]);
  const sameRow = op("s", "2026-10-05", "2026-10-05", 13, 2, ["a", "c"]);
  const otherRow = op("x", "2026-10-05", "2026-10-05", 13, 2, ["b"]);
  const movers = D.planDragMove({ grabbed: { id: "g", node: g, fromDay: g.start, fromHour: 8, shareH: 2 }, members: [{ id: "s", node: sameRow, day: "2026-10-05", hour: 13, shareH: 1 }, { id: "x", node: otherRow, day: "2026-10-05", hour: 13, shareH: 2 }], drop: { day: "2026-10-06", hour: 8 }, origPerson: "a", dropPerson: "d", ...base });
  check("grabbed bar → d", () => eq(movers[0].to.team, ["d"]));
  check("member on a's row → d (its other person kept)", () => eq(movers[1].to.team, ["d", "c"]));
  check("member on b's row keeps b, dates move", () => eq([movers[2].to.team, movers[2].to.start, movers[2].reassigned], [["b"], "2026-10-06", false]));
  const next = D.applyDragMove(jobOf(g, sameRow, otherRow), movers, { date: "2026-09-30", movedBy: "T" });
  const ops = next[0].subs[0].subs;
  check("written teams", () => eq(ops.map(o => o.team), [["d"], ["d", "c"], ["b"]]));
  // Two members reassigned onto d at the same slot must not land on top of each other.
  const m1 = op("m1", "2026-10-05", "2026-10-05", 13, 2, ["a"]);
  const clash = D.planDragMove({ grabbed: { id: "g", node: g, fromDay: g.start, fromHour: 13, shareH: 2 }, members: [{ id: "m1", node: m1, day: "2026-10-05", hour: 13, shareH: 2 }], drop: { day: "2026-10-06", hour: 13 }, origPerson: "a", dropPerson: "d", ...base });
  check("movers landing on each other refuse", () => eq(D.refuseDragMove(clash, ctxFor(jobOf(g, m1)))?.kind, "overlap"));
}

console.log("7. #3 — every moved op gets a moveLog entry");
{
  const g = op("g", "2026-10-05", "2026-10-05", 8, 2, ["a"], { moveLog: [{ reason: "Manual resize" }] });
  const m = op("m", "2026-10-05", "2026-10-05", 13, 2, ["b"]);
  const movers = D.planDragMove({ grabbed: { id: "g", node: g, fromDay: g.start, fromHour: 8, shareH: 2 }, members: [{ id: "m", node: m, day: "2026-10-05", hour: 13, shareH: 2 }], drop: { day: "2026-10-06", hour: 9 }, origPerson: "a", dropPerson: "d", ...base });
  const ops = D.applyDragMove(jobOf(g, m), movers, { date: "2026-09-30", movedBy: "T" })[0].subs[0].subs;
  check("grabbed: history kept, entry appended", () => eq(ops[0].moveLog.map(l => l.reason), ["Manual resize", "Moved in schedule"]));
  check("grabbed entry: from/to dates and hours, and the reassign", () => {
    const l = ops[0].moveLog[1];
    return eq([l.fromStart, l.toStart, l.fromStartHour, l.toStartHour, l.fromTeam, l.toTeam, l.movedBy, l.date], ["2026-10-05", "2026-10-06", 8, 9, ["a"], ["d"], "T", "2026-09-30"]);
  });
  check("member gets its own entry", () => eq([ops[1].moveLog?.length, ops[1].moveLog?.[0]?.toStart, ops[1].moveLog?.[0]?.toStartHour], [1, "2026-10-06", 14]));
  const panelLevel = [{ id: "j1", subs: [{ id: "p1", title: "P", start: "2026-10-05", end: "2026-10-05", startHour: 8, team: ["a"], subs: [] }] }];
  const pm = D.planDragMove({ grabbed: { id: "p1", node: panelLevel[0].subs[0], fromDay: "2026-10-05", fromHour: 8, shareH: 2 }, drop: { day: "2026-10-07", hour: 8 }, origPerson: "a", dropPerson: "a", ...base });
  check("a panel-level bar moves and is logged too", () => { const p = D.applyDragMove(panelLevel, pm, { date: "x", movedBy: "T" })[0].subs[0]; return eq([p.start, p.moveLog?.length], ["2026-10-07", 1]); });
}

console.log("8. Basic — overlap and past are Business-only");
{
  const g = op("g", "2026-10-05", "2026-10-05", 8, 2, ["a"]), busy = op("busy", "2026-09-29", "2026-09-29", 8, 2, ["a"]);
  const mv = D.planDragMove({ grabbed: { id: "g", node: g, fromDay: g.start, fromHour: 8, shareH: 2 }, drop: { day: "2026-09-29", hour: 8 }, origPerson: "a", dropPerson: "a", ...base });
  check("Business: refused", () => (D.refuseDragMove(mv, ctxFor(jobOf(g, busy))) ? true : "not refused"));
  check("Basic: allowed onto the past and onto other work", () => eq(D.refuseDragMove(mv, ctxFor(jobOf(g, busy), { business: false })), null));
}

console.log("9. the web uses the one landing (TRAQS.jsx)");
{
  const src = fs.readFileSync(process.env.DRAG_WEB_SRC || path.join(root, "src/TRAQS.jsx"), "utf8");
  const a = src.indexOf("const handleTeamDrag = (e) => {"), b = src.indexOf("const handleTeamResize = (e, side) => {", a);
  const H = a >= 0 && b > a ? src.slice(a, b) : "";
  check("handleTeamDrag found", () => H.length > 0);
  check("the move plans, checks and commits through dragMove.js", () =>
    (/planDragMove\(/.test(H) && /refuseDragMove\(/.test(H) && /applyDragMove\(/.test(H)) ? true : "missing");
  check("the dead week path is gone (#2)", () => (!/groupFinalMoves|previewPush\(|applyReassign|_finalVWD/.test(H) ? true : "still there"));
  check("the drag starts from the painted position (#25)", () => (/fromDay:\s*_layoutStart/.test(H) || /_paintedDay\s*=\s*_layoutStart/.test(H) ? true : "stored origin"));
  check("the ghost no longer adds the grabbed bar's old push (#25)", () => (!/pushBD|pushHourDelta/.test(src) ? true : "push transform still applied"));
  check("no silent skip of a member over its estimate (#20)", () => (!/isOverdueHours\) \{ found = true; break; \}/.test(H) ? true : "silent skip"));
  check("the commit is backstopped by the no-overlap guard", () => (/enforceNoOverlap\(/.test(H) ? true : "no backstop"));
  check("the drop is refused, never pushed (ruling 1)", () => (!/setConfirmPush\(/.test(H) ? true : "push dialog in the move"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
