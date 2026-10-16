// Week/month resize and drag ghosts (root cause 7, chunk C).
//
// The headline check drives the REAL handleTeamResize, sliced out of TRAQS.jsx, through a
// five-step drag with the REAL undo-recording setTasks wrapper (also sliced), and counts:
// writes, undo snapshots and saves must be ONE each, and nothing may be written mid-drag.
//
// Red-first hook: RESIZE_WEB_SRC → another TRAQS.jsx (the pre-change copy) — the same harness
// then drives the old handler, which writes on every step.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SM = await import(pathToFileURL(path.join(root, "src/statsMath.js")).href);
const D = await import(pathToFileURL(path.join(root, "src/dragMove.js")).href);
const { workCalendar } = await import(pathToFileURL(path.join(root, "src/scheduleRules.js")).href);
const { overlapContext } = await import(pathToFileURL(path.join(root, "src/overlapRules.js")).href);
const WEB = fs.readFileSync(process.env.RESIZE_WEB_SRC || path.join(root, "src/TRAQS.jsx"), "utf8");
const CUR = fs.readFileSync(path.join(root, "src/TRAQS.jsx"), "utf8");

let pass = 0, fail = 0;
const check = (name, fn) => {
  let ok = false, why = "";
  try { const r = fn(); ok = r === true; if (!ok) why = ` (got ${JSON.stringify(r)})`; } catch (e) { why = ` (threw ${e.message})`; }
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${why}`); }
};
const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : { got: a, want: b });
const near = (a, b, tol = 1e-9) => (Math.abs(a - b) <= tol ? true : { got: a, want: b });
const braceSlice = (src, sig) => {
  const a = src.indexOf(sig); if (a < 0) throw new Error("not found: " + sig);
  let i = src.indexOf("{", src.indexOf("=>", a)), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) break; }
  return src.slice(a, i + 1);
};

const settings = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const cfg = SM.buildDayWindows(8, 17, settings.breaks, settings.lunch);
const fullCfg = { ...cfg, workDays: settings.workDays, holidays: [] };
const cal = workCalendar(settings);
const octx = overlapContext(settings, "2026-09-30");

console.log("1. #31 #32 — one resize drag: ONE write, ONE undo snapshot, ONE save, nothing mid-drag");
// The real undo-recording wrapper, sliced: every setTasks that changes state pushes one deep copy.
const wrapperSrc = (() => { const a = CUR.indexOf("const setTasks = useCallback((updater) => {"); const s = CUR.indexOf("(updater) =>", a); let i = CUR.indexOf("{", s), d = 0; for (; i < CUR.length; i++) { if (CUR[i] === "{") d++; else if (CUR[i] === "}" && --d === 0) break; } return CUR.slice(s, i + 1); })();
// #550: a release opens the confirm modal (setResizeConfirm) instead of writing. `confirm` plays
// the user's answer: true confirms the landing as dropped (or `editTo`, typed in the modal),
// false cancels. The modal's own replan / apply are the handler's, so this drives the real path.
const harness = ({ tMode = "month", node, level = "op", moves, tasks0, extra = {}, escape = false, confirm = true, editTo = null }) => {
  let state = tasks0;
  const undoStack = { current: [] }, redoStack = { current: [] }, skipHistory = { current: false }, latestTasksRef = { current: null };
  let writes = 0, writesBeforeRelease = 0, saves = 0, previews = 0, refusedShown = 0, released = false, lastPreview;
  const confirms = [];
  const _setTasks = (fn) => { const next = fn(state); if (next !== state) writes++; if (!released) writesBeforeRelease = writes; state = next; };
  // #338. The wrapper now pushes a STRIPPED snapshot — content without
  // lastModifiedAt — so an undo cannot replay stale stamps into a save. Supplied
  // here because this harness compiles the real wrapper; without it the wrapper
  // throws ReferenceError on the first state change.
  const snapshotForHistory = (arr) =>
    JSON.parse(JSON.stringify(Array.isArray(arr) ? arr : [])).map(({ lastModifiedAt, ...job }) => job);
  const setTasks = new Function("_setTasks", "undoStack", "redoStack", "skipHistory", "latestTasksRef", "snapshotForHistory", `return ${wrapperSrc};`)(_setTasks,undoStack, redoStack, skipHistory, latestTasksRef, snapshotForHistory);
  const listeners = {};
  const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  const scope = {
    can: () => true, isPto: false, _someoneOnIt: false, PERM_VERB: {}, denied: () => {},
    bar: { id: "bar-" + node.id, type: "task", task: node }, p: { id: "w", name: "Wes" },
    people: [{ id: "w", name: "Wes", timeOff: [] }], orgSettings: settings, loggedInUser: { name: "T" },
    refuseDragMove: D.refuseDragMove, applyDragMove: D.applyDragMove, refusalMessage: D.refusalMessage, resizeSession: D.resizeSession,
    blockedByActiveClock: () => false, jobIdOfNode: () => "j", sameId: (a, b) => String(a) === String(b),
    shopDay: () => "2026-09-30", shopHour: () => 10, billingTier: "business", overlapCtx: octx,
    get tasks() { return state; }, tMode, dayWindowCfg: cfg, liveJobCfg: fullCfg, calOf: () => cal,
    workStartH: 8, workEndH: 17, totalWorkH: 9, productiveHoursPerDay: 8,
    setResizePreview: (pv) => { previews++; lastPreview = pv; }, setResizeTooltip: () => {}, setConfirmMove: () => { refusedShown++; },
    recalcBounds: (t) => t, enforceNoOverlap: (t) => ({ tasks: t, moved: [], refused: [] }),
    setTasks, doSaveRef: { current: () => { saves++; } }, setTimeout: (f) => f(), TD: "2026-09-30",
    planResize: D.planResize, latestTasksRef,
    setResizeConfirm: (rc) => {
      confirms.push(rc);
      rc.answer = (editTo ? rc.replan(editTo.day, editTo.hour) : rc.replan(rc.edge.day, rc.edge.hour));
      rc.preview(rc.answer.plan ? rc.answer : null);
      rc.previewDuring = lastPreview;
      rc.preview(null);
      if (confirm && rc.answer.plan && !rc.answer.refusal && !rc.answer.error) rc.apply(rc.answer.plan);
    },
    days, isWorkDay: (d) => cal.isWorkDay(d), cW: 100,
    // Removal is real (#550): after Esc the mouseup must reach nothing.
    document: { addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener: (k, f) => { if (listeners[k] === f) delete listeners[k]; } },
    isDraggingRef: { current: false },
    _layoutStart: node.start, _barStartH: node.startHour, _segsEnd: node.end, _barEndHour: node.endHour,
    // the pre-change handler's collaborators (each updTask is exactly one setTasks, as in the app)
    updTask: (id, upd) => setTasks(prev => prev.map(j => ({ ...j, subs: (j.subs || []).map(pn => ({ ...pn, subs: (pn.subs || []).map(o => o.id === id ? { ...o, ...upd } : o) })) }))),
    isOpLocked: (o) => !!o?.locked, previewPush: () => ({ pushes: [], blocked: false, lockedOps: [] }),
    applyPushes: (t) => t, setConfirmPush: () => {}, nextBD: (d) => cal.next(d), addD: (d, n) => cal.add(d, 0) && new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10),
    diffBD: (a, b) => cal.diff(a, b), walkProductiveHours: SM.walkProductiveHours,
    ...extra,
  };
  const proxy = new Proxy(scope, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : globalThis[k])) });
  const handler = new Function("scope", `with (scope) { const handleTeamResize = ${braceSlice(WEB, "const handleTeamResize = (e, side) =>").replace(/^const handleTeamResize = /, "")}; return handleTeamResize; }`)(proxy);
  const rect = { left: 0, width: 500, top: 0 };
  const el = { getBoundingClientRect: () => rect };
  const ev = (x) => ({ clientX: x, clientY: 10, preventDefault() {}, stopPropagation() {}, currentTarget: { parentElement: { parentElement: el } } });
  handler(ev(moves[0]), "right");
  for (const x of moves) listeners.mousemove?.(ev(x));
  let escStopped = false;
  if (escape) listeners.keydown?.({ key: "Escape", preventDefault() {}, stopPropagation() { escStopped = true; } });
  const previewAfterEsc = lastPreview;
  released = true;
  listeners.mouseup?.(ev(moves[moves.length - 1]));
  return { state, writes, writesBeforeRelease, snapshots: undoStack.current.length, saves, previews, refusedShown, escStopped, left: Object.keys(listeners), previewAfterEsc, confirms };
};
// A: Mon 08:00, 4 h (08–12). B: Mon 13:00, 3 h (13–16). Same person, same phase.
const A = { id: "A", title: "A", start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 12, hpd: 4, team: ["w"] };
const B = { id: "B", title: "B", start: "2026-10-05", end: "2026-10-05", startHour: 13, endHour: 16, hpd: 3, team: ["w"] };
const tree = (...ops) => [{ id: "j", title: "J", subs: [{ id: "p", title: "P", subs: ops }] }];
// Right edge dragged 12:00 → 12:30 → 13:00 → 11:30 → 11:00 (day column 0 is x 0–100: hour = 8 + x/100 × 9).
const run = harness({ node: A, moves: [45, 50, 55, 40, 35], tasks0: tree(A, B) });
check("nothing is written while the mouse moves", () => eq(run.writesBeforeRelease, 0));
check("ONE write for the whole drag", () => eq(run.writes, 1));
check("ONE undo snapshot — one undo reverts it", () => eq(run.snapshots, 1));
check("ONE save", () => eq(run.saves, 1));
check("#550: the release opens ONE confirm, naming the op, the row's person and the side", () => eq([run.confirms.length, run.confirms[0]?.title, run.confirms[0]?.who, run.confirms[0]?.side], [1, "A", "Wes", "right"]));
check("…showing BEFORE as the bar was drawn: Mon 08–12, 4 h", () => eq(run.confirms[0]?.before, { start: "2026-10-05", startHour: 8, end: "2026-10-05", endHour: 12, hpd: 4 }));
check("…and the edge where it was dropped: Mon 11:00", () => eq(run.confirms[0]?.edge, { day: "2026-10-05", hour: 11 }));
check("…AFTER (the replan at that edge) is what gets written: 3 h, ends 11:00", () => eq([run.confirms[0]?.answer.to.end, run.confirms[0]?.answer.to.endHour, run.confirms[0]?.answer.to.hpd], ["2026-10-05", 11, 3]));
check("…and the bar behind the modal previews that landing", () => eq([run.confirms[0]?.previewDuring?.barId, run.confirms[0]?.previewDuring?.endHour], ["bar-A", 11]));
check("the bar was previewed on every step instead", () => (run.previews >= 5 ? true : run.previews));
const Aw = run.state[0].subs[0].subs.find(o => o.id === "A"), Bw = run.state[0].subs[0].subs.find(o => o.id === "B");
check("the resize landed: A ends 11:00 with 3 h", () => eq([Aw?.end, Aw?.endHour, Aw?.hpd], ["2026-10-05", 11, 3]));
check("the sibling was never displaced (no mid-drag reflow)", () => eq([Bw.start, Bw.startHour], ["2026-10-05", 13]));
check("moveLog 'Resized in schedule' with from/to hpd", () => { const l = (Aw?.moveLog || []).at(-1); return eq([l?.reason, l?.fromHpd, l?.toHpd], ["Resized in schedule", 4, 3]); });

console.log("1b. #550 — Esc mid-resize writes nothing (week/month)");
{
  const r = harness({ node: A, moves: [45, 50, 35], tasks0: tree(A, B), escape: true });
  check("no write, no undo frame, no save", () => eq([r.writes, r.snapshots, r.saves], [0, 0, 0]));
  check("A keeps its 4 h, 08–12", () => { const a = r.state[0].subs[0].subs.find(o => o.id === "A"); return eq([a.endHour, a.hpd, a.moveLog], [12, 4, undefined]); });
  check("Esc is kept from anything else listening (a modal, a selection)", () => eq(r.escStopped, true));
  check("the bar stops drawing the preview the moment Esc lands", () => eq(r.previewAfterEsc, null));
  check("every listener the resize added is gone", () => eq(r.left, []));
  check("no confirm: nothing to confirm", () => eq(r.confirms.length, 0));
  const plain = harness({ node: A, moves: [45, 50, 35], tasks0: tree(A, B) });
  check("…and without Esc the same drag, confirmed, writes once", () => eq([plain.writes, plain.saves], [1, 1]));
}

console.log("1d. #550 — Cancel in the confirm writes nothing; an edited time is what gets written");
{
  const no = harness({ node: A, moves: [45, 50, 35], tasks0: tree(A, B), confirm: false });
  check("Cancel: no write, no undo frame, no save", () => eq([no.confirms.length, no.writes, no.snapshots, no.saves], [1, 0, 0, 0]));
  check("…A keeps 08–12 / 4 h", () => { const a = no.state[0].subs[0].subs.find(o => o.id === "A"); return eq([a.endHour, a.hpd], [12, 4]); });
  // Dropped at 11:00, then the end typed as 10:30 in the modal.
  const ed = harness({ node: A, moves: [45, 50, 35], tasks0: tree(A, B), editTo: { day: "2026-10-05", hour: 10.5 } });
  const a = ed.state[0].subs[0].subs.find(o => o.id === "A");
  check("edited end 10:30: written as 10:30 / 2.5 h, once", () => eq([ed.writes, ed.saves, a.endHour, a.hpd], [1, 1, 10.5, 2.5]));
  // Typed onto another day: Tue 12:00 — all of Mon 08–17 (8 h after lunch) + Tue 08–12 (4 h) = 12 h.
  const tue = harness({ node: A, moves: [45, 50, 35], tasks0: tree(A), editTo: { day: "2026-10-06", hour: 12 } });
  const t = tue.state[0].subs[0].subs.find(o => o.id === "A");
  check("edited onto Tue 12:00: ends Tue, 12 h", () => eq([t.end, t.endHour, t.hpd], ["2026-10-06", 12, 12]));
  // Typed into B (13:00–16:00): the rules refuse it in the modal, so it can't be confirmed.
  const into = harness({ node: A, moves: [45, 50, 35], tasks0: tree(A, B), editTo: { day: "2026-10-05", hour: 15 } });
  check("edited into someone's work: the modal shows the refusal, nothing written", () => eq([!!into.confirms[0].answer.refusal, into.writes], [true, 0]));
  // Typed before the fixed start: no landing at all.
  const back = harness({ node: A, moves: [45, 50, 35], tasks0: tree(A, B), editTo: { day: "2026-10-05", hour: 8 } });
  check("edited end at or before the start: an error, no plan, nothing written", () => eq([!!back.confirms[0].answer.error, back.confirms[0].answer.plan, back.writes], [true, undefined, 0]));
}

console.log("1c. #550 — Esc mid-resize writes nothing (day view, the real handleTeamDayBarDrag)");
{
  const dayRun = ({ mode = "right", from, moves, escape = false, confirm = true, editTo = null }) => {
    let state = tree(A);
    let writes = 0, saves = 0, escStopped = false;
    const listeners = {}, confirms = [];
    const scope = {
      can: () => true, isDraggingRef: { current: true }, openJobDetailOrEdit: () => {}, denied: () => {}, PERM_VERB: {},
      dayGrid: { HS: 8, HE: 17, NH: 9 }, tStart: "2026-10-05", isWorkDay: (d) => cal.isWorkDay(d), orgSettings: settings,
      personShareHours: SM.personShareHours, productiveHoursPerDay: 8, opDaySegments: SM.opDaySegments, dayWindowCfg: cfg, liveJobCfg: fullCfg,
      workStartH: 8, workEndH: 17, rH: 40, grpH: 30, rowList: [], teamContainerRef: { current: null },
      calOf: () => cal, blockedByActiveClock: () => false, jobIdOfNode: () => "j", sameId: (a, b) => String(a) === String(b),
      people: [{ id: "w", name: "Wes", timeOff: [] }], billingTier: "business", get tasks() { return state; }, overlapCtx: octx,
      shiftStart: D.shiftStart, planDragMove: D.planDragMove, resizeShare: D.resizeShare, refuseDragMove: D.refuseDragMove, refusalMessage: D.refusalMessage,
      applyDragMove: D.applyDragMove, shopDay: () => "2026-09-30", shopHour: () => 10,
      setDayDragInfo: () => {}, setTeamDayGhost: () => {}, setDayDragTarget: () => {}, setConfirmMove: () => {},
      loggedInUser: { name: "T" }, recalcBounds: (t) => t, TD: "2026-09-30", enforceNoOverlap: () => ({ moved: [], refused: [] }),
      setTasks: (fn) => { const n = fn(state); if (n !== state) writes++; state = n; }, doSaveRef: { current: () => { saves++; } }, setTimeout: (f) => f(),
      planResize: D.planResize, latestTasksRef: { current: null },
      setResizeConfirm: (rc) => {
        confirms.push(rc);
        rc.answer = editTo ? rc.replan(editTo.day, editTo.hour) : rc.replan(rc.edge.day, rc.edge.hour);
        if (confirm && rc.answer.plan && !rc.answer.refusal && !rc.answer.error) rc.apply(rc.answer.plan);
      },
      document: { addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener: (k, f) => { if (listeners[k] === f) delete listeners[k]; } },
    };
    const proxy = new Proxy(scope, { has: () => true, get: (t, k) => (k === Symbol.unscopables ? undefined : (k in t ? t[k] : globalThis[k])) });
    const src = braceSlice(WEB, "const handleTeamDayBarDrag = (e, barTask, mode = \"move\"").replace(/^const handleTeamDayBarDrag = /, "");
    const handler = new Function("scope", `with (scope) { return ${src}; }`)(proxy);
    const el = { getBoundingClientRect: () => ({ left: 0, width: 900, top: 0 }) };
    const ev = (x) => ({ clientX: x, clientY: 10, preventDefault() {}, stopPropagation() {}, currentTarget: { parentElement: el } });
    handler(ev(from), A, mode, "w", 8, 12);
    for (const x of moves) listeners.mousemove?.(ev(x));
    if (escape) listeners.keydown?.({ key: "Escape", preventDefault() {}, stopPropagation() { escStopped = true; } });
    listeners.mouseup?.(ev(moves[moves.length - 1]));
    return { writes, saves, escStopped, left: Object.keys(listeners), a: state[0].subs[0].subs[0], confirms };
  };
  // Right edge 12:00 → 11:00 (x = (hour − 8) × 100).
  const plain = dayRun({ from: 400, moves: [350, 300] });
  check("without Esc the day resize writes once (the harness drives the real handler)", () => eq([plain.writes, plain.saves, plain.a.hpd], [1, 1, 3]));
  const esc = dayRun({ from: 400, moves: [350, 300], escape: true });
  check("with Esc: no write, no save, A keeps 4 h", () => eq([esc.writes, esc.saves, esc.a.hpd], [0, 0, 4]));
  check("Esc is kept from anything else listening", () => eq(esc.escStopped, true));
  check("every listener the resize added is gone", () => eq(esc.left, []));
  check("the day resize opens ONE confirm, side and person named, edge as dropped", () => eq([plain.confirms.length, plain.confirms[0]?.side, plain.confirms[0]?.who, plain.confirms[0]?.edge], [1, "right", "Wes", { day: "2026-10-05", hour: 11 }]));
  check("Esc: no confirm", () => eq(esc.confirms.length, 0));
  const no = dayRun({ from: 400, moves: [350, 300], confirm: false });
  check("day view, Cancel: no write, no save, A keeps 4 h", () => eq([no.writes, no.saves, no.a.hpd], [0, 0, 4]));
  const ed = dayRun({ from: 400, moves: [350, 300], editTo: { day: "2026-10-05", hour: 10 } });
  check("day view, end edited to 10:00: written as 2 h", () => eq([ed.writes, ed.a.endHour, ed.a.hpd], [1, 10, 2]));
  const mv = dayRun({ mode: "move", from: 200, moves: [250, 300] });
  check("a MOVE writes straight away, with no confirm (moving is unchanged)", () => eq([mv.writes, mv.confirms.length], [1, 0]));
  check("a MOVE adds no Esc handler (moving is unchanged)", () => eq(mv.left.includes("keydown"), false));
}

console.log("1e. #550 — the confirm modal itself (ResizeConfirm)");
{
  const RC = WEB.replace(/\r\n/g, "\n");
  const body = RC.slice(RC.indexOf("function ResizeConfirm({ rc, onClose }) {"), RC.indexOf("\nfunction AvailModal("));
  check("it is rendered from the app's resizeConfirm state", () => eq(RC.split("{resizeConfirm && <ResizeConfirm key={resizeConfirm.key} rc={resizeConfirm} onClose={() => setResizeConfirm(null)} />}").length - 1, 1));
  check("Confirm is disabled unless the landing has a plan, no error and no refusal", () => /const canConfirm = !!r\.plan && !r\.error && !r\.refusal;/.test(body) && /disabled=\{!canConfirm\}/.test(body));
  check("only Confirm applies; Cancel, Esc and the backdrop close without writing", () =>
    /const close = \(ok\) => \{ rc\.preview\(null\); if \(ok && canConfirm\) rc\.apply\(r\.plan\); onClose\(\); \};/.test(body)
    && (body.match(/close\(false\)/g) || []).length === 2 && /closeRef\.current\(false\)/.test(body) && (body.match(/close\(true\)/g) || []).length === 1);
  check("every edit re-lands through the handler's replan", () => /return rc\.replan\(edge\.day, edge\.hour\);/.test(body));
  check("non-work days and out-of-hours times are caught before replanning", () => /rc\.isWorkDay\(edge\.day\)/.test(body) && /edge\.hour < rc\.workStartH \|\| edge\.hour > rc\.workEndH/.test(body));
  check("before / after rows for start, end and hours; the dragged edge is the editable one", () =>
    /row\("Starts".*rc\.side === "left" \? editor : null\)/.test(body) && /row\("Ends".*rc\.side === "right" \? editor : null\)/.test(body) && /row\("Hours"/.test(body));
}

console.log("2. ruling 1 — a resize that grows into someone's work is refused, and writes nothing");
{
  const r = harness({ node: A, moves: [45, 60, 75], tasks0: tree(A, B) });   // to 13:30, 14:00, 15:00 — into B
  check("refused, with a message", () => eq(r.refusedShown, 1));
  check("…and nothing was written", () => eq([r.writes, r.snapshots, r.saves], [0, 0, 0]));
  check("…and no confirm: a refused drop has nothing to confirm (#550)", () => eq(r.confirms.length, 0));
}

console.log("3. #33 — a week-view resize changes the bar's length (whole days)");
{
  const W = { id: "W", title: "W", start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 17, hpd: 8, team: ["w"] };
  const r = harness({ tMode: "week", node: W, moves: [150, 250], tasks0: tree(W) });   // right edge onto Wed
  const w = r.state[0].subs[0].subs[0];
  check("one write", () => eq(r.writes, 1));
  check("the estimate is Mon–Wed: 3 × 8 productive h", () => eq(w.hpd, 24));
  check("…so the bar the render walks from it ends Wed 17:00", () => { const k = SM.walkProductiveHours(w.startHour, w.hpd, cfg); return eq([cal.add(w.start, k.days - 1), k.endHour], ["2026-10-07", 17]); });
}

console.log("4. #39 — a panel-level bar resizes and is logged");
{
  const P = { id: "P", title: "P", start: "2026-10-05", end: "2026-10-05", startHour: 8, endHour: 12, hpd: 4, team: ["w"], subs: [] };
  const r = harness({ node: P, moves: [35], tasks0: [{ id: "j", title: "J", subs: [P] }] });
  const pw = r.state[0].subs[0];
  check("written once, with a moveLog", () => eq([r.writes, pw.hpd, pw.moveLog?.length], [1, 3, 1]));
}

console.log("5. #35 #36 #37 — past, time off and someone clocked in refuse the release");
{
  const Y = { ...A, id: "Y", start: "2026-09-29", end: "2026-09-29" };
  const past = harness({ node: Y, moves: [35], tasks0: tree(Y) });
  check("past: refused, no write", () => eq([past.refusedShown, past.writes], [1, 0]));
  const pto = harness({ node: A, moves: [35], tasks0: tree(A), extra: { people: [{ id: "w", name: "Wes", timeOff: [{ start: "2026-10-05", end: "2026-10-05" }] }] } });
  check("time off: refused, no write", () => eq([pto.refusedShown, pto.writes], [1, 0]));
  const live = harness({ node: A, moves: [35], tasks0: tree(A), extra: { blockedByActiveClock: () => true } });
  check("clocked in: refused, no write", () => eq([live.refusedShown, live.writes], [1, 0]));
}

console.log("6. #26 #27 #29 — ghosts are drawn by the bar's own geometry");
{
  // 4 h from 11:00 crosses lunch: the bar spans 11–16 (5 clock h). The flat pro-rate said 4/8 of a day.
  const w = SM.walkProductiveHours(11, 4, cfg);
  const pcs = SM.barSegmentsPct({ segs: [{ start: "2026-10-05", end: "2026-10-09" }], layoutStart: "2026-10-05", tStart: "2026-10-05", nDays: 5, startHour: 11, endHour: w.endHour, budgetPct: w.columns / 5 * 100, endsInView: true, workStartH: 8, totalWorkH: 9 });
  check("width = the walk's 5 clock hours (lunch counted), not 4/8 of a day", () => near(pcs[0].widthPct, (5 / 9) * 20));
  // Budget larger than the last visible piece while the real end is beyond the window: capped.
  const cap = SM.barSegmentsPct({ segs: [{ start: "2026-10-05", end: "2026-10-06" }, { start: "2026-10-08", end: "2026-10-09" }], layoutStart: "2026-10-05", tStart: "2026-10-05", nDays: 5, startHour: 8, endHour: 12, budgetPct: 400, endsInView: false, workStartH: 8, totalWorkH: 9 });
  check("the last piece is capped at its own columns (#27)", () => eq(cap.map(p => +p.widthPct.toFixed(6)), [40, 40]));
  const G = WEB.slice(WEB.indexOf("{/* Ghost: dragged bar + dep-group member previews */}"), WEB.indexOf("{/* Dep-group snap connector"));
  check("all three ghosts draw through barSegmentsPct", () => ((G.match(/_ghostPieces\(/g) || []).length === 3 && /barSegmentsPct\(/.test(G) ? true : "own formula"));
  check("no flat pro-rate left in the ghosts", () => (!/\/ productiveHoursPerDay\) \/ nDays \* 100/.test(G) ? true : "flat pro-rate"));
  check("ghost corners are the bar's (#29)", () => (!/borderRadius: 26/.test(G) && /Math\.min\(T\.radiusXs/.test(G) ? true : "radius 26"));
  const BAR = WEB.indexOf("const _geoArgs = {") >= 0 ? WEB.slice(WEB.indexOf("const _geoArgs = {"), WEB.indexOf("const _geoArgs = {") + 2000) : "";
  check("the bar itself draws through barSegmentsPct", () => (/barSegmentsPct\(\{ \.\.\._geoArgs/.test(BAR) ? true : "bar has its own"));
}

console.log("7. barSegmentsPct reproduces the bar's previous layout exactly");
{
  // The pre-change inline formulas, verbatim in meaning (J: _hourOffsetPct / _wFirst / _tailWNum).
  const dd = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
  const old = ({ segs, layoutStart, tStart, nDays, startHour, endHour, budgetPct, endsInView, workStartH, totalWorkH, firstWantedPct }) => {
    const one = 1 / nDays * 100, f = segs[0];
    const x = dd(tStart, f.start) / nDays * 100 + (f.start === layoutStart ? ((startHour - workStartH) / totalWorkH) * one : 0);
    const w0 = Math.max(0, Math.min(firstWantedPct ?? budgetPct, (dd(tStart, f.end) + 1) / nDays * 100 - x));
    const out = [[x, w0]]; let rem = Math.max(0, budgetPct - w0);
    segs.slice(1).forEach((seg, si) => { const last = si === segs.length - 2 && endsInView; const cd = dd(seg.start, seg.end) + 1; const t = Math.max(0, Math.min(cd / nDays * 100, last ? ((cd - 1) + (endHour - workStartH) / totalWorkH) * one : rem)); rem = Math.max(0, rem - t); out.push([dd(tStart, seg.start) / nDays * 100, t]); });
    return out;
  };
  let same = 0, n = 0;
  const S = [[{ start: "2026-10-05", end: "2026-10-09" }], [{ start: "2026-10-01", end: "2026-10-02" }, { start: "2026-10-05", end: "2026-10-07" }], [{ start: "2026-10-05", end: "2026-10-06" }, { start: "2026-10-08", end: "2026-10-09" }, { start: "2026-10-12", end: "2026-10-12" }]];
  for (const segs of S) for (const sh of [8, 9.5, 12, 16]) for (const eh of [9, 12.5, 17]) for (const b of [3, 20, 55, 130, 400]) for (const inView of [true, false]) for (const fw of [null, 7]) {
    const args = { segs, layoutStart: segs[0].start, tStart: "2026-10-05", nDays: 10, startHour: sh, endHour: eh, budgetPct: b, endsInView: inView, workStartH: 8, totalWorkH: 9, firstWantedPct: fw };
    const a = old(args), c = SM.barSegmentsPct(args).map(p => [p.leftPct, p.widthPct]); n++;
    if (a.length === c.length && a.every((x, i) => Math.abs(x[0] - c[i][0]) < 1e-9 && Math.abs(x[1] - c[i][1]) < 1e-9)) same++;
  }
  check(`identical on all ${n} layouts`, () => eq(same, n));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
