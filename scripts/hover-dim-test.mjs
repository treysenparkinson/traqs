// Hover dimming on the schedule — what "the same job" means when a bar is hovered.
//
// #318: every bar keyed its dimming on `task.pid`, which is the PARENT id and so a different
// thing at each level. An op keyed on its panel and a panel on its job, so hovering an op lit
// its sibling ops but never its own panel, and two ops of one job in different panels never lit
// together. The key is now the JOB at every level — `hoverJobKey` — and every site that writes
// or reads the key goes through it.
//
// #106: the engineering chip took no part at all. It carried no `data-bar-dim`, so it never
// dimmed, and it has no `task.pid` to key on. Its job is `bar.jobId`.
//
//   node scripts/hover-dim-test.mjs

import { readFileSync } from "node:fs";
import { hoverJobKey } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const eq = (m, got, want) => ok(`${m} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

// ── the key, at every level ─────────────────────────────────────────────────
// Shapes as getPersonBars builds them.
const opBar = { type: "task", task: { id: "o1", pid: "p1", grandPid: "j1", level: 2 } };
const otherPanelOp = { type: "task", task: { id: "o9", pid: "p2", grandPid: "j1", level: 2 } };
const panelBar = { type: "task", task: { id: "p1", pid: "j1", level: 1 } };
const generalSub = { type: "task", task: { id: "s1", pid: "j2", level: 1 } };
const crossRow = { type: "task", crossRow: true, task: { id: "o1", pid: "p1", grandPid: "j1" } };
const chip = { type: "eng-chip", jobId: "j1", panelId: "p1", task: { id: "j1", isSub: false } };
const pto = { type: "pto", task: null };

eq("#318 an op keys on its JOB, not its panel", hoverJobKey(opBar), "j1");
eq("#318 its panel keys on the same job", hoverJobKey(panelBar), "j1");
eq("#318 an op in another panel of the same job shares the key", hoverJobKey(otherPanelOp), hoverJobKey(opBar));
eq("#318 a general job's flat sub keys on its job", hoverJobKey(generalSub), "j2");
eq("#318 a cross-row record keys on its job", hoverJobKey(crossRow), "j1");
eq("#106 an engineering chip keys on its job", hoverJobKey(chip), "j1");
eq("PTO has no key", hoverJobKey(pto), null);
eq("ids are compared as strings (sameId's rule)", hoverJobKey({ type: "task", task: { pid: 7, grandPid: 42 } }), "42");

// ── every site goes through it ──────────────────────────────────────────────
// Scoped to renderTeam with comments stripped (R4). A raw `task?.pid` feeding the key is
// exactly the old bug, so none may remain; and the chip must opt in to dimming.
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const a = S.indexOf("  const renderTeam = () => {\n");
const b = S.indexOf("\n  const renderAnalytics = () => {");
ok("renderTeam is found", a > 0 && b > a);
const code = S.slice(a, b).replace(/^\s*\/\/.*$/gm, "");
const rawKeyed = code.match(/data-pid=\{[^}]*task\??\.pid[^}]*\}|hoverDim\([^)]*task\??\.pid[^)]*\)|data-row-pids=\{[^}]*task\??\.pid/g) || [];
ok(`#318 no dim site keys on the raw parent id (found ${rawKeyed.length}: ${JSON.stringify(rawKeyed)})`, rawKeyed.length === 0);
const keyed = (code.match(/data-pid=\{hoverJobKey\(/g) || []).length;
const dimmed = (code.match(/hoverDim\(hoverJobKey\(/g) || []).length;
ok(`#318 every bar writes the job key (${keyed})`, keyed >= 3);
ok(`#318 every hover reads the job key (${dimmed})`, dimmed >= 3);
ok("#318 the row label lists job keys", /data-row-pids=\{[^}]*hoverJobKey/.test(code));
// The chip's own element: from its type check to the end of its return.
const chipAt = code.indexOf('if (bar.type === "eng-chip") {');
const chipEl = chipAt < 0 ? "" : code.slice(chipAt, code.indexOf("</div>;", chipAt));
ok("#106 the engineering chip opts in to dimming", /data-bar-dim=/.test(chipEl));
ok("#106 ...under its job's key", /data-pid=\{hoverJobKey\(/.test(chipEl));
ok("#106 ...and dims the others when hovered", /hoverDim\(hoverJobKey\(/.test(chipEl));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
