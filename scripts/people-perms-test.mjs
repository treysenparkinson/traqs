// Who may remove a person — SCHEDULE_MAP root cause 4 (PERMISSIONS_AUDIT D).
//
//   node scripts/people-perms-test.mjs
//
// REAL people.js with the real timestamps.js (tombstoning) on an in-memory S3.
// POST /people takes the whole roster, and every stored person missing from it
// was tombstoned — whoever sent it. So any member could delete a colleague by
// POSTing the roster without them (the web's Employees right-click Delete had no
// gate at all). Removal now needs manageTeam; for anyone else a missing row is
// kept. Enforced immediately — no log-only period for unauthenticated deletion.
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
const WORKER = { personId: "7", isAdmin: false, email: "w@x" };
const RESTRICTED_ADMIN = { personId: "2", isAdmin: true, adminPerms: { editJobs: true, manageTeam: false }, email: "r@x" };
const TEAM_ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const OLD = "2026-09-30T10:00:00.000Z";
const seed = (auth) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [KEY]: [
    { id: 1, name: "Admin", userRole: "admin", lastModifiedAt: OLD },
    { id: 2, name: "Rita", userRole: "admin", adminPerms: { editJobs: true, manageTeam: false }, lastModifiedAt: OLD },
    { id: 7, name: "Wendy", userRole: "user", lastModifiedAt: OLD },
    { id: 8, name: "Sam", userRole: "user", pin: "1234", lastModifiedAt: OLD },
  ] };
  globalThis.__AUTH = { ...auth };
};
const roster = () => JSON.parse(JSON.stringify(globalThis.__S3[KEY]));
const post = (arr) => peopleFn({ httpMethod: "POST", headers: {}, body: JSON.stringify(arr) });
const sam = () => globalThis.__S3[KEY].find(p => p.id === 8);
const state = (p) => (!p ? "gone" : p.deletedAt ? "tombstoned" : "live");

console.log("\n1. Leaving a colleague out of the roster");
for (const [who, auth] of [["worker", WORKER], ["admin without manageTeam", RESTRICTED_ADMIN]]) {
  seed(auth);
  const res = await post(roster().filter(p => p.id !== 8));
  ok(`${who}: the POST still succeeds`, res.statusCode, 200);
  ok(`${who}: Sam is kept, not tombstoned`, state(sam()), "live");
  ok(`${who}: Sam's PIN survives`, sam()?.pin != null, true);
}
seed(TEAM_ADMIN);
{
  const res = await post(roster().filter(p => p.id !== 8));
  ok("control: an admin with manageTeam removes Sam", [res.statusCode, state(sam())], [200, "tombstoned"]);
  ok("control: and the tombstone drops the PIN", sam()?.pin ?? null, null);
}

console.log("\n2. Other ways to remove someone");
seed(WORKER);
{
  const r = roster(); r.find(p => p.id === 8).deletedAt = "2026-09-30T12:00:00.000Z";
  const res = await post(r);
  ok("worker setting deletedAt on a colleague: ignored", [res.statusCode, state(sam())], [200, "live"]);
}
seed(WORKER);
{
  const res = await post(roster().filter(p => p.id !== 7));
  ok("worker leaving themselves out: kept (self-removal is DELETE /people)", [res.statusCode, state(globalThis.__S3[KEY].find(p => p.id === 7))], [200, "live"]);
}
seed(WORKER);
{
  const res = await post([roster().find(p => p.id === 7)]);
  ok("worker POSTing only their own row: nobody else is removed", [res.statusCode, globalThis.__S3[KEY].filter(p => !p.deletedAt).length], [200, 4]);
}
seed(WORKER);
{
  const r = roster(); r.find(p => p.id === 7).name = "Wendy W.";
  const res = await post(r.filter(p => p.id !== 8));
  ok("worker's own safe edit still applies while the omission is ignored", [res.statusCode, globalThis.__S3[KEY].find(p => p.id === 7).name, state(sam())], [200, "Wendy W.", "live"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
