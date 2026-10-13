// #525 — A FULL-ROSTER SAVE NEVER DELETES ANYONE. Deletion is an explicit call.
//
// Every client deleted a person by leaving them out of a whole-roster POST, and
// people.js tombstoned (PIN stripped) every stored person the POST omitted. The same
// rule turned a STALE roster into a mass delete: an iOS phone's push-token fallback
// (#525) posts its cached roster at launch, on any network error, with nobody touching
// anything — and anyone added on the web since that phone last synced was deleted.
//
// THE RULE NOW:
//   • POST keeps every stored person it omits, whoever sends it.
//   • DELETE /people?id=X tombstones X — `manageTeam` required (or X is yourself), same
//     tombstone shape as before: PIN stripped, push token cleared.
//   • DELETE /people with no id is still self-delete (the profile's Delete Account).
//   • The web's delPerson calls it.
//
//   node scripts/people-delete-test.mjs
import { register } from "module";
import { readFileSync } from "node:fs";
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
    { id: "1", name: "Admin", userRole: "admin", lastModifiedAt: OLD },
    { id: "2", name: "Rita", userRole: "admin", adminPerms: { editJobs: true, manageTeam: false }, lastModifiedAt: OLD },
    { id: "7", name: "Wendy", userRole: "user", lastModifiedAt: OLD },
    { id: "8", name: "Sam", userRole: "user", pin: "1234", pushToken: "tok", lastModifiedAt: OLD },
  ] };
  globalThis.__AUTH = { ...auth };
};
const roster = () => JSON.parse(JSON.stringify(globalThis.__S3[KEY]));
const who = (id) => globalThis.__S3[KEY].find((p) => String(p.id) === id);
const state = (p) => (!p ? "gone" : p.deletedAt ? "tombstoned" : "live");
const post = (arr) => peopleFn({ httpMethod: "POST", headers: {}, body: JSON.stringify(arr) });
const del = (id) => peopleFn({ httpMethod: "DELETE", headers: {}, queryStringParameters: id == null ? {} : { id } });

console.log("\n1. A FULL-ROSTER SAVE THAT LEAVES SOMEONE OUT DELETES NOBODY — whoever sends it");
for (const [label, auth] of [["admin with manageTeam", TEAM_ADMIN], ["admin without", RESTRICTED_ADMIN], ["worker", WORKER]]) {
  seed(auth);
  const res = await post(roster().filter((p) => p.id !== "8"));
  ok(`${label}: the save succeeds`, res.statusCode, 200);
  ok(`${label}: Sam is kept`, state(who("8")), "live");
  ok(`${label}: Sam's PIN survives`, who("8")?.pin != null, true);
}

console.log("\n2. DELETE /people?id= REMOVES SOMEONE — manageTeam only");
{
  seed(TEAM_ADMIN);
  const res = await del("8");
  ok("an admin with manageTeam deletes Sam", [res.statusCode, state(who("8"))], [200, "tombstoned"]);
  ok("...the tombstone drops the PIN", who("8")?.pin ?? null, null);
  ok("...and clears the push token", who("8")?.pushToken ?? null, null);
  ok("...and nobody else moved", ["1", "2", "7"].map((id) => state(who(id))), ["live", "live", "live"]);
  const again = await del("8");
  ok("a repeat delete is harmless", [again.statusCode, state(who("8"))], [200, "tombstoned"]);
}
for (const [label, auth] of [["admin without manageTeam", RESTRICTED_ADMIN], ["worker", WORKER]]) {
  seed(auth);
  const res = await del("8");
  ok(`${label}: refused`, [res.statusCode, state(who("8"))], [403, "live"]);
}
{
  seed(TEAM_ADMIN);
  const res = await del("999");
  ok("an unknown id is a 404", res.statusCode, 404);
}

console.log("\n3. SELF-DELETE IS UNCHANGED");
{
  seed(WORKER);
  const res = await del(null);
  ok("no id deletes the caller", [res.statusCode, state(who("7"))], [200, "tombstoned"]);
  ok("...and only the caller", state(who("8")), "live");
}
{
  seed(WORKER);
  const res = await del("7");
  ok("naming yourself is the same as self-delete", [res.statusCode, state(who("7"))], [200, "tombstoned"]);
}

console.log("\n4. THE WEB DELETES WITH THE CALL, NOT BY OMISSION");
{
  const API = readFileSync(new URL("../src/api.js", import.meta.url), "utf8");
  const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  ok("src/api.js has deletePerson, a DELETE to /people?id=",
    /export async function deletePerson\(id, getToken, orgCode\)[\s\S]{0,300}?\/people\?id=\$\{encodeURIComponent\(id\)\}[\s\S]{0,120}?method: "DELETE"/.test(API), true);
  const del = /const delPerson = [^\n]*/.exec(J)?.[0] || "";
  ok("delPerson calls deletePerson", /deletePerson\(id, getToken, orgCode\)/.test(del), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
