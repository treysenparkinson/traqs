// people.js PATCH and self-delete must not put back a write that landed while they ran — #292.
//
// Both read people.json, changed one row, and wrote the WHOLE file back with a plain PUT.
// Anything written to people.json between that read and that write — an approval, a clock-in,
// another device's PATCH — was silently reverted. Every other people.json writer was moved
// onto updateJson (conditional write, re-read and re-apply on conflict) in #511-#515; these
// two were left. The race is driven through the REAL handler: __BEFORE_WRITE lands a
// competing write inside the handler's window (it fires on plain PUTs too — the loader's #386
// note — so this goes red against the old code).
//
//   node scripts/people-rmw-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let peopleFn;
try { peopleFn = (await import(new URL("../netlify/functions/people.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load people.js:", e); process.exit(2); }

const KEY = "orgs/TESTORG/people.json";
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const OLD = "2026-09-30T10:00:00.000Z";
const seed = (auth) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__PRECONDITION_FAILURES = [];
  globalThis.__S3 = { [KEY]: [
    { id: "1", name: "Ada", userRole: "admin", lastModifiedAt: OLD },
    { id: "7", name: "Wendy", userRole: "user", color: "#111111", lastModifiedAt: OLD },
    { id: "8", name: "Sam", userRole: "user", timeOff: [], lastModifiedAt: OLD },
  ] };
  globalThis.__AUTH = { ...auth };
};
// The competing write: an approval lands on Sam's row, once, inside the handler's window.
const raceOnce = () => {
  let fired = false;
  globalThis.__BEFORE_WRITE = async (key) => {
    if (fired || key !== KEY) return;
    fired = true;
    const rows = globalThis.__S3[KEY].map(p => p.id === "8" ? { ...p, timeOff: [{ start: "2026-11-02", end: "2026-11-03", status: "approved" }] } : p);
    globalThis.__S3[KEY] = rows;
    globalThis.__ETAGS[KEY] = String(Number(globalThis.__ETAGS[KEY] ?? 0) + 1);
  };
};
const row = (id) => globalThis.__S3[KEY].find(p => p.id === id);
const WORKER = { personId: "7", isAdmin: false, email: "w@x", orgCode: "TESTORG" };

console.log("\n#292 PATCH");
seed(WORKER); raceOnce();
{
  const res = await peopleFn({ httpMethod: "PATCH", headers: {}, body: JSON.stringify({ personId: "7", fields: { color: "#222222" } }) });
  ok("the PATCH succeeds", res.statusCode, 200);
  ok("...its own change lands", row("7").color, "#222222");
  ok("#292 ...and the approval that landed during it SURVIVES", row("8").timeOff.length, 1);
}
seed(WORKER); globalThis.__BEFORE_WRITE = null;
{
  const res = await peopleFn({ httpMethod: "PATCH", headers: {}, body: JSON.stringify({ personId: "8", fields: { color: "#333333" } }) });
  ok("a worker still cannot PATCH someone else", res.statusCode, 403);
  const gone = await peopleFn({ httpMethod: "PATCH", headers: {}, body: JSON.stringify({ personId: "99", fields: { color: "#333333" } }) });
  ok("...an unknown person is still a 404, checked first", gone.statusCode, 404);
  const role = await peopleFn({ httpMethod: "PATCH", headers: {}, body: JSON.stringify({ personId: "7", fields: { userRole: "admin" } }) });
  ok("...and a self role change is still refused", [role.statusCode, row("7").userRole], [403, "user"]);
}

console.log("\n#292 self-delete");
seed(WORKER); raceOnce();
{
  const res = await peopleFn({ httpMethod: "DELETE", headers: {}, queryStringParameters: {}, body: "" });
  ok("the self-delete succeeds", res.statusCode, 200);
  ok("...the caller is tombstoned", !!row("7").deletedAt, true);
  ok("#292 ...and the approval that landed during it SURVIVES", row("8").timeOff.length, 1);
}
seed(WORKER); globalThis.__BEFORE_WRITE = null;
{
  await peopleFn({ httpMethod: "DELETE", headers: {}, queryStringParameters: {}, body: "" });
  const writes = globalThis.__WRITES.length;
  const again = await peopleFn({ httpMethod: "DELETE", headers: {}, queryStringParameters: {}, body: "" });
  ok("a repeated self-delete is idempotent: 200 and no second write", [again.statusCode, globalThis.__WRITES.length], [200, writes]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
