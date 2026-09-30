// Who may change or wipe a chat group — root cause 4.
//
//   node scripts/groups-perms-test.mjs
//
// REAL groups.js and messages.js on an in-memory S3. Any member of a group could
// rename it, rewrite its members, delete it (POST /groups without it) or clear its
// history (DELETE /messages?threadKey=group:…) — the same class as the people
// delete. Now only the group's creator or an admin can; for anyone else the
// stored group is kept and the POST still succeeds, the clear is refused.
// Creating a group, and posting in one, are unchanged. Enforced immediately.
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let groupsFn, messagesFn;
try {
  groupsFn = (await import(new URL("../netlify/functions/groups.js", import.meta.url).href)).handler;
  messagesFn = (await import(new URL("../netlify/functions/messages.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the handlers:", e); process.exit(2); }

const K = { groups: "orgs/TESTORG/groups.json", messages: "orgs/TESTORG/messages.json", people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json" };
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const as = (personId, isAdmin = false) => ({ personId: String(personId), isAdmin, adminPerms: isAdmin ? null : undefined, email: `${personId}@x` });
const OLD = "2026-09-30T10:00:00.000Z";
const seed = (auth) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    [K.people]: [{ id: 1, name: "Admin", userRole: "admin", email: "1@x" }, { id: 7, name: "Wendy", email: "7@x" },
                 { id: 8, name: "Sam", email: "8@x" }, { id: 9, name: "Olga", email: "9@x" }],
    [K.tasks]: [],
    [K.groups]: [
      { id: "G1", name: "Crew", memberIds: [7, 8, 9], createdBy: 7, lastModifiedAt: OLD },
      { id: "G2", name: "Legacy", memberIds: [7, 8], lastModifiedAt: OLD },          // no createdBy
    ],
    [K.messages]: [
      { id: "M1", threadKey: "group:G1", text: "hi", authorId: 7, lastModifiedAt: OLD },
      { id: "M2", threadKey: "group:G1", text: "yo", authorId: 8, lastModifiedAt: OLD },
      { id: "M3", threadKey: "dm:7_8", text: "dm", authorId: 7, lastModifiedAt: OLD },
    ],
  };
  globalThis.__AUTH = { ...auth };
};
const mine = (personId) => JSON.parse(JSON.stringify(globalThis.__S3[K.groups].filter(g => (g.memberIds || []).map(String).includes(String(personId)))));
const postGroups = (arr) => groupsFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(arr) });
const clear = (threadKey) => messagesFn({ httpMethod: "DELETE", headers: {}, queryStringParameters: { threadKey } });
const g = (id) => globalThis.__S3[K.groups].find(x => x.id === id);
const liveMsgs = (tk) => globalThis.__S3[K.messages].filter(m => m.threadKey === tk && !m.deletedAt).length;

console.log("\n1. A member who is not the creator");
seed(as(8));
{
  const arr = mine(8); arr.find(x => x.id === "G1").name = "Sam's now";
  const res = await postGroups(arr);
  ok("rename: POST succeeds, name unchanged", [res.statusCode, g("G1").name], [200, "Crew"]);
}
seed(as(8));
{
  const arr = mine(8); arr.find(x => x.id === "G1").memberIds = [8];
  await postGroups(arr);
  ok("rewriting the members: unchanged", g("G1").memberIds, [7, 8, 9]);
}
seed(as(8));
{
  const res = await postGroups(mine(8).filter(x => x.id !== "G1"));
  ok("deleting by omission: kept", [res.statusCode, !!g("G1") && !g("G1").deletedAt], [200, true]);
}
seed(as(8));
{
  const res = await clear("group:G1");
  ok("clearing the history: refused, messages kept", [res.statusCode, liveMsgs("group:G1")], [403, 2]);
}
seed(as(8));
{
  const res = await postGroups([...mine(8), { id: "G3", name: "Sam's group", memberIds: [8, 9], createdBy: 8 }]);
  ok("creating a new group still works", [res.statusCode, !!g("G3")], [200, true]);
}
seed(as(8));
{
  const res = await clear("dm:7_8");
  ok("clearing a DM they're in is unchanged", [res.statusCode, liveMsgs("dm:7_8")], [200, 0]);
}

console.log("\n2. The creator, and an admin");
seed(as(7));
{
  const arr = mine(7); arr.find(x => x.id === "G1").name = "Crew A";
  await postGroups(arr);
  ok("creator renames", g("G1").name, "Crew A");
  const res = await clear("group:G1");
  ok("creator clears the history", [res.statusCode, liveMsgs("group:G1")], [200, 0]);
}
seed(as(7));
{
  await postGroups(mine(7).filter(x => x.id !== "G1"));
  ok("creator deletes by omission", !!g("G1")?.deletedAt, true);
}
seed(as(1, true));
{
  // The admin isn't a member of G1: membership still scopes what a POST can see,
  // so an admin edits or deletes a group they are in, and clears any group's chat.
  const res = await clear("group:G1");
  ok("admin clears a group's history", [res.statusCode, liveMsgs("group:G1")], [200, 0]);
}

console.log("\n3. A group with no recorded creator is admin-only");
seed(as(7));
{
  const arr = mine(7); arr.find(x => x.id === "G2").name = "Mine";
  await postGroups(arr);
  ok("member edit of a creatorless group: unchanged", g("G2").name, "Legacy");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
