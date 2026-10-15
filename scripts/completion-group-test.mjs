// The one "Completion Requests" group — #296.
//
// groups.js delivers only the groups the caller belongs to. The web's ensureCompletionGroup
// looked for the shared group in that list, so a worker raising their FIRST request saw none,
// created a second group of the same name, and posted their request there — not in the thread
// the approvers read. The server sees every group, so the decision moved there:
// POST /groups?action=ensure-completion, using the same rule as the phone's request
// (_utils/completion-group.js, now also used by timeclock.js).
//
// REAL groups.js on an in-memory S3, plus the pure rule.
//
//   node scripts/completion-group-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
import { readFileSync } from "node:fs";

const { reconcileCompletionGroup, COMPLETION_GROUP_NAME } = await import("../netlify/functions/_utils/completion-group.js");
let groupsFn;
try { groupsFn = (await import(new URL("../netlify/functions/groups.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load groups.js:", e); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// ── the rule ───────────────────────────────────────────────────────────────
console.log("\nthe rule");
{
  const r = reconcileCompletionGroup([], [], { approverIds: ["1"], requesterId: "7", newId: "g1", at: "T" });
  ok("no group yet: one is created with the approvers and the requester", [r.changed, r.grp.name, r.grp.memberIds, r.groups.length], [true, COMPLETION_GROUP_NAME, ["1", "7"], 1]);
  const shared = { id: "g1", name: COMPLETION_GROUP_NAME, memberIds: ["1"] };
  const r2 = reconcileCompletionGroup([shared], [], { approverIds: ["1"], requesterId: "7", newId: "NEW", at: "T" });
  ok("#296 the shared group exists: the requester joins IT, no second group", [r2.grp.id, r2.grp.memberIds, r2.groups.length], ["g1", ["1", "7"], 1]);
  const r3 = reconcileCompletionGroup([{ ...shared, memberIds: ["1", "7"] }], [], { approverIds: ["1"], requesterId: "7", newId: "NEW", at: "T" });
  ok("already seated: nothing changes", [r3.changed, r3.grp.memberIds], [false, ["1", "7"]]);
  const sent = [{ type: "finish_request", threadKey: "group:g1", authorId: "8" }];
  const r4 = reconcileCompletionGroup([{ ...shared, memberIds: ["1", "5", "8"] }], sent, { approverIds: ["1"], requesterId: "7", newId: "NEW", at: "T" });
  ok("an earlier requester keeps their seat; someone who is neither is reconciled out", r4.grp.memberIds, ["1", "8", "7"]);
  const r5 = reconcileCompletionGroup([], [], { approverIds: [1, "1"], requesterId: "1", newId: "g", at: "T" });
  ok("ids are deduplicated as strings compare", r5.grp.memberIds, [1]);
}

// ── the real handler ───────────────────────────────────────────────────────
const GK = "orgs/TESTORG/groups.json", PK = "orgs/TESTORG/people.json", MK = "orgs/TESTORG/messages.json";
const WORKER = { personId: "7", isAdmin: false, email: "w@x", orgCode: "TESTORG" };
const seed = (groups) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = {
    [PK]: [
      { id: "1", name: "Ada", userRole: "admin" },
      { id: "2", name: "Rita", userRole: "admin", adminPerms: { approveCompletions: false } },
      { id: "7", name: "Wendy", userRole: "user" },
    ],
    [MK]: [],
    ...(groups ? { [GK]: groups } : {}),
  };
  globalThis.__AUTH = { ...WORKER };
};
const ensure = () => groupsFn({ httpMethod: "POST", headers: {}, queryStringParameters: { action: "ensure-completion" }, body: "" });
const named = () => (globalThis.__S3[GK] || []).filter(g => g.name === COMPLETION_GROUP_NAME);

console.log("\nPOST /groups?action=ensure-completion");
seed([{ id: "g1", name: COMPLETION_GROUP_NAME, memberIds: ["1"], createdBy: "1" }, { id: "x", name: "Other", memberIds: ["1"] }]);
{
  const res = await ensure();
  ok("#296 a worker who cannot see the shared group is seated IN it", [res.statusCode, res.body.group?.id, named().length], [200, "g1", 1]);
  ok("#296 ...with the approvers, and not the admin whose toggle is off", named()[0].memberIds, ["1", "7"]);
  ok("...other people's groups are untouched", globalThis.__S3[GK].find(g => g.id === "x").memberIds, ["1"]);
  const writes = globalThis.__WRITES.length;
  const again = await ensure();
  ok("a second request writes nothing and returns the same group", [again.statusCode, again.body.group?.id, globalThis.__WRITES.length], [200, "g1", writes]);
}
seed(null);
{
  const res = await ensure();
  ok("no group yet: one is created and returned", [res.statusCode, named().length, named()[0]?.memberIds, res.body.group?.id === named()[0]?.id], [200, 1, ["1", "7"], true]);
}
seed([]);
globalThis.__S3[PK] = [{ id: "7", name: "Wendy", userRole: "user" }];
{
  const res = await ensure();
  ok("nobody can approve: no group is made, and the caller is told", [res.statusCode, res.body.noApprover, named().length], [200, true, 0]);
}

// #411, THE REVERSE DIRECTION. The helper keeps ids "as the roster holds them", and the web
// reads memberIds with a strict `.includes(p.id)`. The caller passed the requester as
// String(personId), so on a roster with NUMERIC ids the approvers went in as numbers and the
// requester as "7" — and the web's member list did not find the person who asked.
seed(null);
globalThis.__S3[PK] = [{ id: 1, name: "Ada", userRole: "admin" }, { id: 7, name: "Wendy", userRole: "user" }];
{
  await ensure();
  ok("#411 a numeric-id roster: the requester is seated under the roster's own id", named()[0]?.memberIds, [1, 7]);
}

// ── the web asks the server and no longer builds the group itself ──────────
console.log("\nthe web client");
{
  const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const at = S.indexOf("const ensureCompletionGroup = async () => {");
  const fn = S.slice(at, S.indexOf("const requestFinishApproval", at)).replace(/^\s*\/\/.*$/gm, "");
  ok("#296 ensureCompletionGroup asks the server", /ensureCompletionGroupAction\(/.test(fn), true);
  ok("#296 ...and creates no group of its own", /saveGroups\(|name:\s*grpName|uid\(\)/.test(fn), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
