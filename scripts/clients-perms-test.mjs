// POST /clients from a caller without manageClients — root cause 4.
//
//   node scripts/clients-perms-test.mjs
//
// REAL clients.js on an in-memory S3. clients.js required manageClients before it
// even looked at the body, so an UNCHANGED list — what every autosave sent — was
// refused for every worker and restricted admin. /tasks already lets a no-op
// through; clients now does the same, behind PERMISSION_GATES_MODE:
//   enforce — a no-op from anyone is 200 and writes nothing; a real change still
//             needs manageClients.
//   log (default) — refused as before, and the would-be allowance is logged.
//   off — refused as before, not logged.
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let clientsFn;
try { clientsFn = (await import(new URL("../netlify/functions/clients.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load clients.js:", e); process.exit(2); }

const KEY = "orgs/TESTORG/clients.json";
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
let logs = [];
const realWarn = console.warn;
console.warn = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("{")) { try { const o = JSON.parse(a[0]); if (o.tag) { logs.push(o); return; } } catch {} }
  realWarn(...a);
};
const WORKER = { personId: "7", isAdmin: false, email: "w@x" };
const MANAGER = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const seed = (mode, auth) => {
  if (mode === undefined) delete process.env.PERMISSION_GATES_MODE; else process.env.PERMISSION_GATES_MODE = mode;
  logs = [];
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [KEY]: [{ id: "C1", name: "Acme", lastModifiedAt: "2026-09-30T10:00:00.000Z" }] };
  globalThis.__AUTH = { ...auth };
};
const list = () => JSON.parse(JSON.stringify(globalThis.__S3[KEY]));
const post = (arr) => clientsFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(arr) });
const gateLogs = () => logs.filter(l => l.tag === "permission-gate").map(l => [l.mode, l.gate]);

console.log("\n1. enforce");
seed("enforce", WORKER);
{
  const res = await post(list());
  ok("worker, unchanged list: 200 and nothing written", [res.statusCode, globalThis.__WRITES.length], [200, 0]);
}
seed("enforce", WORKER);
{
  const l = list(); l[0].name = "Acme (renamed)";
  const res = await post(l);
  ok("worker, a real change: still 403", [res.statusCode, globalThis.__S3[KEY][0].name], [403, "Acme"]);
}
seed("enforce", WORKER);
{
  const res = await post([...list(), { id: "C2", name: "New" }]);
  ok("worker, adding a client: 403", res.statusCode, 403);
}
seed("enforce", MANAGER);
{
  const l = list(); l[0].name = "Acme (renamed)";
  const res = await post(l);
  ok("control: manageClients changes it", [res.statusCode, globalThis.__S3[KEY][0].name], [200, "Acme (renamed)"]);
}

console.log("\n2. log (default) and off");
seed(undefined, WORKER);
{
  const res = await post(list());
  ok("log: unchanged list still refused as before", res.statusCode, 403);
  ok("log: the would-be allowance is logged", gateLogs(), [["log", "clientsNoop"]]);
}
seed("off", WORKER);
{
  const res = await post(list());
  ok("off: refused, not logged", [res.statusCode, gateLogs()], [403, []]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
