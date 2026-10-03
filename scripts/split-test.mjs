// Split, the remainder, and what the schedule hides (root cause 7, chunk D).
//
// One split for every caller (dragMove.applySplit), team-divided, both parts logged, the new
// op marked splitFrom so the server does not announce an assignment people already had (#48).
// The Overdue tray lists what the schedule hides (#87) and drops back through the normal
// landing. Reschedule refuses an overlap like everything else (#63).
//
// Red-first hooks: DRAG_SRC → another dragMove.js, EVENTS_SRC → another task-events.js,
// SPLIT_WEB_SRC → another TRAQS.jsx.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (env, rel) => import(pathToFileURL(process.env[env] ? path.resolve(process.env[env]) : path.join(root, rel)).href);
const D = await imp("DRAG_SRC", "src/dragMove.js");
const EV = await imp("EVENTS_SRC", "netlify/functions/_utils/task-events.js");
const SM = await import(pathToFileURL(path.join(root, "src/statsMath.js")).href);
const { workCalendar } = await import(pathToFileURL(path.join(root, "src/scheduleRules.js")).href);
const { overlapContext } = await import(pathToFileURL(path.join(root, "src/overlapRules.js")).href);
const WEB = fs.readFileSync(process.env.SPLIT_WEB_SRC || path.join(root, "src/TRAQS.jsx"), "utf8");

let pass = 0, fail = 0;
const check = (name, fn) => {
  let ok = false, why = "";
  try { const r = fn(); ok = r === true; if (!ok) why = ` (got ${JSON.stringify(r)})`; } catch (e) { why = ` (threw ${e.message})`; }
  if (ok) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${why}`); }
};
const eq = (a, b) => (JSON.stringify(a) === JSON.stringify(b) ? true : { got: a, want: b });
// A missing export answers undefined, so each check that needs it FAILS rather than the run crashing.
const fn = (name) => (typeof D[name] === "function" ? D[name] : () => undefined);

const settings = { workStart: "08:00", workEnd: "17:00", lunch: { time: "12:00", durationMinutes: 60 }, breaks: [], workDays: [1, 2, 3, 4, 5], holidays: [] };
const cfg = SM.buildDayWindows(8, 17, settings.breaks, settings.lunch);
const cal = workCalendar(settings);
const base = { cfg, cal, workStartH: 8, workEndH: 17 };
const op = { id: "o1", title: "Wire", start: "2026-10-05", end: "2026-10-06", startHour: 8, hpd: 16, team: ["wes", "sam"], status: "In Progress", moveLog: [{ reason: "Manual resize" }], actualHours: 3, pendingFinish: true };
const tree = (...ops) => [{ id: "j1", title: "Job", jobNumber: "100", subs: [{ id: "p1", title: "Panel", subs: ops }] }];

console.log("1. #46 — the worked part stays, walked from ONE person's share");
{
  // A team of two, 16 h estimate, 8 h worked (the team's total) → 4 h each.
  const parts = fn("workedSplitParts")({ node: op, workedHours: 8, ...base });
  check("keep 8 h (team total), remainder 8 h", () => eq([parts?.keep?.hpd, parts?.remainderHpd], [8, 8]));
  check("the worked part ends Mon 12:00 (4 h each), not Mon 17:00 (8 h walked as one person)", () => eq([parts?.keep?.end, parts?.keep?.endHour], ["2026-10-05", 12]));
  check("the remainder's share is per person", () => eq(parts?.remainderShare, 4));
  check("nothing worked → no split", () => eq(fn("workedSplitParts")({ node: op, workedHours: 0, ...base }), null));
}

console.log("2. #47 — one split: both parts logged, one id scheme, splitFrom on the new op");
try {
  const parts = fn("workedSplitParts")({ node: op, workedHours: 8, ...base });
  const [go] = D.planDragMove({ grabbed: { id: "o1", node: op, fromDay: "2026-10-05", fromHour: 12, shareH: parts.remainderShare }, drop: { day: "2026-10-08", hour: 8 }, origPerson: null, dropPerson: null, ...base });
  const next = fn("applySplit")(tree(op), { node: op, keep: parts.keep, go: { ...go, hpd: parts.remainderHpd }, newId: "o1b", date: "2026-09-30", movedBy: "T", reasons: { keep: "K", go: "G" } });
  const [kept, gone] = next[0].subs[0].subs;
  check("two ops: the original id stays with the worked part", () => eq([kept?.id, gone?.id], ["o1", "o1b"]));
  // `locked` is no longer stamped on the kept half -- op.locked is retired (ruling 3).
  // Asserted as absent rather than dropped from the tuple, so the split cannot quietly
  // start writing it again; the hpd is what identifies the kept half, and it is the
  // worked time by construction.
  check("the part that stays: worked hours, NO lock flag, history kept + a new entry", () => eq([kept.hpd, kept.locked, kept.moveLog.map(l => l.reason)], [8, undefined, ["Manual resize", "K"]]));
  check("the part that goes: remainder hours at the landing, splitFrom, its own entry", () => eq([gone.hpd, gone.start, gone.startHour, gone.splitFrom, gone.moveLog?.map(l => l.reason)], [8, "2026-10-08", 8, "o1", ["G"]]));
  check("…and no history it didn't earn (logged hours, actuals, pending finish)", () => eq([gone.loggedHours, "actualHours" in gone, "pendingFinish" in gone, gone.status], [0, false, false, "Not Started"]));
  check("…its walked end: 4 h each from Thu 08:00 → Thu 12:00", () => eq([gone.end, gone.endHour], ["2026-10-08", 12]));
  check("both entries carry from/to hpd", () => eq([kept.moveLog.at(-1).fromHpd, kept.moveLog.at(-1).toHpd, gone.moveLog[0].fromHpd, gone.moveLog[0].toHpd], [16, 8, 16, 8]));
} catch (e) { check("the shared split exists and runs", () => { throw e; }); }

console.log("3. #48 — no 'assigned' push for people already on the original");
{
  const before = tree(op);
  const after = tree({ ...op, hpd: 8, locked: true }, { ...op, id: "o1b", splitFrom: "o1", hpd: 8 });
  check("a split: nobody is newly assigned", () => eq([...EV.diffTaskEvents(after, before).teamAdded.keys()], []));
  const added = tree({ ...op, hpd: 8 }, { ...op, id: "o1b", splitFrom: "o1", team: ["wes", "cal"] });
  check("a split that ADDS someone: only they are notified", () => eq([...EV.diffTaskEvents(added, before).teamAdded.keys()], ["cal"]));
  const fresh = tree(op, { ...op, id: "new", title: "New op" });
  check("a genuinely new op still notifies its team", () => eq([...EV.diffTaskEvents(fresh, before).teamAdded.keys()].sort(), ["sam", "wes"]));
}

console.log("5. the web (TRAQS.jsx)");
{
  check("the dead split is deleted", () => (!/applyWorkedSplit/.test(WEB) ? true : "still there"));
  // Two surfaces now, not three: the Gantt was deleted in root cause 9 (#132) and took its
  // own split with it. Still an exact count, so a fourth caller appearing is still a failure.
  check("both splits go through applySplit (schedule drag, Split Job)", () => eq((WEB.match(/applySplit\(/g) || []).length, 2));
  check("the drag split refuses without editJobs (#44)", () => eq((WEB.match(/kind: "splitPermission"/g) || []).length, 1));
  check("the Split Job modal needs editJobs", () => (/const doSplit = \(\) => \{\s*if \(!can\("editJobs"\)\)/.test(WEB) ? true : "no gate"));
  // ("the Gantt split runs the shared checks" retired with renderGantt — root cause 9, #132.)
  check("'Move Just This Job' and the push dialog are gone (#63)", () => (!/Move Just This Job|onConfirmSingle|setConfirmPush|previewPush|applyPushes/.test(WEB) ? true : "still there"));
  check("Reschedule refuses through the shared checks", () => { const a = WEB.indexOf("Apply Schedule</Btn>"); return /refuseLanding\(\[/.test(WEB.slice(a - 2500, a)) ? true : "no checks"; });
  check("the Overdue tray, its button and its row badges are removed (2026-10-03)", () => (!/overdueBadge|overdueTray|handleOverdueDrop|overdueUnits/.test(WEB) ? true : "still there"));
  check("dragMove no longer exports overdueUnits", () => (D.overdueUnits === undefined ? true : "still exported"));
  check("the pan reads the real label width (#89)", () => (/const panLW = teamLWRef\.current/.test(WEB) && /teamLWRef\.current = lW;/.test(WEB) ? true : "fixed 260"));
}

console.log("6. #88 — the row sort is a total order (sliced and run)");
{
  const a = WEB.indexOf("      bars.sort((a, b) => {");
  let i = WEB.indexOf("{", a + 20), d = 0; for (; i < WEB.length; i++) { if (WEB[i] === "{") d++; else if (WEB[i] === "}" && --d === 0) break; }
  const cmp = new Function("gSort", `return (a, b) => ${WEB.slice(WEB.indexOf("{", a + 20), i + 1)};`)("start");
  const t = (id, s) => ({ type: "task", id, start: s }), pto = (id, s) => ({ type: "pto", id, start: s });
  const out = [t("C", "2026-10-07"), pto("x", "2026-10-01"), t("B", "2026-10-06"), pto("y", "2026-10-02"), t("A", "2026-10-05")].sort(cmp).map(b => b.id);
  check("tasks in date order whatever PTO sits between them", () => eq(out.filter(x => /[ABC]/.test(x)), ["A", "B", "C"]));
  check("…and the whole order is deterministic", () => eq(out, ["x", "y", "A", "B", "C"]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
