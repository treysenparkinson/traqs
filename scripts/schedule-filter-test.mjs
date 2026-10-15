// The schedule's bar filter — status, client, job number and search — and what it does to an
// engineering chip (#106).
//
// The filter waved every non-task bar through, on the reasoning that PTO and chips "aren't tied
// to a task status/client/job number". A chip is: it belongs to one job. Filtered to one client,
// the engineers' rows kept every other client's chips.
//
//   node scripts/schedule-filter-test.mjs

import { readFileSync } from "node:fs";
import { scheduleBarPasses } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

const JOBS = { j1: { clientId: "acme" }, j2: { clientId: "bolt" } };
const clientOfJob = (id) => JOBS[id]?.clientId;
const F = (o = {}) => ({ statuses: [], clientIds: [], jobNumQ: "", searchQ: "", clientOfJob, ...o });

const op = { type: "task", status: "In Progress", jobNumber: "401945", title: "P1 · Wire", task: { pid: "p1", grandPid: "j1", jobTitle: "Brush Creek", panelTitle: "P1" } };
const chipA = { type: "eng-chip", jobId: "j1", jobNumber: "401945", jobTitle: "Brush Creek", panelTitle: "P1", title: "P1 · Verified" };
const chipB = { type: "eng-chip", jobId: "j2", jobNumber: "402100", jobTitle: "Torus", panelTitle: "MCC", title: "MCC · Designed" };
const pto = { type: "pto", title: "PTO" };

// ── unchanged for operations ───────────────────────────────────────────────
ok("no filter: an op passes", scheduleBarPasses(op, F()));
ok("status filter keeps a matching op", scheduleBarPasses(op, F({ statuses: ["In Progress"] })));
ok("status filter drops another status", !scheduleBarPasses(op, F({ statuses: ["Finished"] })));
ok("an op with no status reads as Not Started", scheduleBarPasses({ ...op, status: undefined }, F({ statuses: ["Not Started"] })));
ok("client filter keeps the op's client", scheduleBarPasses(op, F({ clientIds: ["acme"] })));
ok("client filter drops another client", !scheduleBarPasses(op, F({ clientIds: ["bolt"] })));
ok("client filter drops an op whose job is gone", !scheduleBarPasses({ ...op, task: { pid: "p9", grandPid: "j9" } }, F({ clientIds: ["acme"] })));
ok("job number filter", scheduleBarPasses(op, F({ jobNumQ: "4019" })) && !scheduleBarPasses(op, F({ jobNumQ: "4021" })));
ok("search reads the job title", scheduleBarPasses(op, F({ searchQ: "brush" })) && !scheduleBarPasses(op, F({ searchQ: "torus" })));

// ── PTO is still always kept ───────────────────────────────────────────────
ok("PTO passes every filter", scheduleBarPasses(pto, F({ statuses: ["Finished"], clientIds: ["bolt"], jobNumQ: "1", searchQ: "zzz" })));

// ── #106: the chip is filtered through its job ─────────────────────────────
ok("#106 client filter keeps a chip of that client", scheduleBarPasses(chipA, F({ clientIds: ["acme"] })));
ok("#106 client filter drops another client's chip", !scheduleBarPasses(chipB, F({ clientIds: ["acme"] })));
ok("#106 job number filter applies to a chip", scheduleBarPasses(chipB, F({ jobNumQ: "4021" })) && !scheduleBarPasses(chipA, F({ jobNumQ: "4021" })));
ok("#106 search finds a chip by its job title", scheduleBarPasses(chipB, F({ searchQ: "torus" })) && !scheduleBarPasses(chipA, F({ searchQ: "torus" })));
ok("#106 search finds a chip by its panel", scheduleBarPasses(chipB, F({ searchQ: "mcc" })));
ok("#106 the status filter does not apply to a chip, which is not an operation", scheduleBarPasses(chipA, F({ statuses: ["Finished"] })));

// RED PROOF: the rule this replaces kept a foreign client's chip.
{
  const oldRule = (b) => b.type !== "task" ? true : null;
  ok("red proof: the old rule kept the other client's chip", oldRule(chipB) === true);
}

// ── the render uses it, and the chip carries what it needs ─────────────────
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const a = S.indexOf("  const renderTeam = () => {\n");
const b = S.indexOf("\n  const renderAnalytics = () => {");
const code = S.slice(a, b).replace(/^\s*\/\/.*$/gm, "");
ok("the schedule filter is scheduleBarPasses", /passesScheduleBarFilter = [^;]*scheduleBarPasses\(/.test(code));
const chipPush = code.slice(code.indexOf('type: "eng-chip",'), code.indexOf("});", code.indexOf('type: "eng-chip",')));
ok("#106 the chip carries its job number", /jobNumber:\s*job\.jobNumber/.test(chipPush));
ok("#106 the chip carries its job title", /jobTitle:\s*job\.title/.test(chipPush));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
