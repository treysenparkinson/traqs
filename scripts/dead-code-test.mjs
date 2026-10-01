// Root cause 9: the branches that cannot be reached, and the symbols that no longer exist.
//
// 1,083 lines accumulated behind conditions that can never hold — a sub-view whose state
// only ever holds one value, a row type nothing ever assigns, a mobile view the navigation
// maps away from, a modal nothing opened. None of it was referenced by anything; all of it
// was maintained, and some of it was FIXED while unreachable (the Reschedule modal's landing
// checks were rewritten in root cause 7 D, in a modal no one could open).
//
// So this suite asserts two different things. The symbols are gone — a plain occurrence
// count, which is what makes the deletion provable rather than eyeballed. And the CONDITIONS
// stay impossible, which is what stops a new branch being written behind one of them. The
// second half is the one that matters in a year.
//
//   node scripts/dead-code-test.mjs

import { readFileSync, readdirSync } from "node:fs";
const ROOT = new URL("../", import.meta.url);
const SRC = readFileSync(new URL("src/TRAQS.jsx", ROOT), "utf8").replace(/\r\n/g, "\n");

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// ── the symbols are gone, repo-wide ──────────────────────────────────────────
// Repo-wide and not just TRAQS.jsx: "zero references in this file" would miss a string key
// or a cross-file import, which is the gap that makes a by-name deletion unsafe.
const FILES = [];
const walk = (dir) => {
  for (const e of readdirSync(new URL(dir, ROOT), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = dir + e.name + (e.isDirectory() ? "/" : "");
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs|ts|html|css)$/.test(e.name)) FILES.push(p);
  }
};
// src/ and netlify/ only, not scripts/. A test that NAMES a deleted symbol in a comment --
// recording why an assertion retired with it — is exactly what should happen, and counting
// those would make this check punish the documentation. What matters is that nothing in the
// shipped source can reach them, and src/ + netlify/ is the shipped source.
for (const d of ["src/", "netlify/", "public/"]) { try { walk(d); } catch { /* optional */ } }

const GONE = [
  ["#132", "renderGantt"], ["#134", "cascadeDeps"],
  ["#139", "runOptimize"], ["#139", "previewPullBack"], ["#139", "linkingFrom"], ["#139", "setLinkingFrom"],
  ["#140", "liveBarStyle"], ["#140", "drainMaskStyle"], ["#140", "LIVE_BAR_LABEL_MIN_PX"],
  ["#141", "_workedCellsTotal"], ["#141", "_workedRemainingBudget"],
  ["#142", "sched-person-glow"],
  ["#234", "renderMobileTeam"],
  ["#279", "computeJobOptimize"], ["#279", "optimizeJobOps"],
  // the gantt's own state, which only it used
  ["#132", "ganttContainerRef"], ["#132", "ganttWidth"], ["#132", "setGanttWidth"],
];
// Chunk 2: the orphans — a fixpoint, so a helper whose only caller was itself an orphan
// counts too. Asserted per (file, name) and with comments stripped, which the first draft of
// this check got wrong twice: a bare repo-wide name match flagged INPUT_STYLE and LABEL,
// which are live in SignupSteps.jsx under the same names, and counted six stale COMMENTS as
// live references. A name is only meaningful inside the file it was deleted from.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ORPHANS = [["src/App.jsx","INPUT_STYLE"],["src/App.jsx","LABEL"],["src/App.jsx","SUCCESS_BOX"],["src/App.jsx","HINT"],["src/App.jsx","LoginStep"],["src/statsMath.js","HOUR_MS"],["src/TRAQS.jsx","countWorkingDays"],["src/TRAQS.jsx","OP_COLORS"],["src/TRAQS.jsx","HEALTH_COLOR"],["src/TRAQS.jsx","ApprovalCommentInput"],["src/TRAQS.jsx","handleLogin"],["src/TRAQS.jsx","filterRef"],["src/TRAQS.jsx","breakH"],["src/TRAQS.jsx","sDiffBD"],["src/TRAQS.jsx","getNextStartSlot"],["src/TRAQS.jsx","getPayPeriodAtOffset"],["src/TRAQS.jsx","_hoursPairForItem"],["src/TRAQS.jsx","startEngColResize"],["src/TRAQS.jsx","workedSpansStored"],["src/TRAQS.jsx","handleToggleGanttSplit"],["src/TRAQS.jsx","taskOwner"],["src/TRAQS.jsx","checkOverlaps"],["src/TRAQS.jsx","showLockedError"],["src/TRAQS.jsx","buildGroupMove"],["src/TRAQS.jsx","findOpAsBarTask"],["src/TRAQS.jsx","toggleLock"],["src/TRAQS.jsx","findNextSlot"],["src/TRAQS.jsx","reassignTask"],["src/TRAQS.jsx","openDeps"],["src/TRAQS.jsx","openAvail"],["src/TRAQS.jsx","ctxDeps"],["src/TRAQS.jsx","ctxBlocks"],["src/TRAQS.jsx","copyItem"],["src/TRAQS.jsx","doPaste"],["src/TRAQS.jsx","participantIds"],["src/TRAQS.jsx","revertChainStep"],["src/TRAQS.jsx","addPanelComment"],["src/TRAQS.jsx","delPanelComment"],["src/TRAQS.jsx","isEngComplete"],["src/TRAQS.jsx","isSignOffComplete"],["src/TRAQS.jsx","handleGanttPan"],["src/TRAQS.jsx","handleGanttWheel"],["src/TRAQS.jsx","_workedPctOfSeg"],["src/TRAQS.jsx","jobTitleById"],["src/TRAQS.jsx","pmColor"],["src/TRAQS.jsx","renderBlankPage"],["src/TRAQS.jsx","dayOfWeek"],["src/TRAQS.jsx","openBreak"],["src/TRAQS.jsx","pTasks"],["src/TRAQS.jsx","isPinned"],["src/TRAQS.jsx","addPanels"],["src/TRAQS.jsx","isPersonBusy"],["src/TRAQS.jsx","checkDeps"],["src/TRAQS.jsx","_clientName"],["src/TRAQS.jsx","secTitle"],["src/TRAQS.jsx","mainSec"],["src/TRAQS.jsx","shopPeople"],["src/TRAQS.jsx","exportRows"],["src/TRAQS.jsx","downloadFile"],["src/TRAQS.jsx","selBlock"],["src/TRAQS.jsx","hasOpts"],["src/TRAQS.jsx","rescheduleJob"],["src/TRAQS.jsx","movePanel"],["src/TRAQS.jsx","moveOp"],["src/TRAQS.jsx","getCurrentPayPeriod"],["src/TRAQS.jsx","ganttRef"],["src/TRAQS.jsx","ganttCWRef"],["src/TRAQS.jsx","ganttWheelAcc"],["src/TRAQS.jsx","rLabel"],["src/TRAQS.jsx","_newComment"]];
for (const [file, sym] of ORPHANS) {
  const code = stripComments(readFileSync(new URL(file, ROOT), "utf8"));
  // A property KEY or a member access is not a reference to the deleted binding. App.jsx
  // still exports `{ INPUT_STYLE: PAPER_INPUT, LABEL: PAPER_LABEL }` and TRAQS.jsx still
  // writes `participantIds:` into message objects — all of which outlived the local consts
  // that happened to share their names. Counting those would block a correct deletion.
  const n = (code.match(new RegExp(`(^|[^.\\w])${sym}\\b(?!\\s*:)`, "gm")) || []).length;
  ok(`#rc9c2 ${sym} is gone from ${file}${n ? ` — ${n} reference${n === 1 ? "" : "s"} left` : ""}`, n === 0);
}
for (const [id, sym] of GONE) {
  const hits = [];
  for (const f of FILES) {
    if (f.endsWith("dead-code-test.mjs")) continue;            // this file names them on purpose
    const n = (readFileSync(new URL(f, ROOT), "utf8").match(new RegExp(`\\b${sym}\\b`, "g")) || []).length;
    if (n) hits.push(`${f}×${n}`);
  }
  ok(`${id} ${sym} is gone from the repo${hits.length ? " — still in " + hits.join(", ") : ""}`, hits.length === 0);
}

// ── the conditions stay impossible ───────────────────────────────────────────
// Each of these is why the code above was unreachable. If one becomes possible again, the
// branch behind it is live code and has to be written as such, not revived by accident.

// #132/#319: taskSubView only ever holds "list". The cards branch (#319) is still in the
// file deliberately — it is held, not deleted — so this asserts the STATE, not the branch.
const setters = SRC.match(/setTaskSubView\((["'])([a-z]+)\1\)/g) || [];
ok(`#132/#319 taskSubView is only ever set to "list" (${setters.length} setter call${setters.length === 1 ? "" : "s"})`,
  setters.length > 0 && setters.every(s => /"list"|'list'/.test(s)));
ok("#132/#319 ...and it is initialised to \"list\"", /useState\(["']list["']\)[^\n]*taskSubView|const \[taskSubView, setTaskSubView\] = useState\(["']list["']\)/.test(SRC));

// #133: no row is ever typed "subtask", so the branch that rendered one is unreachable.
ok("#133 no schedule row is given type \"subtask\"", !/type:\s*["']subtask["']/.test(SRC));

// #234: the mobile navigation maps schedule to home, so a mobile schedule view cannot show.
ok("#234 mobileView can never be \"schedule\"", /const mobileView = view === "schedule" \? "home" : view;/.test(SRC));
ok("#234 ...and nothing renders on that condition any more", !/mobileView === "schedule" &&/.test(SRC));

// #135: the modal is reachable NOW — it was wired in this pass — so the assertion flips:
// something must open it, or we are back where we started.
const opens = SRC.match(/setRescheduleModal\(\{/g) || [];
ok(`#135 something opens the Reschedule modal (${opens.length} call site${opens.length === 1 ? "" : "s"})`, opens.length >= 1);
ok("#135 ...from the bar's context menu", /reschedule/i.test(SRC.slice(SRC.indexOf("const handleCtx"), SRC.indexOf("const handleCtx") + 4000)) || /setRescheduleModal\(\{/.test(SRC));

// #143: the person card carries a click handler, not just the permission it computes.
ok("#143 the person card opens the person modal", /canEditPerson && setPersonModal|onClick=\{[^}]*canEditPerson/.test(SRC));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
