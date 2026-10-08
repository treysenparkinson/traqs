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
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";

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

// RE-RULED 2026-10-08 (#475). These asserted the rollout: in `log` and `off` an
// unchanged list was still refused, and the would-be allowance only recorded.
// `enforce` was the production value for days with no 403s reported, so the
// allowance is now unconditional and the flag is deleted. The no-op case keeps
// calling `requirePerm` only when the list actually CHANGED — dropping the
// condition entirely would have 403'd every worker's autosave, which is the
// regression this whole retirement existed to avoid.
console.log("\n2. the flag is gone — every mode behaves as enforce did");
for (const mode of [undefined, "log", "off", "enforce"]) {
  const name = mode === undefined ? "unset" : mode;
  seed(mode, WORKER);
  {
    const res = await post(list());
    ok(`${name}: worker's unchanged list is 200 and writes nothing`,
       [res.statusCode, globalThis.__WRITES.length], [200, 0]);
  }
  seed(mode, WORKER);
  {
    const l = list(); l[0].name = "Acme (renamed)";
    const res = await post(l);
    ok(`${name}: a real change is still 403`, [res.statusCode, globalThis.__S3[KEY][0].name], [403, "Acme"]);
  }
}
seed(undefined, WORKER);
{
  await post(list());
  ok("the no-op is still recorded, without a mode it no longer has", gateLogs(), [[undefined, "clientsNoop"]]);
}

console.log("\n3. clients.js no longer reads the flag");
{
  const src = codeOf(readFileSync(new URL("../netlify/functions/clients.js", import.meta.url), "utf8"));
  ok("no PERMISSION_GATES_MODE", /PERMISSION_GATES_MODE/.test(src), false);
  ok("no gateMode", /gateMode/.test(src), false);
  ok("the no-op allowance is unconditional", /if \(!isNoop\) \{/.test(src), true);
  // And the whole variable is gone from the repo's source.
  for (const f of ["../netlify/functions/tasks.js", "../netlify/functions/_utils/rule-mode.js"]) {
    const s2 = codeOf(readFileSync(new URL(f, import.meta.url), "utf8"));
    ok(`${f.split("/").pop()} does not read it either`, /PERMISSION_GATES_MODE/.test(s2), false);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
