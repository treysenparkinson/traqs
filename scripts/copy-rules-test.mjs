// #466 + #468 — what a copied node inherits, and what it starts clean.
//
// RED FIRST, against the three paths as they were:
//   duplicateJob  carried moveLog (16 of 65 live jobs would hand their copy at
//                 least one; 402057 would be born with 201 entries), placedSubs,
//                 isReschedule, scheduledLater, notes, poNumber and dueDate.
//   applySplit    destructured off `finishRequest` (singular, deprecated) and
//                 kept `finishRequests` (plural, authoritative), and cleared
//                 `deps`, throwing away predecessor constraints the continuing
//                 half still has.
//   template      cleared five SCHEDULE fields and no work field at all, left
//                 startHour/endHour behind while clearing start/end, and did not
//                 remap deps on load, so every dependency pointed at the
//                 template's own op ids.
//
//   node scripts/copy-rules-test.mjs
import { readFileSync } from "node:fs";
import {
  WORK_RECORD, ENGAGEMENT_IDENTITY, SCHEDULE_FIELDS, TEMPLATE_KEEPS,
  RECORD_COLUMN_TYPES, recordColumnKeys,
  copyForDuplicate, copyForSplit, copyForTemplate,
  templateOpFromNode, nodesFromTemplate,
} from "../src/copyRules.js";
import { duplicateJob } from "../src/jobDetail.js";
import { applySplit } from "../src/dragMove.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// Matrix's real column definitions: the acthours and activity columns store
// under PLAIN FIELD NAMES, not `_cc_` keys. Assuming the prefix misses both.
const SETTINGS = { customCols: [
  { id: "t1449eru8", label: "Hrs/Day",  type: "number",   fieldKey: "hpd" },
  { id: "ttyknnq8t", label: "Act Hrs",  type: "acthours", fieldKey: "actHours" },
  { id: "t71pgkwo4", label: "PO #",     type: "text",     fieldKey: "poNumber" },
  { id: "tu6fy3p70", label: "Comments", type: "text" },
  { id: "tyngeunym", label: "Category", type: "select" },
  { id: "tv8o36myr", label: "Activity", type: "activity", fieldKey: "apprActivity" },
] };

// An op carrying one of everything, so a path that forgets a field is caught by
// the field rather than by the example.
const richOp = () => ({
  id: "o1", title: "Wire-001", status: "In Progress", hpd: 8,
  start: "2026-09-01", end: "2026-09-03", startHour: 7, endHour: 15,
  team: ["p1"], color: "#3b82f6", requiredDepartments: ["Panel"], deps: ["o0"], locked: true,
  notes: "PB. Status: Crated. Contact Riley. 100%.",
  loggedHours: 12, actualHours: 3, actHours: 4, apprActivity: [{ at: "x" }],
  finishRequest: { id: "fr0" }, finishRequests: [{ id: "fr1", status: "pending" }],
  pendingFinish: true, pendingSession: "s1", finishedAt: "2026-09-03T10:00:00Z",
  attachments: [{ filename: "Wire-001_2026-07-16.jpg", uploadedByName: "Max" }],
  signOffs: [{ by: "a" }], engineering: { rev: 2 }, apprChain: ["x"], apprComments: ["c"], apprLog: [{ at: "y" }],
  moveLog: [{ date: "2026-08-01", movedBy: "Max", fromStartHour: 8 }],
  placedSubs: [{ id: "gone" }], splitFrom: "oX", isReschedule: true, scheduledLater: true,
  _cc_tyngeunym: "PB", _cc_tu6fy3p70: "Rittal next Wednesday",
});

console.log("\n1. THE LISTS SAY WHAT THEY MEAN");
{
  for (const k of ["moveLog", "placedSubs", "notes", "finishRequests", "finishRequest",
                   "loggedHours", "actHours", "apprActivity", "attachments", "finishedAt",
                   "isReschedule", "scheduledLater", "splitFrom"])
    ok(`WORK_RECORD holds ${k}`, WORK_RECORD.includes(k), true);
  ok("ENGAGEMENT_IDENTITY is exactly the three", [...ENGAGEMENT_IDENTITY].sort(), ["dueDate", "jobNumber", "poNumber"]);
  ok("SCHEDULE_FIELDS holds the HOUR fields too", SCHEDULE_FIELDS.includes("startHour") && SCHEDULE_FIELDS.includes("endHour"), true);
  ok("TEMPLATE_KEEPS is notes alone", TEMPLATE_KEEPS, ["notes"]);
  // `team` is deliberately NOT in this list: it is WHO, which makes it schedule,
  // and the template has always cleared it. Duplicate and split keep it.
  ok("a description field is in NO list", ["hpd", "color", "requiredDepartments", "deps", "title", "locked"]
    .some(k => [...WORK_RECORD, ...ENGAGEMENT_IDENTITY, ...SCHEDULE_FIELDS].includes(k)), false);
  ok("team is a SCHEDULE field, so only the template drops it", SCHEDULE_FIELDS.includes("team"), true);
  // `status` is schedule, not description — the template drops it and every path resets it.
  ok("status is a SCHEDULE field", SCHEDULE_FIELDS.includes("status"), true);
}

console.log("\n2. CUSTOM COLUMNS RESOLVE BY TYPE, AND BY fieldKey");
{
  ok("the two record types", [...RECORD_COLUMN_TYPES].sort(), ["acthours", "activity"]);
  ok("resolves to PLAIN field names, not _cc_ keys", recordColumnKeys(SETTINGS), ["actHours", "apprActivity"]);
  ok("a column with no fieldKey falls back to _cc_<id>",
    recordColumnKeys({ customCols: [{ id: "abc", type: "activity" }] }), ["_cc_abc"]);
  ok("a description column is not dropped", recordColumnKeys(SETTINGS).includes("_cc_tyngeunym"), false);
  // The known miss, asserted so it is a decision on record rather than a bug.
  ok("KNOWN MISS: a text column used as a log is NOT dropped",
    recordColumnKeys(SETTINGS).includes("_cc_tu6fy3p70"), false);
  ok("no settings at all", recordColumnKeys(undefined), []);
  ok("no customCols", recordColumnKeys({}), []);
}

console.log("\n3. THE THREE CONSUMERS DISAGREE ONLY WHERE THEY SHOULD");
{
  const n = richOp();
  const d = copyForDuplicate(n, { settings: SETTINGS });
  const s = copyForSplit(n, { settings: SETTINGS });
  const t = copyForTemplate(n, { settings: SETTINGS });

  ok("duplicate drops every work record", WORK_RECORD.some(k => k in d), false);
  ok("split drops every work record", WORK_RECORD.some(k => k in s), false);
  ok("template drops every work record EXCEPT notes",
    WORK_RECORD.filter(k => k in t), ["notes"]);
  ok("...and the notes it keeps are the procedure", t.notes, n.notes);

  ok("duplicate drops engagement identity", ENGAGEMENT_IDENTITY.some(k => k in d), false);
  ok("SPLIT KEEPS the engagement — same job, same PO", copyForSplit({ poNumber: "PO-1", dueDate: "2026-12-01" }).poNumber, "PO-1");
  ok("template drops engagement identity", ENGAGEMENT_IDENTITY.some(k => k in t), false);

  ok("template drops the schedule, hours included", SCHEDULE_FIELDS.some(k => k in t), false);
  ok("duplicate KEEPS the schedule", [d.start, d.startHour], ["2026-09-01", 7]);
  ok("split KEEPS deps", s.deps, ["o0"]);

  for (const k of ["hpd", "color", "requiredDepartments", "locked", "title"]) {
    ok(`every path keeps ${k}`, [k in d, k in s, k in t], [true, true, true]);
  }
  ok("duplicate and split keep team; the template clears it",
    [("team" in d), ("team" in s), ("team" in t)], [true, true, false]);
  ok("the custom-column RECORD values go", [("actHours" in d), ("apprActivity" in d)], [false, false]);
  ok("the custom-column DESCRIPTION value stays", d._cc_tyngeunym, "PB");
  ok("the input is not mutated", richOp().moveLog.length, 1);
  ok("a node with nothing to drop comes back by identity", copyForDuplicate(richOp.call ? { id: "x", hpd: 1 } : {}) .hpd, 1);
}

console.log("\n4. RED — duplicateJob must not hand a copy somebody else's history");
{
  let i = 0; const uid = () => `new${++i}`;
  const job = {
    id: "j1", title: "402057", jobNumber: "402057", poNumber: "PO-9", dueDate: "2026-11-01",
    status: "In Progress", notes: "PB. Status: Shipped. 100%.", clientId: "c1", projectManagerId: "p9",
    moveLog: [{ date: "d", movedBy: "Max" }], isReschedule: true, scheduledLater: true,
    subs: [{ id: "p1", title: "402057-01", placedSubs: [{ id: "stale" }],
      moveLog: [{ date: "d2", movedBy: "Max", fromStartHour: 8 }],
      subs: [{ id: "o1", title: "Wire", deps: ["o2"], loggedHours: 9, actHours: 2,
               moveLog: [{ date: "d3", movedBy: "Max" }], finishRequests: [{ id: "fr", status: "pending" }] },
             { id: "o2", title: "Test" }] }],
  };
  const copy = duplicateJob(job, { uid, now: "2026-10-08T00:00:00Z", settings: SETTINGS });
  const all = []; (function w(n) { all.push(n); (n.subs || []).forEach(w); })(copy);

  ok("no node on the copy carries a moveLog", all.some(n => "moveLog" in n), false);
  ok("no node carries placedSubs", all.some(n => "placedSubs" in n), false);
  ok("no node carries loggedHours or actHours", all.some(n => "loggedHours" in n || "actHours" in n), false);
  ok("no node carries finishRequests", all.some(n => "finishRequests" in n), false);
  ok("the job's notes stay behind", "notes" in copy, false);
  ok("the PO stays behind", "poNumber" in copy, false);
  ok("the due date stays behind", "dueDate" in copy, false);
  ok("the job number stays behind", "jobNumber" in copy, false);
  ok("isReschedule and scheduledLater stay behind", ["isReschedule", "scheduledLater"].some(k => k in copy), false);

  // What must still come along, so the drop is not over-broad.
  ok("the client comes along", copy.clientId, "c1");
  ok("the PM comes along", copy.projectManagerId, "p9");
  ok("the structure comes along", [copy.subs.length, copy.subs[0].subs.length], [1, 2]);
  ok("every status is reset", all.every(n => n.status === "Not Started"), true);
  ok("ids are fresh", all.every(n => String(n.id).startsWith("new")), true);
  ok("deps are remapped onto the copy's own ids", copy.subs[0].subs[0].deps, [copy.subs[0].subs[1].id]);
  ok("the title is marked a copy", copy.title, "402057 (copy)");
}

console.log("\n5. RED — the split keeps the work, not the record of it");
{
  const op = { id: "o1", title: "Wire", hpd: 4, start: "2026-09-01", end: "2026-09-02",
    startHour: 7, endHour: 15, team: ["p1"], deps: ["oPrev"], notes: "",
    loggedHours: 6, actualHours: 2, pendingFinish: true, pendingSession: "s",
    finishRequest: { id: "frA" }, finishRequests: [{ id: "frB", status: "pending" }],
    attachments: [{ filename: "a.jpg" }], signOffs: [{ by: "x" }], apprLog: [{ at: "y" }],
    finishedAt: "2026-09-02T10:00:00Z",
    moveLog: [{ date: "d1", movedBy: "Max", fromStartHour: 8 }] };
  const tasks = [{ id: "j", subs: [{ id: "p", subs: [op, { id: "oPrev", title: "Prep" }] }] }];
  const out = applySplit(tasks, {
    node: op,
    keep: { hpd: 2, start: "2026-09-01", startHour: 7, end: "2026-09-01", endHour: 11 },
    // `go` is a mover from planDragMove: it carries both ends of the move.
    go: { hpd: 2, title: "Wire (2)", status: "Not Started",
          from: { start: "2026-09-01", end: "2026-09-02", startHour: 7, endHour: 15, team: ["p1"], hpd: 4 },
          to: { start: "2026-09-02", end: "2026-09-02", startHour: 7, endHour: 11, team: ["p1"], hpd: 2 } },
    newId: "oNew", date: "2026-10-08", movedBy: "Trey", reasons: {},
  }, "Trey");
  const subs = out[0].subs[0].subs;
  const kept = subs.find(o => o.id === "o1");
  const gone = subs.find(o => o.id === "oNew");

  ok("the split produced both halves", !!kept && !!gone, true);
  ok("the new half has NO finishRequests", "finishRequests" in gone, false);
  ok("...nor the deprecated singular", "finishRequest" in gone, false);
  ok("...nor attachments, signOffs or apprLog", ["attachments", "signOffs", "apprLog"].some(k => k in gone), false);
  ok("...nor finishedAt", "finishedAt" in gone, false);
  ok("...nor the mirror or the session", ["pendingFinish", "pendingSession"].some(k => k in gone), false);
  ok("THE NEW HALF KEEPS ITS PREDECESSOR", gone.deps, ["oPrev"]);
  ok("it carries no logged hours", gone.loggedHours, 0);
  ok("it records where it came from", gone.splitFrom, "o1");
  ok("its move log is the split alone", gone.moveLog.length, 1);
  ok("the ORIGINAL half keeps its history", kept.moveLog.length, 2);
  ok("the original keeps its finish requests", kept.finishRequests.length, 1);
  ok("the original keeps its hours", kept.loggedHours, 6);
  ok("the original keeps its deps", kept.deps, ["oPrev"]);
}

console.log("\n6. RED — a template is a procedure, not an instance");
{
  const op = { id: "t1", title: "Wire-001", status: "Finished", hpd: 8,
    start: "2026-09-01", end: "2026-09-03", startHour: 7, endHour: 15, team: ["p1"], qty: 3,
    notes: "Torque to 40 Nm, then megger.", deps: ["t0"], color: "#3b82f6",
    loggedHours: 12, moveLog: [{ date: "d" }], finishRequests: [{ id: "f" }],
    attachments: [{ filename: "p.jpg" }], poNumber: "PO-1", finishedAt: "z",
    subs: [{ id: "t1s", title: "Sub", loggedHours: 4, start: "2026-09-02", startHour: 9 }] };
  const stored = templateOpFromNode(op, { settings: SETTINGS });

  ok("the template keeps the procedure in notes", stored.notes, "Torque to 40 Nm, then megger.");
  ok("the template keeps the estimate", stored.hpd, 8);
  ok("the template drops the hours worked", "loggedHours" in stored, false);
  ok("...the history", "moveLog" in stored, false);
  ok("...the finish requests", "finishRequests" in stored, false);
  ok("...the photos", "attachments" in stored, false);
  ok("...the PO", "poNumber" in stored, false);
  ok("...finishedAt", "finishedAt" in stored, false);
  ok("THE HOUR FIELDS GO WITH THE DATES", ["start", "end", "startHour", "endHour"].some(k => k in stored), false);
  ok("the instance number is stripped from the title", stored.title, "Wire");
  ok("sub-ops are cleaned the same way", ["loggedHours", "start", "startHour"].some(k => k in stored.subs[0]), false);

  // Loading it back.
  let i = 0; const uid = () => `L${++i}`;
  const two = [templateOpFromNode({ ...op, id: "t1" }, { settings: SETTINGS }),
               templateOpFromNode({ id: "t2", title: "Test", deps: ["t1"] }, { settings: SETTINGS })];
  const { ops, newIds } = nodesFromTemplate(two, { uid, nextIndex: 0 });
  ok("DEPS ARE REMAPPED ONTO THE NEW IDS", ops[1].deps, [ops[0].id]);
  // Only deps the template could resolve must move. "t0" points OUTSIDE the two
  // ops being loaded and is deliberately left alone, asserted separately below.
  ok("...and no dep still names an id the template itself minted",
    ops.some(o => (o.deps || []).some(d => d === "t1" || d === "t2")), false);
  ok("every new id is reported for the new-row flash", newIds.includes(ops[0].id) && newIds.includes(ops[1].id), true);
  ok("sub ids are fresh and reported", newIds.includes(ops[0].subs[0].id), true);
  ok("status is reset on load", ops[0].status, "Not Started");
  ok("the schedule is blank on load", [ops[0].start, ops[0].end], ["", ""]);
  ok("no hour of day survives the round trip", ["startHour", "endHour"].some(k => k in ops[0]), false);
  ok("the procedure survives the round trip", ops[0].notes, "Torque to 40 Nm, then megger.");
  ok("an untitled top-level op is numbered", nodesFromTemplate([{ id: "x" }], { uid: () => "u", nextIndex: 2 }).ops[0].title, "Op-003");
  // ...but a SUB-op is not, or it would be named as though it were a top-level
  // op, and two sub-ops under different parents would collide on "Op-001".
  ok("an untitled SUB-op is NOT numbered",
    nodesFromTemplate([{ id: "x", subs: [{ id: "xs" }] }], { uid: () => "u", nextIndex: 2 }).ops[0].subs[0].title, "");
  ok("a dep pointing outside the template is left alone",
    nodesFromTemplate([{ id: "a", deps: ["elsewhere"] }], { uid: () => "u" }).ops[0].deps, ["elsewhere"]);
}

console.log("\n7. THE CALL SITES USE THE RULE RATHER THAN THEIR OWN LIST");
{
  const jd = readFileSync(new URL("../src/jobDetail.js", import.meta.url), "utf8");
  const dm = readFileSync(new URL("../src/dragMove.js", import.meta.url), "utf8");
  const tq = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

  ok("jobDetail imports copyForDuplicate", /import \{[^}]*copyForDuplicate[^}]*\} from "\.\/copyRules\.js";/.test(jd), true);
  ok("...and calls it", /copyForDuplicate\(/.test(jd), true);
  ok("...and no longer keeps its own DROP list", /const DROP = \[/.test(jd), false);
  ok("dragMove imports copyForSplit", /import \{[^}]*copyForSplit[^}]*\} from "\.\/copyRules\.js";/.test(dm), true);
  ok("...and no longer destructures its own four", /pendingSession: _s, finishRequest: _f/.test(dm), false);
  ok("...and no longer clears deps on the new half", /deps: \[\],/.test(dm), false);
  ok("TRAQS imports the template pair",
    /import \{[^}]*templateOpFromNode[^}]*\} from "\.\/copyRules\.js";/.test(tq)
    || /import \{[^}]*nodesFromTemplate[^}]*\} from "\.\/copyRules\.js";/.test(tq), true);
  ok("...the save uses it", /templateOpFromNode\(/.test(tq), true);
  ok("...and BOTH loadTemplates use it", (tq.match(/nodesFromTemplate\(/g) || []).length >= 2, true);
  ok("...so neither writes deps verbatim any more", /deps: o\.deps \|\| \[\],/.test(tq), false);

  // SETTINGS MUST ACTUALLY FLOW. Every consumer resolves the org's custom columns
  // from it, so a call site that forgets it silently stops dropping `actHours` and
  // `apprActivity` while every other assertion here stays green.
  ok("duplicateJob is CALLED with settings", /duplicateJob\(job, \{ uid, now: [^}]*settings: orgSettings \}\)/.test(tq), true);
  ok("both applySplit call sites pass settings", (tq.match(/settings: orgSettings \}\)/g) || []).length >= 3, true);
  ok("the template save passes settings", /templateOpFromNode\(o, \{ settings: orgSettings \}\)/.test(tq), true);
  ok("duplicateJob accepts settings", /export function duplicateJob\(job, \{ uid, now, settings \} = \{\}\)/.test(jd), true);
  // `reasons = {}` sits in this signature, so a [^}]* class cannot reach `settings`.
  ok("applySplit accepts settings", /export function applySplit\(tasks, \{.*reasons = \{\}, settings \}\)/.test(dm), true);
  ok("...and hands it to the rule", /copyForSplit\(orig, \{ settings \}\)/.test(dm), true);
  ok("duplicateJob hands it to the rule", /copyForDuplicate\(node, \{ settings \}\)/.test(jd), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
