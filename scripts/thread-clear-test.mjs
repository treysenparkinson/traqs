// #297 — who may clear a chat thread.
//
//   node scripts/thread-clear-test.mjs
//
// Ruled 2026-10-16: groups stay creator-or-admin; job, panel and op threads are
// admin-only, because they have no creator; a DM cannot be cleared by anyone.
// Three layers, because the rule is read in three places:
//   1. the rule itself (src/threadClear.js);
//   2. the REAL messages.js DELETE on an in-memory S3 — the refusal is the server's;
//   3. the web's controls — a "Clear Chat" the server would refuse is a button
//      that lies, so each menu must offer the option only where the rule allows.
import { register } from "module";
import { readFileSync } from "node:fs";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let canClearThread, messagesFn;
try {
  ({ canClearThread } = await import(new URL("../src/threadClear.js", import.meta.url).href));
  messagesFn = (await import(new URL("../netlify/functions/messages.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the code under test:", e); process.exit(2); }
if (typeof canClearThread !== "function") { console.error("canClearThread is not exported"); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// ── 1. THE RULE ─────────────────────────────────────────────────────────────
console.log("\n1. The rule");
const GROUPS = [{ id: "G1", name: "Crew", memberIds: [7, 8], createdBy: 7 }, { id: "G2", name: "Legacy", memberIds: [7, 8] }];
const member = { viewerId: "8", isAdmin: false };
const creator = { viewerId: "7", isAdmin: false };
const admin = { viewerId: "1", isAdmin: true };
ok("group: creator yes, member no, admin yes",
  [canClearThread("group:G1", creator, GROUPS), canClearThread("group:G1", member, GROUPS), canClearThread("group:G1", admin, GROUPS)],
  [true, false, true]);
ok("group by NAME resolves the same as by id", canClearThread("group:Crew", creator, GROUPS), true);
ok("group with no recorded creator: admin only",
  [canClearThread("group:G2", creator, GROUPS), canClearThread("group:G2", admin, GROUPS)], [false, true]);
ok("a group that does not exist: nobody", canClearThread("group:nope", admin, GROUPS), false);
for (const k of ["job:J1", "panel:P1", "op:O1"]) {
  ok(`${k.split(":")[0]} thread: admin yes, participant no`,
    [canClearThread(k, admin, GROUPS), canClearThread(k, member, GROUPS)], [true, false]);
}
ok("dm: neither participant, and not an admin",
  [canClearThread("dm:7_8", { viewerId: "7", isAdmin: false }, GROUPS),
   canClearThread("dm:7_8", { viewerId: "8", isAdmin: false }, GROUPS),
   canClearThread("dm:1_7", admin, GROUPS)], [false, false, false]);
ok("an unknown thread kind: nobody", canClearThread("other:x", admin, GROUPS), false);
ok("no viewer: nobody", canClearThread("job:J1", { viewerId: null, isAdmin: true }, GROUPS), false);

// ── 2. THE SERVER ───────────────────────────────────────────────────────────
console.log("\n2. DELETE /messages (real handler)");
const K = { groups: "orgs/TESTORG/groups.json", messages: "orgs/TESTORG/messages.json", people: "orgs/TESTORG/people.json", tasks: "orgs/TESTORG/tasks.json" };
const OLD = "2026-09-30T10:00:00.000Z";
const as = (personId, isAdmin = false) => ({ personId: String(personId), isAdmin, adminPerms: isAdmin ? null : undefined, email: `${personId}@x` });
const THREADS = ["dm:7_8", "dm:1_7", "job:J1", "panel:P1", "op:O1", "group:G1"];
const seed = (auth) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    [K.people]: [{ id: 1, name: "Admin", userRole: "admin", email: "1@x" }, { id: 7, name: "Wendy", email: "7@x" }, { id: 8, name: "Sam", email: "8@x" }],
    // 8 is on the job's team, so they are a PARTICIPANT in its job, panel and op threads.
    [K.tasks]: [{ id: "J1", title: "Job", team: [1, 8], subs: [{ id: "P1", title: "Panel", team: [8], subs: [{ id: "O1", title: "Op", team: [8] }] }] }],
    [K.groups]: GROUPS.map(g => ({ ...g, lastModifiedAt: OLD })),
    [K.messages]: THREADS.map((t, i) => ({ id: `M${i}`, threadKey: t, text: "x", authorId: 8, lastModifiedAt: OLD })),
  };
  globalThis.__AUTH = { ...auth };
};
const clear = (threadKey) => messagesFn({ httpMethod: "DELETE", headers: {}, queryStringParameters: { threadKey } });
const liveMsgs = (tk) => globalThis.__S3[K.messages].filter(m => m.threadKey === tk && !m.deletedAt).length;
const tryClear = async (auth, tk) => { seed(auth); const r = await clear(tk); return [r.statusCode, liveMsgs(tk)]; };

for (const tk of ["job:J1", "panel:P1", "op:O1"]) {
  ok(`${tk}: a participant who is not an admin is refused, messages kept`, await tryClear(as(8), tk), [403, 1]);
  ok(`${tk}: an admin clears it`, await tryClear(as(1, true), tk), [200, 0]);
}
ok("dm: a participant is refused, messages kept", await tryClear(as(8), "dm:7_8"), [403, 1]);
ok("dm: the other participant is refused too", await tryClear(as(7), "dm:7_8"), [403, 1]);
ok("dm: an admin who is IN the DM is refused", await tryClear(as(1, true), "dm:1_7"), [403, 1]);
ok("group: the creator still clears it", await tryClear(as(7), "group:G1"), [200, 0]);
ok("group: a member still cannot", await tryClear(as(8), "group:G1"), [403, 1]);
ok("group: an admin still can", await tryClear(as(1, true), "group:G1"), [200, 0]);
seed(as(1, true));
{
  await clear("job:J1");
  ok("an admin's clear tombstones only that thread", THREADS.filter(t => t !== "job:J1").map(liveMsgs), [1, 1, 1, 1, 1]);
}

// ── 3. THE WEB'S CONTROLS ───────────────────────────────────────────────────
console.log("\n3. The web's Clear Chat controls follow the rule");
const RAW = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const block = (from, to) => {
  const a = RAW.indexOf(from); const b = RAW.indexOf(to, a + 1);
  if (a < 0 || b < 0 || RAW.indexOf(from, a + 1) >= 0) { console.error(`block anchor not unique: ${from}`); process.exit(2); }
  return RAW.slice(a, b);
};
ok("TRAQS.jsx imports canClearThread from the shared rule",
  /import\s*\{[^}]*\bcanClearThread\b[^}]*\}\s*from\s*"\.\/threadClear\.js"/.test(RAW), true);
const threadMenu = block("{/* ─── Job thread context menu ─── */}", "{/* ─── Direct message context menu ─── */}");
ok("the thread menu offers Clear Chat", /Clear Chat/.test(threadMenu), true);
ok("the thread menu gates Clear Chat on canClearThread for THIS thread",
  /canClearThread\(\s*threadCtxMenu\.threadKey\b/.test(threadMenu), true);
ok("the thread menu no longer gates it on editJobs", /can\("editJobs"\)/.test(threadMenu), false);
const dmMenu = block("{/* ─── Direct message context menu ─── */}", "{/* Shared context menu */}");
ok("the DM menu still has its pin option (the block is the right one)", /pinnedThreads/.test(dmMenu), true);
ok("the DM menu offers no delete or clear", /setConfirmClearChat|Delete Conversation|Clear Chat/.test(dmMenu), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
