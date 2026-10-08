// #455 — the schedule's Select → Delete names what it is about to remove.
//
// The confirmation read "Delete 18 items? This will permanently remove the
// selected bars from the schedule." — a count, no names, and "from the
// schedule" understated it: the tasks are removed from their JOBS, not hidden.
// At Matrix on 2026-10-08 a month-view Select → All was 18 bars across 4 jobs,
// every task drawable from today forward.
//
// Behaviour does not change. What changes is the dialog: it lists, per job,
// what Delete will remove, from the SAME walk the Delete uses (src/barDelete.js).
//
//   node scripts/bar-delete-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { applyBarDelete, planBarDelete } from "../src/barDelete.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const op = (id, title) => ({ id, title, start: "2026-10-12", end: "2026-10-12", team: ["1"] });
const TREE = [
  { id: "j1", title: "402019 - Salem VFD", subs: [
    { id: "p1", title: "402019-01", subs: [op("o1", "Layout"), op("o2", "Wire"), op("o3", "Cut")] },
    { id: "p2", title: "402019-02", subs: [op("o4", "Layout")] },
  ] },
  { id: "j2", title: "401944 - Thacker II", subs: [
    { id: "p3", title: "401944-01", subs: [op("o5", "Wire")] },
    { id: "p4", title: "401944-02 parts", subs: [] },
  ] },
  { id: "j3", title: "Untouched", subs: [{ id: "p5", title: "x", subs: [op("o6", "Cut")] }] },
];
const clone = (v) => JSON.parse(JSON.stringify(v));
// THE FILTER AS IT WAS, copied from the dialog's Delete button before this change.
const OLD = (prev, ids) => prev.map(job => ({ ...job, subs: (job.subs || []).filter(panel => !ids.has(panel.id)).map(panel => ({ ...panel, subs: (panel.subs || []).filter(op => !ids.has(op.id)) })) }));
const nodeIds = (t) => t.flatMap(j => [j.id, ...(j.subs || []).flatMap(p => [p.id, ...(p.subs || []).map(o => o.id)])]);

console.log("\n1. THE DELETE IS EXACTLY WHAT IT WAS");
for (const sel of [["o1", "o4"], ["p1"], ["p4", "o5"], ["nope"], [], ["o1", "o2", "o3", "o4", "o5", "o6"]]) {
  const ids = new Set(sel);
  ok(`applyBarDelete matches the old inline filter for {${sel.join(",")}}`, applyBarDelete(clone(TREE), ids), OLD(clone(TREE), ids));
}

console.log("\n2. THE PLAN NAMES EXACTLY WHAT THE DELETE REMOVES");
{
  const ids = new Set(["o1", "o2", "p2", "o5", "p4", "ghost"]);
  const plan = planBarDelete(TREE, ids);
  const removed = nodeIds(TREE).filter(id => !nodeIds(applyBarDelete(clone(TREE), ids)).includes(id));
  ok("per job, in tree order: title, tasks that go, panels that go", plan.jobs.map(j => [j.title, j.tasks, j.panels]),
    [["402019 - Salem VFD", 3, 1], ["401944 - Thacker II", 1, 1]]);
  ok("a selected panel takes its tasks with it, and the plan counts them", plan.jobs[0].titles, ["Layout", "Wire", "402019-02"]);
  ok("totals agree with what is actually removed (tasks + panels)", plan.tasks + plan.panels,
    removed.filter(id => /^[op]/.test(id)).length);
  ok("an id matching nothing is not reported as going", JSON.stringify(plan).includes("ghost"), false);
  ok("a job with nothing removed is not listed", plan.jobs.some(j => j.title === "Untouched"), false);
  ok("an empty selection plans nothing", planBarDelete(TREE, new Set()), { jobs: [], tasks: 0, panels: 0 });
}

console.log("\n3. THE DIALOG SAYS IT (R4: scoped to the bar-delete dialog)");
const SRC = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n"));
const at = SRC.indexOf("<FadeOnClose open={!!barDeleteConfirmOpen}");
if (at < 0 || SRC.indexOf("<FadeOnClose open={!!barDeleteConfirmOpen}", at + 1) >= 0) { console.error("bar-delete dialog anchor not found exactly once"); process.exit(2); }
const dlg = SRC.slice(at, SRC.indexOf("</FadeOnClose>", at));
ok("RED: the dialog builds its list from planBarDelete over the live tree and the selection", /planBarDelete\(tasks, selBars\)/.test(dlg), true);
ok("...and the Delete button removes through applyBarDelete with the same selection", /applyBarDelete\(prev, selBars\)/.test(dlg), true);
ok("...and no longer filters inline (one walk, not two)", /\.filter\(panel => !ids\.has\(panel\.id\)\)/.test(dlg), false);
ok("it lists every job with its count", /_plan\.jobs\.map\(/.test(dlg) && /_n\(j\.tasks, "task", "tasks"\)/.test(dlg) && /\{j\.title\}/.test(dlg), true);
ok("the heading counts tasks and jobs, not 'items'", /Delete \{selBars\.size\} \{selBars\.size === 1 \? "item" : "items"\}/.test(dlg), false);
ok("it says the tasks leave their jobs, not merely the schedule", /removes? (them|these tasks) from their jobs/i.test(dlg), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
