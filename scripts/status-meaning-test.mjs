// #504 — WHAT A STATUS MEANS LIVES ON THE LIST ENTRY, NOT IN ITS SPELLING (Trey, 2026-10-13:
// "add the flag. 73 comparisons breaking on a rename is worse than a schema addition").
//
// `statusOpts` is the org's, editable in Settings. Two of its names carried meaning by their
// spelling alone — "Finished" (credit no more hours, roll progress to 100%, needs
// approveCompletions to set) and "In Progress" (what a clock-in stamps). Rename "Finished" to
// "Complete" — one edit, no warning — and every one of those stopped working, silently.
//
// THE FLAG: an entry carries `isFinished` / `isActive`. A list where no entry carries one yet
// (every org today) reads the meaning from the name, exactly as before — so nothing moves until
// the list is next saved, and the options editor attaches the flags to the rows it loads, so a
// RENAME carries the meaning with the row instead of leaving it behind on the old spelling.
//
// Server code passes the org's list explicitly (`isFinishedStatus(s, statusOpts)`); only the
// web page, which serves one org, may use the page-level forms (`isFinished(s)`).
//
//   node scripts/status-meaning-test.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "../src/statusMeaning.js";
import { statusLiteralViolations } from "../src/statusText.js";
// #125: pinned, never inherited (#529) — the tier rule is tier-rules-test's, and here it would
// add rule events this suite does not expect, or refuse its Basic test org in enforce.
process.env.TIER_RULES_MODE = "off";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const fn = (name) => (typeof M[name] === "function" ? M[name] : () => "missing");
for (const f of ["withMeanings", "isFinishedStatus", "isActiveStatus", "finishedStatusName", "activeStatusName", "setOrgStatuses", "isFinished", "isActive", "FINISHED", "ACTIVE"]) {
  ok(`statusMeaning exports ${f}`, typeof M[f], "function");
}
const isFin = fn("isFinishedStatus"), isAct = fn("isActiveStatus"), finName = fn("finishedStatusName"), actName = fn("activeStatusName"), withM = fn("withMeanings");

const TODAY = [{ name: "Not Started" }, { name: "In Progress" }, { name: "Finished" }, { name: "finished" }, { name: "Shipped/ invoiced" }];
console.log("\n1. A list with no flags reads meaning from the name — nothing moves today");
ok("Finished is finished", isFin("Finished", TODAY), true);
ok("...and so is the lowercase twin Matrix carries", isFin("finished", TODAY), true);
ok("Shipped is not (closed for the health dot, not finished — #440's E-STRICT is separate)", isFin("Shipped/ invoiced", TODAY), false);
ok("In Progress is active", isAct("In Progress", TODAY), true);
ok("with no list at all, the name decides", [isFin("Finished", null), isAct("In Progress", undefined)], [true, true]);
ok("the names to write are the defaults", [finName(TODAY), actName(TODAY)], ["Finished", "In Progress"]);

console.log("\n2. The flag travels with the row — a rename keeps the meaning");
{
  const flagged = withM(TODAY);
  ok("withMeanings attaches the flags by name", flagged.map(o => [o.name, !!o.isFinished, !!o.isActive]),
    [["Not Started", false, false], ["In Progress", false, true], ["Finished", true, false], ["finished", true, false], ["Shipped/ invoiced", false, false]]);
  // The admin renames both in the editor; the row objects (and their flags) survive.
  const renamed = flagged.map(o => o.name === "Finished" ? { ...o, name: "Complete" } : o.name === "In Progress" ? { ...o, name: "Underway" } : o);
  ok("a renamed finished entry is still finished", isFin("Complete", renamed), true);
  ok("...the old spelling no longer is (the list has no such entry, but its twin \"finished\" is flagged)", isFin("Finished", renamed), true);
  ok("a renamed active entry is still active", isAct("Underway", renamed), true);
  ok("...and what a clock-in writes follows it", actName(renamed), "Underway");
  ok("...and what an approval writes follows it", finName(renamed), "Complete");
  ok("an explicit flag on another row moves the meaning", isFin("Shipped/ invoiced", flagged.map(o => o.name === "Shipped/ invoiced" ? { ...o, isFinished: true } : o)), true);
  ok("deleting the only flagged row falls back to the name rather than to nothing",
    isFin("finished", withM(TODAY).filter(o => o.name !== "Finished").map(o => ({ ...o, isFinished: false }))), true);
}

console.log("\n3. The page-level forms read the org's list once it is set");
{
  fn("setOrgStatuses")([{ name: "Complete", isFinished: true }, { name: "Underway", isActive: true }]);
  ok("isFinished reads it", [fn("isFinished")("Complete"), fn("isFinished")("Finished")], [true, true]);
  ok("FINISHED / ACTIVE name the org's entries", [fn("FINISHED")(), fn("ACTIVE")()], ["Complete", "Underway"]);
  fn("setOrgStatuses")(null);
  ok("cleared, they read the name", [fn("isFinished")("Complete"), fn("FINISHED")()], [false, "Finished"]);
}

console.log("\n4. The callers use it");
{
  const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  ok("the page sets the org's list whenever it changes", /setOrgStatuses\(statusOpts\)/.test(J), true);
  ok("the options editor loads the status rows WITH their flags", /cid === "status" \? withMeanings\(statusOpts\)/.test(J), true);
  const V = (src) => statusLiteralViolations(src).filter(v => v.member === "Finished" || v.member === "In Progress");
  ok("TRAQS.jsx compares no status to \"Finished\" or \"In Progress\" by spelling", V(J).map(v => v.line), []);
  for (const f of ["src/barPaint.js", "src/dragMove.js", "src/statsMath.js", "src/overlapRules.js", "src/taskActions.js", "netlify/functions/timeclock.js"]) {
    ok(`${f} compares neither by spelling`, V(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).length, 0);
  }
  ok("approvals and clock-ins WRITE the org's name, not the literal",
    /status: "Finished"|status: "In Progress"|status:"Finished"|status:"In Progress"/.test(J.split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n")), false);
  const T = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8");
  ok("the clock-in stamps the org's active name", /activeStatusName\(/.test(T), true);
  // Server code serves many orgs in one process: the page-level forms would carry one org's
  // list into another's request. Only the explicit forms may appear under netlify/.
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".js")) files.push(p); } };
  // fileURLToPath, not .pathname: on Windows that is "/C:/..." and readdirSync makes it C:\C:\ .
  walk(fileURLToPath(new URL("../netlify/functions", import.meta.url)));
  ok("no server file uses the page-level forms",
    files.filter(f => /\b(setOrgStatuses|isFinished|isActive|FINISHED|ACTIVE)\(/.test(readFileSync(f, "utf8").replace(/\/\/.*$/gm, ""))).map(f => f.split("/").pop()), []);
}

console.log("\n5. The server honours a renamed status — permission and the clock-in stamp");
{
  const { classifyTaskActions } = await import("../src/taskActions.js");
  const LIST = [{ name: "Underway", isActive: true }, { name: "Complete", isFinished: true }, { name: "Not Started" }];
  const tree = (status) => [{ id: "J", title: "J", subs: [{ id: "P", title: "P", subs: [{ id: "O", title: "O", status }] }] }];
  const perms = (from, to, statuses) => [...classifyTaskActions(tree(to), tree(from), { statuses }).perms];
  ok("setting the renamed finished status needs approveCompletions", perms("Underway", "Complete", LIST), ["approveCompletions"]);
  ok("...where by spelling it was an ordinary edit", perms("Underway", "Complete", undefined), ["editJobs"]);

  // The REAL timeclock handler, on an in-memory S3 (worker-writes-test's loader).
  const { register } = await import("node:module");
  register("./timeclock-itest-loader.mjs", import.meta.url);
  for (const v of ["SCHEDULE_RULES_MODE", "TASK_CONFLICT_MODE", "OVERLAP_RULE_MODE", "IDENTITY_PROVIDER_MODE", "TZ_FALLBACK_MODE"]) process.env[v] = "log";
  const timeclock = (await import(new URL("../netlify/functions/timeclock.js", import.meta.url).href)).handler;
  globalThis.__S3 = {
    "orgs/TESTORG/settings.json": { timeZone: "America/Denver", workStart: "00:00", workEnd: "24:00", workDays: [0,1,2,3,4,5,6], lunch: { durationMinutes: 0 }, breaks: [], statusOpts: LIST },
    "orgs/TESTORG/people.json": [{ id: 7, name: "W", userRole: "user", activeClockIn: { clockIn: new Date(Date.now() - 3600e3).toISOString() } }],
    "orgs/TESTORG/tasks.json": [{ id: "J", title: "J", status: "Not Started", subs: [{ id: "P", title: "P", status: "Not Started",
      subs: [{ id: "O", title: "O", status: "Not Started", team: [7], start: "2026-09-30", end: "2026-09-30" }] }] }],
  };
  globalThis.__WRITES = []; globalThis.__AUTH = { personId: "7", isAdmin: false, email: "w@x.com" };
  const res = await timeclock({ httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "jobClockIn", personId: 7,
    jobId: "J", panelId: "P", opId: "O", sessionId: "S1", reservoirOpId: "O", sessionSnapshot: [] }) });
  const job = globalThis.__S3["orgs/TESTORG/tasks.json"][0];
  ok("a clock-in stamps the org's renamed in-progress status on op, panel and job",
    [res.statusCode, job.subs[0].subs[0].status, job.subs[0].status, job.status], [200, "Underway", "Underway", "Underway"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
