// #400 item 1 — A DURABLE RECORD OF WHICH AI TOOLS ACTUALLY FIRED.
//
// The Jobs-surface sweep could not answer "does anyone use Ask to write?" and
// said so rather than offering a proxy: `rule-events.json` carries only
// `task-conflict` and `session-guard`, the edge function's rate limiter is in
// memory, and AI writes reach /tasks indistinguishable from any other save —
// `update_job` and `update_operation` do not even write a moveLog.
//
// That question decides the priority of routing the six live handlers onto the
// shared commits (#400 item 2): tidying if nobody uses it, urgent if Trey does.
// So the cheap thing ships first and is read in a week.
//
// THE CARRIER IS A HEADER on the save the AI run triggers, recorded server-side
// beside every other rule event. It is deliberately NOT a new endpoint and not a
// client write: the client already cannot be trusted to log its own refusals
// (#403 is exactly that), and the durable log has one writer for a reason.
//
//   node scripts/ai-action-log-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let tasksFn;
try { tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load tasks.js:", e); process.exit(2); }

const K = { tasks: "orgs/TESTORG/tasks.json", events: "orgs/TESTORG/rule-events.json",
  people: "orgs/TESTORG/people.json", settings: "orgs/TESTORG/settings.json" };
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const STORED = () => ([{ id: "JOB", title: "Job", status: "In Progress", lastModifiedAt: "2026-10-01T12:00:00.000Z",
  subs: [{ id: "PANEL", title: "Panel", lastModifiedAt: "2026-10-01T12:00:00.000Z",
    subs: [{ id: "OP", title: "Op", status: "In Progress", startHour: 8, team: [7],
      start: "2026-10-01", end: "2026-10-01", lastModifiedAt: "2026-10-01T12:00:00.000Z" }] }] }]);
const reset = () => {
  globalThis.__S3 = { [K.settings]: { timeZone: "America/Denver" },
    [K.people]: [{ id: 7, name: "Admin", userRole: "admin" }], [K.tasks]: STORED() };
  globalThis.__WRITES = []; globalThis.__ETAGS = {};
  globalThis.__AUTH = { personId: "7", isAdmin: true, email: "a@x.com" };
  globalThis.__AUTH_FAIL = null;
};
const post = async (tasks, headers = {}) => {
  const res = await tasksFn({ httpMethod: "POST", headers, queryStringParameters: {}, body: JSON.stringify(tasks) });
  return { status: res.statusCode };
};
const rows = (tag) => (globalThis.__S3[K.events]?.records || []).filter(r => r.tag === tag);
const edited = () => { const t = STORED(); t[0].subs[0].subs[0].startHour = 11; return t; };

console.log("\n1. A SAVE THAT AN AI RUN TRIGGERED IS RECORDED");
{
  reset();
  await post(edited(), { "x-action-source": "ai:update_operation,assign_person_to_job" });
  const r = rows("ai-action");
  ok("one ai-action row is written", r.length, 1);
  ok("...naming the tools that ran", r[0]?.tools, "update_operation,assign_person_to_job");
  ok("...and the caller, so usage can be attributed", r[0]?.by, "7");
  ok("...with a timestamp", typeof r[0]?.at, "string");
}

console.log("\n2. AN ORDINARY SAVE RECORDS NOTHING");
{
  reset();
  await post(edited(), {});
  ok("no ai-action row for a save with no header", rows("ai-action").length, 0);
  reset();
  await post(edited(), { "x-action-source": "" });
  ok("...nor for an empty header", rows("ai-action").length, 0);
  reset();
  await post(edited(), { "x-action-source": "drag" });
  ok("...nor for a source that is not an AI run", rows("ai-action").length, 0);
}

console.log("\n3. THE HEADER IS CLIENT INPUT AND IS TREATED AS SUCH");
{
  // It lands in a durable file the whole org reads. A client that can write an
  // unbounded string into it has found a way to fill S3 one save at a time.
  reset();
  await post(edited(), { "x-action-source": "ai:" + "x".repeat(5000) });
  const r = rows("ai-action");
  ok("an absurd value is still recorded", r.length, 1);
  ok("...but capped", (r[0]?.tools || "").length <= 200, true);
  reset();
  await post(edited(), { "x-action-source": "ai:update_job\n\rinjected: true" });
  ok("newlines are stripped, so one row stays one row", /[\n\r]/.test(rows("ai-action")[0]?.tools || ""), false);
}

console.log("\n4. IT RECORDS, IT NEVER REFUSES");
{
  // A telemetry tag that can fail a save is worse than no telemetry. This is the
  // whole reason it ships before item 2 rather than with it.
  reset();
  const res = await post(edited(), { "x-action-source": "ai:update_operation" });
  ok("the save still succeeds", res.status, 200);
  ok("...and the write landed", globalThis.__S3[K.tasks][0].subs[0].subs[0].startHour, 11);
}

console.log("\n5. The client sends it, and only for an AI run");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const J = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  const A = codeOf(readFileSync(new URL("../src/api.js", import.meta.url), "utf8"));
  ok("saveTasks can carry a source", /export async function saveTasks\(tasks, getToken, orgCode, actionSource\)/.test(A), true);
  ok("...as the documented header", /"X-Action-Source"/.test(A), true);
  ok("...and omits it when there is none", /actionSource \? \{ "X-Action-Source": actionSource \} : \{\}/.test(A), true);
  ok("the chat path sets it before saving", /aiActionRef\.current = `ai:\$\{/.test(J), true);
  ok("...and CLEARS it afterwards, or every later save is tagged as AI",
    /aiActionRef\.current = null;/.test(J), true);
  // The first argument became the delta envelope (#339); the tag is still the
  // fourth and is what this asserts. Pinned by POSITION rather than by the whole
  // call, so the next change to the payload does not read as the tag going
  // missing — and the body is still asserted to descend from the stripped array
  // in derived-defaults-test.
  ok("doSave passes it through", /saveTasks\(_tasksBody, getTokenRef\.current, orgCodeRef\.current, aiActionRef\.current\)/.test(J), true);
  const C = codeOf(readFileSync(new URL("../netlify/functions/_utils/cors.js", import.meta.url), "utf8"));
  ok("the header is allowed by CORS, or the browser never sends it", /X-Action-Source/.test(C), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
