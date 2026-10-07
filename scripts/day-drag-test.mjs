// Day view drag and resize (root cause 7, chunk B). The day view uses the SAME landing and the
// SAME checks as week/month (dragMove.js) — plus the two kinds this chunk adds to that one list:
// record bars and the department rule.
//
// Red-first hooks: DRAG_SRC → another dragMove.js (HEAD's), DAY_WEB_SRC → another TRAQS.jsx.
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
// A missing export is a FAILED check, not a crash that hides the rest (red-first on HEAD).
const RS = D.resizeShare || (() => NaN);
const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : { got: a, want: b });

const settings = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [{ time: "10:00", durationMinutes: 15 }, { time: "14:00", durationMinutes: 15 }], workDays: [1, 2, 3, 4, 5], holidays: [] };
const cfg = SM.buildDayWindows(8, 17, settings.breaks, settings.lunch);
const fullCfg = { ...cfg, workDays: settings.workDays, holidays: [] };
const cal = workCalendar(settings);
const octx = overlapContext(settings, "2026-09-30");
const base = { cfg, cal, workStartH: 8, workEndH: 17 };
const people = [
  { id: "caleb", name: "Caleb", department: "Assembly" },
  { id: "wes", name: "Wes", department: "Wire" },
  { id: "sam", name: "Sam", department: "Assembly", secondaryDepartment: "Wire" },
];
const op = (id, start, end, startHour, hpd, team, extra = {}) => ({ id, title: id, start, end, startHour, hpd, team, ...extra });
const tree = (ops, panelExtra = {}) => [{ id: "j1", title: "Job", subs: [{ id: "p1", title: "Panel", ...panelExtra, subs: ops }] }];
const ctxFor = (tasks, over = {}) => ({
  isLocked: n => !!n.locked, isLive: () => false, isOverdue: () => false, timeOff: () => [],
  nowDay: "2026-09-30", nowHour: 10, business: true, tasks, overlapCtx: octx, people, ...over,
});
const move = (node, from, drop, origPerson, dropPerson, extra = {}) =>
  D.planDragMove({ grabbed: { id: node.id, node, fromDay: from.day, fromHour: from.hour, shareH: extra.shareH ?? 2, ...extra }, drop, origPerson, dropPerson, ...base });

console.log("1. #8 — the landing is tested on the date shown, not assumed to be today");
{
  // The day view is on Tue Oct 13 (a jump to a job). It is Wed Sep 30, 10:00.
  const o = op("o1", "2026-10-13", "2026-10-13", 11, 2, ["wes"]);
  const early = move(o, { day: "2026-10-13", hour: 11 }, { day: "2026-10-13", hour: 8 }, "wes", "wes");
  check("a future date's 08:00 is NOT refused as the past", () => eq(D.refuseDragMove(early, ctxFor(tree([o]))), null));
  const p = op("o2", "2026-09-29", "2026-09-29", 11, 2, ["wes"]);
  const yest = move(p, { day: "2026-09-29", hour: 11 }, { day: "2026-09-29", hour: 13 }, "wes", "wes");
  check("yesterday's 13:00 IS refused as the past", () => eq(D.refuseDragMove(yest, ctxFor(tree([p])))?.kind, "past"));
  check("a multi-day op grabbed on a later day shifts from its first day by the hour change", () => {
    const at = D.shiftStart({ day: "2026-10-12", hour: 8 }, { bdDelta: 0, hourDelta: 2 }, base);
    return eq([at.day, at.hour], ["2026-10-12", 10]);
  });
}

console.log("2. #9 #10 — a resize measures the op across all its days, from where it is painted");
{
  // Painted Mon 08:00 → Wed 17:00 (3 days × 7.5 = 22.5 productive h). Right edge dragged to Wed 12:00.
  const share = RS({ side: "right", paintedStart: { day: "2026-10-12", hour: 8 }, paintedEnd: { day: "2026-10-14", hour: 17 }, day: "2026-10-14", hour: 12, cfg: fullCfg });
  check("right resize on the last day: 2 full days + Wed 08–12 = 18.75 h", () => eq(share, 7.5 * 2 + 3.75));
  const left = RS({ side: "left", paintedStart: { day: "2026-10-12", hour: 8 }, paintedEnd: { day: "2026-10-14", hour: 17 }, day: "2026-10-12", hour: 13, cfg: fullCfg });
  check("left resize on the first day: Mon 13–17 + 2 full days = 18.75 h", () => eq(left, 3.75 + 7.5 * 2));
  // Packed: stored 08:00 but painted at 10:00 → resizing the right edge to 12:00 is 10–12, not 08–12.
  const packed = RS({ side: "right", paintedStart: { day: "2026-10-12", hour: 10 }, paintedEnd: { day: "2026-10-12", hour: 12 }, day: "2026-10-12", hour: 12, cfg: fullCfg });
  check("anchored on the painted start (10:00), not the stored one", () => eq(packed, 2 - 0.25));   // the 10:00 break
  const o = op("o1", "2026-10-12", "2026-10-14", 8, 45, ["wes", "sam"]);   // team of 2: 22.5 each
  const mv = D.planDragMove({ grabbed: { id: "o1", node: o, fromDay: "2026-10-12", fromHour: 8, shareH: share, hpd: Math.round(share * 2 * 100) / 100 }, drop: { day: "2026-10-12", hour: 8 }, origPerson: "wes", dropPerson: "wes", ...base });
  const written = D.applyDragMove(tree([o]), mv, { date: "2026-09-30", movedBy: "T", reason: "Resized in schedule" })[0].subs[0].subs[0];
  check("the team's total is written (share × 2), not one day's clock hours", () => eq(written.hpd, 37.5));
  check("…and the end lands where the edge was dropped", () => eq([written.end, written.endHour], ["2026-10-14", 12]));
  check("the moveLog records the resize, with from/to hpd", () => {
    const l = written.moveLog?.[0];
    return eq([l?.reason, l?.fromHpd, l?.toHpd], ["Resized in schedule", 45, 37.5]);
  });
}

console.log("3. #17 — a cross-row record bar can't be moved or resized, and says why");
{
  const o = op("o1", "2026-10-13", "2026-10-13", 8, 6, ["wes"]);
  const mv = D.planDragMove({ grabbed: { id: "o1", node: o, fromDay: "2026-10-13", fromHour: 8, shareH: 2, isRecord: true }, drop: { day: "2026-10-13", hour: 11 }, origPerson: "caleb", dropPerson: "caleb", ...base });
  const r = D.refuseDragMove(mv, ctxFor(tree([o])));
  check("refused 'record'", () => eq(r?.kind, "record"));
  check("…on Basic too", () => eq(D.refuseDragMove(mv, ctxFor(tree([o]), { business: false }))?.kind, "record"));
  check("the message says what it is", () => (/record of work already done/.test(D.refusalMessage(r)) ? true : D.refusalMessage(r)));
}

console.log("4. department — a drop that ADDS someone outside the unit's department SUCCEEDS, and the department follows (#427)");
{
  // REWRITTEN 2026-10-07. These five assertions pinned the REFUSAL, which is the
  // behaviour #427 reverses: the drop is now allowed and the op's department
  // becomes where the work went. Written as the new rule rather than the old one
  // with its answer flipped (R3) — the condition is unchanged, only the response.
  const o = op("o1", "2026-10-13", "2026-10-13", 8, 2, ["wes"], { requiredDepartment: "Wire" });
  const toCaleb = move(o, { day: "2026-10-13", hour: 8 }, { day: "2026-10-13", hour: 8 }, "wes", "caleb");
  check("a cross-department drop is not refused", () => eq(D.refuseDragMove(toCaleb, ctxFor(tree([o]))), null));
  check("...and the department follows the work", () => {
    const out = D.applyDragMove(tree([o]), toCaleb, { date: "2026-10-13", movedBy: "t", people });
    return eq(out[0].subs[0].subs[0].requiredDepartments, ["Assembly"]);
  });
  check("...and the replaced set is in the moveLog, which is what makes it recoverable", () => {
    const e = D.applyDragMove(tree([o]), toCaleb, { date: "2026-10-13", movedBy: "t", people })[0].subs[0].subs[0].moveLog.at(-1);
    return eq([e.fromDepartments, e.toDepartments], [["Wire"], ["Assembly"]]);
  });
  check("someone already IN the department rewrites nothing (Sam holds Wire)", () => {
    const mv = move(o, { day: "2026-10-13", hour: 8 }, { day: "2026-10-13", hour: 8 }, "wes", "sam");
    const out = D.applyDragMove(tree([o]), mv, { date: "2026-10-13", movedBy: "t", people });
    return eq([D.refuseDragMove(mv, ctxFor(tree([o]))), out[0].subs[0].subs[0].requiredDepartment], [null, "Wire"]);
  });
  const onPanel = op("o2", "2026-10-13", "2026-10-13", 8, 2, ["wes"]);
  check("an op INHERITING from its panel gains its own value, panel untouched", () => {
    const mv = move(onPanel, { day: "2026-10-13", hour: 8 }, { day: "2026-10-13", hour: 8 }, "wes", "caleb");
    const out = D.applyDragMove(tree([onPanel], { requiredDepartment: "Wire" }), mv, { date: "2026-10-13", movedBy: "t", people });
    return eq([out[0].subs[0].subs[0].requiredDepartments, out[0].subs[0].requiredDepartment], [["Assembly"], "Wire"]);
  });
  const already = op("o3", "2026-10-13", "2026-10-13", 8, 2, ["caleb"], { requiredDepartment: "Wire" });
  check("an op already out of department still moves along its own row, unchanged", () => {
    const mv = move(already, { day: "2026-10-13", hour: 8 }, { day: "2026-10-13", hour: 11 }, "caleb", "caleb");
    const out = D.applyDragMove(tree([already]), mv, { date: "2026-10-13", movedBy: "t", people });
    return eq([D.refuseDragMove(mv, ctxFor(tree([already]))), out[0].subs[0].subs[0].requiredDepartment], [null, "Wire"]);
  });
  check("it follows on Basic too — this was never a paid rule", () => {
    const out = D.applyDragMove(tree([o]), toCaleb, { date: "2026-10-13", movedBy: "t", people });
    return eq([D.refuseDragMove(toCaleb, ctxFor(tree([o]), { business: false })), out[0].subs[0].subs[0].requiredDepartments], [null, ["Assembly"]]);
  });
  // Week/month uses the same list: a multi-select MEMBER reassigned onto Caleb
  // follows too, and the grabbed bar beside it is left alone.
  const g = op("g", "2026-10-13", "2026-10-13", 8, 2, ["wes"]), m = op("m", "2026-10-13", "2026-10-13", 13, 2, ["wes"], { requiredDepartment: "Wire" });
  const multi = D.planDragMove({ grabbed: { id: "g", node: g, fromDay: "2026-10-13", fromHour: 8, shareH: 2 }, members: [{ id: "m", node: m, day: "2026-10-13", hour: 13, shareH: 2 }], drop: { day: "2026-10-14", hour: 8 }, origPerson: "wes", dropPerson: "caleb", ...base });
  check("…a MEMBER reassigned out of its department follows, and only it", () => {
    const out = D.applyDragMove(tree([g, m]), multi, { date: "2026-10-13", movedBy: "t", people });
    const [og, om] = out[0].subs[0].subs;
    return eq([D.refuseDragMove(multi, ctxFor(tree([g, m]))), om.requiredDepartments, og.requiredDepartments], [null, ["Assembly"], undefined]);
  });
}

console.log("5. the day view's handler uses the shared landing and checks (TRAQS.jsx)");
{
  const src = fs.readFileSync(process.env.DAY_WEB_SRC || path.join(root, "src/TRAQS.jsx"), "utf8");
  const a = src.indexOf("const handleTeamDayBarDrag = ("), b = src.indexOf("return <div>", a);
  const H = a >= 0 && b > a ? src.slice(a, b) : "";
  check("handler found", () => H.length > 0);
  check("plans, checks and commits through dragMove.js — no second set", () =>
    (/planDragMove\(/.test(H) && /refuseDragMove\(/.test(H) && /applyDragMove\(/.test(H) && /resizeShare\(/.test(H)) ? true : "missing");
  check("its own overlap check is gone", () => (!/dayOverlapBlocked/.test(H) ? true : "still there"));
  check("it no longer writes through updTask / reassignTask", () => (!/updTask\(|reassignTask\(/.test(H) ? true : "still there"));
  check("move permission at the grab (#5)", () => (/can\("moveJobs"\)/.test(H) ? true : "no gate"));
  check("reassign permission at the drop (#5)", () => (/can\("reassign"\)/.test(H) ? true : "no gate"));
  check("#6: the target row compares with sameId", () => (!/target\.id !== fromPersonId/.test(H) && /sameId\(target\.id, fromPersonId\)/.test(H) ? true : "strict compare"));
  check("the commit is backstopped by the no-overlap guard", () => (/enforceNoOverlap\(/.test(H) ? true : "no backstop"));
  check("record bars are flagged into the landing (#17)", () => (/isRecord/.test(H) ? true : "not flagged"));
  const R = src.slice(src.indexOf('{people.length > 0 && tMode === "day" && (() => {'), src.indexOf("{/* Resource timeline grid */}"));
  check("the resize handles get the painted bounds (#10)", () =>
    (/handleTeamDayBarDrag\(e,\s*bar\.task,\s*"left",\s*p\.id,\s*rawS,\s*rawE/.test(R) && /handleTeamDayBarDrag\(e,\s*bar\.task,\s*"right",\s*p\.id,\s*rawS,\s*rawE/.test(R)) ? true : "no bounds");
  check("handles only where the op starts / ends, and only with moveJobs (#9 #10 #5)", () =>
    (/isFirstSeg/.test(R) && /isLastSeg/.test(R) && /can\("moveJobs"\)/.test(R)) ? true : "handles on every segment");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
