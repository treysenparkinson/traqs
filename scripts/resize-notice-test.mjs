// Every committed resize says what it did (#550, plan step 3).
//
// "it just does it and i dont always know": a resize rewrote an op's dates AND its hours and
// saved without a word. resizeNotice turns the committed plan into the notice's text — op,
// person, old → new hours (the team's total, which is what hpd is), and the edge that moved —
// and both commit paths raise it.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const D = await import(pathToFileURL(path.join(root, "src/dragMove.js")).href);
const SM = await import(pathToFileURL(path.join(root, "src/statsMath.js")).href);
const { workCalendar } = await import(pathToFileURL(path.join(root, "src/scheduleRules.js")).href);
const WEB = fs.readFileSync(path.join(root, "src/TRAQS.jsx"), "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const check = (name, fn) => {
  let ok = false, why = "";
  try { const r = fn(); ok = r === true; if (!ok) why = ` (got ${JSON.stringify(r)})`; } catch (e) { why = ` (threw ${e.message})`; }
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${why}`); }
};
const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : { got: a, want: b });
const count = (src, s) => src.split(s).length - 1;

const settings = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const cfg = SM.buildDayWindows(8, 17, settings.breaks, settings.lunch);
const cal = workCalendar(settings);
const fmtDay = (d) => ({ "2026-10-05": "Mon", "2026-10-06": "Tue", "2026-10-07": "Wed", "2026-10-08": "Thu" })[d] || d;
const fmtHour = (h) => `${h}:00`;
// A resize plan exactly as resizeSession builds one: the grabbed bar, with the new total hpd.
const plan = ({ node, fromDay, fromHour, shareH, hpd }) => D.planDragMove({
  grabbed: { id: node.id, node, fromDay, fromHour, shareH, hpd }, drop: { day: fromDay, hour: fromHour },
  origPerson: "w", dropPerson: "w", cfg, cal, workStartH: 8, workEndH: 17,
});

console.log("resizeNotice: what the notice says");
const W = { id: "W", title: "Panel 3 wiring", start: "2026-10-05", end: "2026-10-06", startHour: 8, endHour: 17, hpd: 16, team: ["w"] };
{
  const p = plan({ node: W, fromDay: "2026-10-05", fromHour: 8, shareH: 24, hpd: 24 });   // right edge Tue → Wed
  check("a solo op grown a day", () => eq(D.resizeNotice(p, { side: "right", who: "Marco", fmtDay, fmtHour }).text,
    "Resized Panel 3 wiring (Marco): 16h → 24h, ends Wed instead of Tue"));
  check("the notice carries the op's id", () => eq(D.resizeNotice(p, { side: "right", who: "Marco", fmtDay, fmtHour }).id, "W"));
}
{
  const p = plan({ node: W, fromDay: "2026-10-06", fromHour: 8, shareH: 8, hpd: 8 });      // left edge Mon → Tue
  check("a left-edge resize names the start", () => eq(D.resizeNotice(p, { side: "left", who: "Marco", fmtDay, fmtHour }).text,
    "Resized Panel 3 wiring (Marco): 16h → 8h, starts Tue instead of Mon"));
}
{
  // Crew of two, 8 h each over one day = 16 h on the op. One more day each: 32 h total.
  const C = { id: "C", title: "Crate", start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 17, hpd: 16, team: ["w", "x"] };
  const p = plan({ node: C, fromDay: "2026-10-05", fromHour: 8, shareH: 16, hpd: 32 });
  check("a crew op shows the TEAM's total, not one person's share", () => eq(D.resizeNotice(p, { side: "right", who: "Marco", fmtDay, fmtHour }).text,
    "Resized Crate (Marco): 16h → 32h, ends Tue instead of Mon"));
}
{
  // Month view: same day, the end time moves 12:00 → 11:00.
  const A = { id: "A", title: "Terminate", start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 12, hpd: 4, team: ["w"] };
  const p = plan({ node: A, fromDay: "2026-10-05", fromHour: 8, shareH: 3, hpd: 3 });
  check("same day: the end TIME is named", () => eq(D.resizeNotice(p, { side: "right", who: "", fmtDay, fmtHour }).text,
    "Resized Terminate: 4h → 3h, ends 11:00 instead of 12:00"));
}
check("a plan that isn't a resize (no hpd) has no notice", () => {
  const p = D.planDragMove({ grabbed: { id: "W", node: W, fromDay: "2026-10-05", fromHour: 8, shareH: 16 }, drop: { day: "2026-10-06", hour: 8 }, origPerson: "w", dropPerson: "w", cfg, cal, workStartH: 8, workEndH: 17 });
  return eq(D.resizeNotice(p, { side: "right", fmtDay, fmtHour }), null);
});

console.log("undoResizePlan: the notice's Undo reverses only that resize (step 4)");
{
  const W0 = { ...W, moveLog: [] };
  const S = { id: "S", title: "Sibling", start: "2026-10-07", end: "2026-10-07", startHour: 8, endHour: 12, hpd: 4, team: ["w"] };
  const tree = (...ops) => [{ id: "j", title: "J", subs: [{ id: "p", title: "P", subs: ops }] }];
  const op = (t, id) => t[0].subs[0].subs.find(o => o.id === id);
  const p = plan({ node: W0, fromDay: "2026-10-05", fromHour: 8, shareH: 24, hpd: 24 });
  const after = D.applyDragMove(tree(W0, S), p, { date: "2026-10-16", movedBy: "T", reason: "Resized in schedule", people: [] });
  const shape = (o) => [o.start, o.end, o.startHour, o.endHour, o.hpd];
  check("the resize really landed (fixture sanity)", () => eq(shape(op(after, "W")), ["2026-10-05", "2026-10-07", 8, 17, 24]));

  const rev = D.undoResizePlan(after, p);
  check("unchanged since: there is a reverse plan", () => eq(Array.isArray(rev) && rev.length, 1));
  const undone = D.applyDragMove(after, rev, { date: "2026-10-16", movedBy: "T", reason: "Resize undone", people: [] });
  check("…and it restores dates AND hours exactly", () => eq(shape(op(undone, "W")), shape(W0)));
  check("…logging 'Resize undone' on top of the resize (history is append-only)", () => eq(op(undone, "W").moveLog.map(l => [l.reason, l.fromHpd, l.toHpd]), [["Resized in schedule", 16, 24], ["Resize undone", 24, 16]]));
  check("…without touching the team", () => eq(op(undone, "W").team, ["w"]));

  const movedSince = after.map(j => ({ ...j, subs: j.subs.map(pn => ({ ...pn, subs: pn.subs.map(o => o.id === "W" ? { ...o, start: "2026-10-06", end: "2026-10-08" } : o) })) }));
  check("moved since: no Undo", () => eq(D.undoResizePlan(movedSince, p), null));
  const hoursSince = after.map(j => ({ ...j, subs: j.subs.map(pn => ({ ...pn, subs: pn.subs.map(o => o.id === "W" ? { ...o, hpd: 20 } : o) })) }));
  check("hours edited since: no Undo", () => eq(D.undoResizePlan(hoursSince, p), null));
  check("deleted since: no Undo", () => eq(D.undoResizePlan(tree(S), p), null));

  const sibSince = after.map(j => ({ ...j, subs: j.subs.map(pn => ({ ...pn, subs: pn.subs.map(o => o.id === "S" ? { ...o, startHour: 13, endHour: 17 } : o) })) }));
  const rev2 = D.undoResizePlan(sibSince, p);
  const undone2 = D.applyDragMove(sibSince, rev2, { date: "2026-10-16", movedBy: "T", reason: "Resize undone", people: [] });
  check("a sibling edited since: the op is restored", () => eq(shape(op(undone2, "W")), shape(W0)));
  check("…and the sibling's edit survives", () => eq([op(undone2, "S").startHour, op(undone2, "S").endHour], [13, 17]));
  check("a plan that is not a resize: no Undo", () => {
    const mv = D.planDragMove({ grabbed: { id: "W", node: W0, fromDay: "2026-10-05", fromHour: 8, shareH: 16 }, drop: { day: "2026-10-06", hour: 8 }, origPerson: "w", dropPerson: "w", cfg, cal, workStartH: 8, workEndH: 17 });
    return eq(D.undoResizePlan(D.applyDragMove(tree(W0), mv, { date: "x", movedBy: "T", people: [] }), mv), null);
  });
}

console.log("undoResizePlan / resizeNotice: review follow-ups");
{
  const W0 = { ...W, moveLog: [] };
  const p = plan({ node: W0, fromDay: "2026-10-05", fromHour: 8, shareH: 24, hpd: 24 });
  const after = D.applyDragMove([{ id: "j", title: "J", subs: [{ id: "p", title: "P", subs: [W0] }] }], p, { date: "x", movedBy: "T", people: [] });
  const soft = (f) => after.map(j => f({ ...j, subs: j.subs.map(pn => ({ ...pn, subs: pn.subs.map(o => ({ ...o })) })) }));
  check("a soft-deleted op (deletedAt) has no Undo", () => eq(D.undoResizePlan(soft(j => { j.subs[0].subs[0].deletedAt = "2026-10-16"; return j; }), p), null));
  check("an op under a soft-deleted panel has no Undo", () => eq(D.undoResizePlan(soft(j => { j.subs[0].deletedAt = "2026-10-16"; return j; }), p), null));
  check("an op under a soft-deleted job has no Undo", () => eq(D.undoResizePlan(soft(j => ({ ...j, deletedAt: "2026-10-16" })), p), null));
  const N = { ...W0, hpd: undefined };
  const pn = plan({ node: N, fromDay: "2026-10-05", fromHour: 8, shareH: 24, hpd: 24 });
  check("no stored estimate before: 'set to 24h', not '0h → 24h'", () => eq(D.resizeNotice(pn, { side: "right", who: "", fmtDay, fmtHour }).text, "Resized Panel 3 wiring: set to 24h, ends Wed instead of Tue"));
}

console.log("TRAQS.jsx: the notice's Undo, driving the real undoResizeNote");
{
  const { overlapContext } = await import(pathToFileURL(path.join(root, "src/overlapRules.js")).href);
  const octx = overlapContext(settings, "2026-09-30");
  const braceSlice = (src, sig) => {
    const a = src.indexOf(sig); if (a < 0 || src.indexOf(sig, a + 1) >= 0) throw new Error("anchor not unique: " + sig);
    let i = src.indexOf("{", src.indexOf("=>", a)), d = 0;
    for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) break; }
    return src.slice(a, i + 1);
  };
  const SRC = braceSlice(WEB, "const undoResizeNote = () =>").replace(/^const undoResizeNote = /, "");
  // A: Mon 08–12 (4 h), resized to 08–11 (3 h). The notice holds that plan.
  const A = { id: "A", title: "A", start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 12, hpd: 4, team: ["w"], moveLog: [] };
  const tree = (...ops) => [{ id: "j", title: "J", subs: [{ id: "p", title: "P", subs: ops }] }];
  const pA = plan({ node: A, fromDay: "2026-10-05", fromHour: 8, shareH: 3, hpd: 3 });
  const resized = D.applyDragMove(tree(A), pA, { date: "x", movedBy: "T", reason: "Resized in schedule", people: [] });
  const run = ({ tasks0, perm = true, bump = false }) => {
    let state = tasks0, writes = 0, saves = 0;
    const toasts = [], ref = { current: tasks0 };
    const scope = {
      resizeNote: { plan: pA }, can: () => perm, denied: (v) => toasts.push("denied " + v), PERM_VERB: { moveJobs: "move jobs" },
      holdResizeNote: () => {}, setResizeNote: () => {}, latestTasksRef: ref, tasks: tasks0, toast: (m) => toasts.push(m),
      refuseDragMove: D.refuseDragMove, refusalMessage: D.refusalMessage, applyDragMove: D.applyDragMove, undoResizePlan: D.undoResizePlan,
      blockedByActiveClock: () => false, jobIdOfNode: () => "j", sameId: (a, b) => String(a) === String(b),
      people: [{ id: "w", name: "Wes", timeOff: [] }], shopDay: () => "2026-09-30", shopHour: () => 10, billingTier: "business", overlapCtx: octx,
      loggedInUser: { name: "T" }, recalcBounds: (t) => t, TD: "2026-10-16",
      enforceNoOverlap: () => ({ moved: bump ? ["B"] : [], refused: [] }),
      setTasks: (v) => { const n = typeof v === "function" ? v(state) : v; if (n !== state) writes++; state = n; ref.current = n; },
      setTimeout: (f) => f(), doSaveRef: { current: () => { saves++; } },
    };
    const proxy = new Proxy(scope, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : globalThis[k])) });
    new Function("scope", `with (scope) { return ${SRC}; }`)(proxy)();
    return { state, writes, saves, toasts, a: state[0].subs[0].subs.find(o => o.id === "A") };
  };
  const ok = run({ tasks0: resized });
  check("Undo: one write, one save, A back to 08–12 / 4 h", () => eq([ok.writes, ok.saves, ok.a.endHour, ok.a.hpd], [1, 1, 12, 4]));
  check("…logged 'Resize undone', and the toast says so", () => eq([ok.a.moveLog.at(-1).reason, ok.toasts], ["Resize undone", ["Resize undone"]]));
  // B moved into the freed 11–12 slot after the resize. A is untouched, so Undo is offered — and must refuse.
  const B = { id: "B", title: "B", start: "2026-10-05", end: "2026-10-05", startHour: 11, endHour: 12, hpd: 1, team: ["w"] };
  const withB = resized.map(j => ({ ...j, subs: j.subs.map(pn => ({ ...pn, subs: [...pn.subs, B] })) }));
  const ov = run({ tasks0: withB });
  check("work placed in the freed time since: refused, nothing written", () => eq([ov.writes, ov.saves, ov.a.hpd], [0, 0, 3]));
  check("…with the overlap message, not 'Resize undone'", () => (ov.toasts.length === 1 && /^Can't undo: .*overlap/.test(ov.toasts[0]) ? true : ov.toasts));
  const bump = run({ tasks0: resized, bump: true });
  check("the no-overlap backstop refuses too", () => eq([bump.writes, bump.saves, /^Can't undo/.test(bump.toasts[0])], [0, 0, true]));
  const moved = run({ tasks0: resized.map(j => ({ ...j, subs: j.subs.map(pn => ({ ...pn, subs: pn.subs.map(o => ({ ...o, startHour: 9 })) })) })) });
  check("changed since: nothing written, says so", () => eq([moved.writes, moved.toasts], [0, ["That changed since, so there's nothing to undo"]]));
  const noPerm = run({ tasks0: resized, perm: false });
  check("without moveJobs: refused, as the resize was (C4)", () => eq([noPerm.writes, noPerm.toasts], [0, ["denied move jobs"]]));
  check("the button reads the memoised check, gated on moveJobs", () => count(WEB, "const _noteUndoPlan = useMemo(() => (resizeNote ? undoResizePlan(tasks, resizeNote.plan) : null), [resizeNote, tasks]);") === 1
    && count(WEB, "const _noteUndo = _noteUndoPlan && can(\"moveJobs\");") === 1 && count(WEB, "{_noteUndo && <button") === 1);
}

console.log("TRAQS.jsx: both commit paths raise it");
check("week/month: the resize commit raises the notice", () => count(WEB, "noteResize(plan, side, p.name);") === 1);
check("day view: a committed resize (not a move) raises it", () => count(WEB, "if (mode !== \"move\") noteResize(plan, mode, people.find(x => sameId(x.id, fromPersonId))?.name);") === 1);
check("the notice is rendered", () => count(WEB, "{resizeNote && createPortal(") === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
