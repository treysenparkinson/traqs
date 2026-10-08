// The Job Details page, revamped from the hi-fi design (Direction C, page 8).
//
// The Tasks / Gantt / Split views are gone. The page is a header (Back, breadcrumb,
// #job + name, status and priority chips, Export / Duplicate / Edit), tabs (Details,
// Hours, Files, Approvals), and on Details: a General card of in-place fields, a
// Sub-jobs table (panels, each expanding to its tasks), collapsed Hours & approvals
// and History cards, and a Summary rail.
//
// Pure pieces live in src/jobDetail.js and are tested here directly; the rest is
// checked against the source.
//
//   node scripts/job-detail-test.mjs
import { readFileSync } from "node:fs";
import { jobSessions, crewHours, subJobNumber } from "../src/jobDetail.js";

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, fn) => {
  let r; try { r = fn(); } catch (e) { r = "threw: " + e.message; }
  if (r === true) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (r ? "  -- " + r : "")); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || `${JSON.stringify(a)} != ${JSON.stringify(b)}`;

// ── duplicateJob: REMOVED 2026-10-08 (#486) ─────────────────────────────────
// Fourteen assertions covering `duplicateJob` were deleted with the function.
// They are not lost coverage: the function no longer exists, and the rule it
// delegated to (`copyForDuplicate`) went with it. What survives of #466 — the
// split and template consumers of the same rule — is covered by
// scripts/copy-rules-test.mjs, and the removal itself by
// scripts/duplicate-removed-test.mjs.

// The fixture the session helpers read. It keeps its work records — the point
// of jobSessions is to match rows against a job that HAS history.
const JOB = {
  id: "j1", title: "MMD", jobNumber: "402006", poNumber: "PO-9", clientId: 3, projectManagerId: 7,
  status: "Finished", pri: "High", hpd: 7.5, notes: "two enclosures", dueDate: "2026-07-31",
  start: "2026-06-22", end: "2026-08-14", team: [1, 2], deps: [], createdAt: "2026-01-01T00:00:00Z",
  subs: [
    { id: "p1", title: "Layout", status: "Finished", team: [1], hpd: 60, deps: [],
      attachments: [{ key: "a" }], signOffs: { t: { 0: { by: 1 } } }, engineering: { designed: { by: 1 } },
      apprChain: [{ label: "QC", done: true, byName: "Max", at: "x" }], apprComments: [{ t: "ok" }],
      subs: [
        { id: "o1", title: "Draw", status: "Finished", team: [1], hpd: 30, loggedHours: 29, actualHours: 31, deps: [], finishRequest: { by: 1 } },
        { id: "o2", title: "Check", status: "In Progress", team: [2], hpd: 30, loggedHours: 4, deps: ["o1"], finishRequests: [{}] },
      ] },
    { id: "p2", title: "Wire A", status: "In Progress", team: [2], hpd: 160, deps: ["p1"], subs: [] },
    { id: "p3", title: "Gone", deletedAt: "2026-02-02", subs: [] },
  ],
};

// ── jobSessions / crewHours ──────────────────────────────────────────────────
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const PH = [
  { personId: 1, jobId: "j1", opId: "o1", hours: 3, date: "2026-07-10", clockIn: "2026-07-10T08:00:00Z" },
  { personId: 2, opId: "o2", hours: 2, date: "2026-07-12", clockIn: "2026-07-12T08:00:00Z" },          // no jobId, matched by op
  { personId: 1, panelId: "p2", hours: 1.5, date: "2026-07-11", clockIn: "2026-07-11T08:00:00Z" },     // matched by panel
  { personId: 1, jobId: "j1", opId: "o1", hours: 9, deletedAt: "x", date: "2026-07-13" },              // deleted
  { personId: 3, jobId: "j9", opId: "zz", hours: 4, date: "2026-07-14" },                              // other job
  { personId: 2, jobId: "j1", hours: 0, date: "2026-07-15" },                                          // zero
];
const rows = jobSessions(JOB, PH, sameId);
check("sessions: matched by job, op or panel; deleted, zero and other jobs dropped", () => eq(rows.map(r => r.hours), [2, 1.5, 3]));
check("sessions: newest first", () => eq(rows.map(r => r.date), ["2026-07-12", "2026-07-11", "2026-07-10"]));
check("crew: hours summed per person, largest first", () => eq(crewHours(rows), [{ pid: "1", h: 4.5 }, { pid: "2", h: 2 }]));

// ── subJobNumber ─────────────────────────────────────────────────────────────
check("sub-job number: job number + two-digit index", () => eq([subJobNumber("402006", 0), subJobNumber("402006", 11)], ["402006-01", "402006-12"]));
check("sub-job number: none without a job number", () => subJobNumber("", 0) === "" && subJobNumber(null, 2) === "" || "expected empty");

// ── the page, in the source ──────────────────────────────────────────────────
const at = SRC.indexOf('if (modal.type === "detail") {');
const PAGE = at < 0 ? "" : SRC.slice(at, SRC.indexOf("\n    if (modal.type ===", at + 10));
check("the detail page can be located", () => PAGE.length > 2000 || `page ${PAGE.length} chars`);
check("Tasks, Gantt and Split are gone from the page", () => !/jobDetailView|renderProjectPlan|renderJobTaskList|jdViewSeg/.test(PAGE) || "a view reference remains");
check("...and from the component", () => {
  const gone = ["const renderProjectPlan", "const renderJobTaskList", "usePersistedUI(\"jobDetailView\"", "usePersistedUI(\"jobDetailSplit\"", "usePersistedUI(\"jdColOrder\"", "const toggleJdPhase", "const jobListCols", "usePersistedUI(\"planView\""];
  const left = gone.filter(g => SRC.includes(g));
  return left.length === 0 || left.join(", ");
});
check("tabs: Details, Hours, Files, Approvals -- and no Invoicing or Comments", () =>
  /\["details", "Details"\][^\n]*\["hours", "Hours"\][^\n]*\["files", "Files"\][^\n]*\["approvals", "Approvals"\]/.test(PAGE) && !/"Invoicing"|"Comments"/.test(PAGE) || "tab list wrong");
// RE-RULED 2026-10-08 (#486): Duplicate is gone from the header and from the
// product. Export and Edit are still asserted, and Duplicate is asserted ABSENT
// rather than simply dropped from the list — a removal that stops being checked
// is a removal that can come back unnoticed.
check("header: Export and Edit", () => /openJobExport\(/.test(PAGE) && /openEditStacked\(/.test(PAGE) || "a header action is missing");
check("header: Duplicate is gone", () => !/duplicateJobAction\(/.test(PAGE) || "the Duplicate action is still in the header");
check("General fields save through commitCellEdit on the job", () =>
  ["title", "jobNumber", "poNumber", "clientId", "projectManagerId", "status", "pri", "hpd", "dueDate", "notes"].every(k => new RegExp(`jdField\\("${k}"`).test(PAGE)) || "a General field is not wired");
check("...and that writer is commitCellEdit", () => /const jdSave = \(key, val\) => commitCellEdit\(job\.id, key, val\)/.test(PAGE) || "jdSave is not commitCellEdit");
check("Start / End are read-only (computed from the panels)", () => !/jdField\("start"|jdField\("end"/.test(PAGE) || "start/end editable");
check("Lead, Category and Location are not invented", () => !/"Lead"|"Category"|"Location"/.test(PAGE) || "a non-existent field is shown");
check("sub-jobs: one row per live panel, numbered from the job", () => /subJobNumber\(job\.jobNumber, /.test(PAGE) && /\.filter\(p => p && !p\.deletedAt\)/.test(PAGE) || "panel rows not built");
check("sub-jobs: rows expand to their tasks, instantly", () => /jdOpenPanels/.test(PAGE) && !/animation:|transition: "grid-template-rows/.test(PAGE.slice(PAGE.indexOf("Sub-jobs"))) || "no expand, or it animates");
check("sub-jobs: add sub-job and add task reuse jdAddPhase / jdAddOp", () => /jdAddPhase\(job\.id\)/.test(PAGE) && /jdAddOp\(job\.id, /.test(PAGE) || "add actions not wired");
check("summary: figures from the shared helpers", () => /_jobHoursPair\(job\)/.test(PAGE) && /_jobPct\(job\)/.test(PAGE) && /apprStateFor\(job, 0/.test(PAGE) || "summary not on the shared helpers");
check("summary: team hours from the job's sessions", () => /crewHours\(jdRows\)/.test(PAGE) && /jobSessions\(job, productionHours, sameId\)/.test(PAGE) || "team hours not from sessions");
// This asserted duplicateJobAction was gated and saved safely. The whole chain
// went in #486 — button, action, duplicateJob, copyForDuplicate — and the
// removal is covered end to end by scripts/duplicate-removed-test.mjs.
check("the duplicate action is gone from the component", () => !SRC.includes("duplicateJobAction") || "duplicateJobAction survives somewhere");

check("the page fills the panel (pageFill), not the old 1500px / 90vh popup box", () => /\.\.\.pageFill \}\} onClick/.test(PAGE) && !/maxWidth: isMobile \? "100%" : 1500|"90vh"/.test(PAGE) || "page still pinned");
check("header and tabs never shrink (a flex column squeezed the tabs to zero)", () =>
  /minHeight: isMobile \? 34 : 57, flexShrink: 0/.test(PAGE) && /overflowX: "auto", overflowY: "hidden", flexShrink: 0/.test(PAGE) || "a row can shrink");
check("status and priority keep a value that is not on the org's list", () => /withCurrent\(STATUSES, job\.status\)/.test(PAGE) && /withCurrent\(PRIORITIES, job\.pri\)/.test(PAGE) || "off-list value reads —");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
