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
import { duplicateJob, jobSessions, crewHours, subJobNumber } from "../src/jobDetail.js";

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const check = (name, fn) => {
  let r; try { r = fn(); } catch (e) { r = "threw: " + e.message; }
  if (r === true) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (r ? "  -- " + r : "")); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || `${JSON.stringify(a)} != ${JSON.stringify(b)}`;

// ── duplicateJob ─────────────────────────────────────────────────────────────
let n = 0;
const uid = () => "n" + (++n);
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
const D = duplicateJob(JOB, { uid, now: "2026-10-03T12:00:00.000Z" });
const ids = o => [o.id, ...(o.subs || []).flatMap(ids)];
check("duplicate: every id is fresh", () => !ids(D).some(i => ids(JOB).includes(i)) && new Set(ids(D)).size === ids(D).length || ids(D).join(","));
check("duplicate: title marked as a copy, job number cleared", () => D.title === "MMD (copy)" && !D.jobNumber || `${D.title} / ${D.jobNumber}`);
// RE-RULED 2026-10-08 (#466). This asserted that a duplicate keeps the PO, the
// notes and the due date. It no longer does, and that is the decision rather
// than a regression: the PO and the due date identify the ENGAGEMENT, not the
// work — two jobs sharing a PO is a billing problem — and `notes` is a running
// log on the live board ("PB. Status: Crated. Contact Riley. 100%."), so a copy
// inheriting it is born announcing someone else's progress. What describes the
// work still comes along, which is what the first half of this now checks.
check("duplicate: keeps client, PM, priority and the estimate", () =>
  eq([D.clientId, D.projectManagerId, D.pri, D.hpd], [3, 7, "High", 7.5]));
check("duplicate: leaves the engagement and the running log behind", () =>
  eq([D.poNumber, D.dueDate, D.notes, D.jobNumber], [undefined, undefined, undefined, undefined]));
check("duplicate: deleted panels are not copied", () => eq(D.subs.map(p => p.title), ["Layout", "Wire A"]));
check("duplicate: every status starts over", () => [D, ...D.subs, ...D.subs.flatMap(p => p.subs)].every(x => x.status === "Not Started") || "a status carried over");
check("duplicate: no hours, finish requests, files or sign-offs carried over", () => {
  const all = [D, ...D.subs, ...D.subs.flatMap(p => p.subs)];
  const bad = all.filter(x => x.loggedHours || x.actualHours || x.finishRequest || x.finishRequests || (x.attachments && x.attachments.length) || x.signOffs || x.engineering || x.apprChain || x.apprComments);
  return bad.length === 0 || bad.map(x => x.title).join(",");
});
check("duplicate: estimates and assignees kept", () => eq(D.subs[0].subs.map(o => [o.hpd, o.team]), [[30, [1]], [30, [2]]]) && eq(D.subs[0].hpd, 60));
check("duplicate: deps remapped onto the new ids", () =>
  eq(D.subs[0].subs[1].deps, [D.subs[0].subs[0].id]) && eq(D.subs[1].deps, [D.subs[0].id]));
check("duplicate: createdAt is now", () => D.createdAt === "2026-10-03T12:00:00.000Z" || D.createdAt);
check("duplicate: the original is untouched", () => JOB.subs[0].subs[0].loggedHours === 29 && JOB.title === "MMD" && JOB.subs[0].id === "p1");

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
check("header: Export, Duplicate and Edit", () => /openJobExport\(/.test(PAGE) && /duplicateJobAction\(/.test(PAGE) && /openEditStacked\(/.test(PAGE) || "a header action is missing");
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
check("Duplicate is gated on editJobs and saves like a new job", () => {
  const i = SRC.indexOf("const duplicateJobAction = ");
  const body = i < 0 ? "" : SRC.slice(i, i + 900);
  return /can\("editJobs"\)/.test(body) && /protectedJobIds\.current\.add\(/.test(body) && /doSaveRef\.current\(\)/.test(body) || "duplicateJobAction missing or unsafe";
});

check("the page fills the panel (pageFill), not the old 1500px / 90vh popup box", () => /\.\.\.pageFill \}\} onClick/.test(PAGE) && !/maxWidth: isMobile \? "100%" : 1500|"90vh"/.test(PAGE) || "page still pinned");
check("header and tabs never shrink (a flex column squeezed the tabs to zero)", () =>
  /minHeight: isMobile \? 34 : 57, flexShrink: 0/.test(PAGE) && /overflowX: "auto", overflowY: "hidden", flexShrink: 0/.test(PAGE) || "a row can shrink");
check("status and priority keep a value that is not on the org's list", () => /withCurrent\(STATUSES, job\.status\)/.test(PAGE) && /withCurrent\(PRIORITIES, job\.pri\)/.test(PAGE) || "off-list value reads —");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
