// #339 — send the jobs that changed, and keep the thing that stops another
// empty-tasks incident.
//
// Measured: 508.3 KB POSTed per write against 17.3 KB actually different (3.4%),
// 112 jobs sent with a median of 1 changed. #227 item 1 removed the ~48% of
// writes that change nothing; this removes most of what the rest carry.
//
// THE BLOCKER was that `reconcileDeletions` infers deletion from ABSENCE, so a
// partial POST reads as a mass delete. Deletion becomes explicit — an envelope
// `{ upsert, delete }` — and the bare array still works, detected BY SHAPE so no
// version flag exists to get wrong. iOS encodes a bare `[Job]` and is untouched.
//
// THE GUARD IS THE POINT OF THIS SUITE. The 2026-06-03 incident guard keyed on
// the request's SHAPE (`tasks.length === 0`), and under an envelope that breaks
// both ways at once: `{ upsert: [], delete: [] }` is an empty-looking no-op and
// `{ upsert: [], delete: [everything] }` is the incident wearing a non-empty
// body. The guard now asks about INTENT: refuse a write that would leave no live
// job when there was one before. Its three properties are asserted below, and
// the red proof is the 2026-06-03 request itself, not a paraphrase.
//
//   node scripts/delta-write-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { applyExplicitWrite, reconcileDeletions, stampArray, changedIds } from "../netlify/functions/_utils/timestamps.js";
import { liveCount, wouldEmptyOrg } from "../netlify/functions/_utils/write-guard.js";
import { jobKeys, dirtyIds, deletedIds, buildDelta, missingFromDelta } from "../src/deltaWrite.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const job = (id, extra = {}) => ({ id, title: "Job " + id, subs: [], ...extra });
// Matrix's board, as the incident found it.
const SIXTY_FOUR = Array.from({ length: 64 }, (_, i) => job("j" + i));
const ids = (list) => list.map(r => r && r.id).filter(Boolean);
const live = (list) => list.filter(r => r && !r.deletedAt);

console.log("\n1. THE GUARD — the 2026-06-03 request is the red proof");
{
  // THE REQUEST THAT WIPED tasks.json: a bare empty array against 64 live jobs.
  // Reconciled the way the legacy path reconciles it, this tombstones all 64.
  const reconciled = reconcileDeletions([], SIXTY_FOUR);
  ok("the incident request still tombstones everything when reconciled", liveCount(reconciled), 0);
  ok("RED: and the guard refuses it", wouldEmptyOrg(reconciled, SIXTY_FOUR), true);

  // PROPERTY 1 — IT DOES NOT DEPEND ON SHAPE. The same intent through the new
  // envelope reaches the same branch. The OLD guard asked `tasks.length === 0`,
  // which this body is not, so it would have waved this through.
  const asEnvelope = applyExplicitWrite([], ids(SIXTY_FOUR), SIXTY_FOUR);
  ok("the envelope form of the same intent empties the org too", liveCount(asEnvelope), 0);
  ok("PROPERTY 1: and the guard refuses that identically", wouldEmptyOrg(asEnvelope, SIXTY_FOUR), true);
  ok("...which the old shape test would NOT have caught",
    ({ upsert: [], delete: ids(SIXTY_FOUR) }).length === 0, false);

  // PROPERTY 2 — STRICTLY STRONGER. Everything the shape guard refused, this
  // refuses: its whole domain was "the body is an empty array".
  ok("PROPERTY 2: an empty bare array against live jobs is still refused",
    wouldEmptyOrg(reconcileDeletions([], SIXTY_FOUR), SIXTY_FOUR), true);
  ok("...for one live job as well as sixty-four",
    wouldEmptyOrg(reconcileDeletions([], [job("only")]), [job("only")]), true);
}

console.log("\n2. THE GUARD — what it must NOT refuse");
{
  // The no-op the old SHAPE guard would have wrongly refused under an envelope.
  const noop = applyExplicitWrite([], [], SIXTY_FOUR);
  ok("an empty envelope is a legitimate no-op", liveCount(noop), 64);
  ok("...and is allowed", wouldEmptyOrg(noop, SIXTY_FOUR), false);

  // PROPERTY 3 — A PARTIAL WRITE CANNOT REACH THE GUARD. Not exempted by a flag:
  // every unmentioned record is carried forward, so `after` cannot fall to zero.
  const partial = applyExplicitWrite([job("j7", { title: "edited" })], [], SIXTY_FOUR);
  ok("PROPERTY 3: a one-job delta keeps every other record", liveCount(partial), 64);
  ok("...so the guard cannot fire on it", wouldEmptyOrg(partial, SIXTY_FOUR), false);
  // ...and it still cannot fire however many are sent, short of all of them.
  const deleteAllButOne = applyExplicitWrite([], ids(SIXTY_FOUR).slice(1), SIXTY_FOUR);
  ok("deleting all but one is allowed", [liveCount(deleteAllButOne), wouldEmptyOrg(deleteAllButOne, SIXTY_FOUR)], [1, false]);
  // An org that is ALREADY empty is not locked out by its own tombstones.
  const tombstones = SIXTY_FOUR.map(j => ({ ...j, deletedAt: "2026-01-01T00:00:00Z" }));
  ok("an already-empty org may still be written to", wouldEmptyOrg([], tombstones), false);
  ok("...and a first write to an empty org is fine", wouldEmptyOrg([], []), false);
  ok("liveCount ignores tombstones", liveCount(tombstones), 0);
  ok("...and survives junk", [liveCount(null), liveCount([null, undefined, job("a")])], [0, 1]);
}

console.log("\n3. EXPLICIT DELETION — absence stops meaning anything");
{
  const stored = [job("a"), job("b"), job("c")];
  // THE BLOCKER, gone: a one-job write no longer deletes the other two.
  const out = applyExplicitWrite([job("b", { title: "edited" })], [], stored);
  ok("an unmentioned record is carried forward", ids(out), ["a", "b", "c"]);
  ok("...untouched, not re-stamped", out[0], stored[0]);
  ok("...and the mentioned one is replaced", out[1].title, "edited");
  // Deletion happens only when named.
  const del = applyExplicitWrite([], ["c"], stored);
  ok("a named id is tombstoned", !!del.find(r => r.id === "c").deletedAt, true);
  ok("...and only it", live(del).map(r => r.id), ["a", "b"]);
  // Order is stable, new records append.
  const added = applyExplicitWrite([job("d")], [], stored);
  ok("a new record appends", ids(added), ["a", "b", "c", "d"]);
  // The anti-resurrection rule from reconcileDeletions survives.
  const withTomb = [job("a"), { ...job("b"), deletedAt: "2026-01-01T00:00:00Z" }];
  const resurrect = applyExplicitWrite([job("b")], [], withTomb);
  ok("a stale client cannot resurrect a tombstone", !!resurrect.find(r => r.id === "b").deletedAt, true);
  // Both at once: delete wins, because it is the more specific statement.
  const both = applyExplicitWrite([job("a", { title: "x" })], ["a"], stored);
  ok("upserted AND deleted in one write ends deleted", !!both.find(r => r.id === "a").deletedAt, true);
  // Edges that must not throw on the write path.
  ok("an unknown delete id is ignored, not invented", ids(applyExplicitWrite([], ["ghost"], stored)), ["a", "b", "c"]);
  ok("no previous at all", ids(applyExplicitWrite([job("a")], [], null)), ["a"]);
  ok("junk arguments", ids(applyExplicitWrite(null, null, stored)), ["a", "b", "c"]);
  ok("a record with no id is carried, not dropped", applyExplicitWrite([], [], [{ title: "idless" }]).length, 1);
}

console.log("\n4. THE REST OF THE PIPELINE IS UNCHANGED BY A PARTIAL WRITE");
{
  const stored = [job("a"), job("b")];
  const stampedBefore = stampArray(stored, []);
  // (d) stampArray preserves stamps for records it does not see — which is
  // exactly what a partial write wants, verified rather than assumed.
  const out = applyExplicitWrite([{ ...stampedBefore[1], title: "edited" }], [], stampedBefore);
  const stamped = stampArray(out, stampedBefore);
  ok("an untouched record keeps its stamp",
    stamped.find(r => r.id === "a").lastModifiedAt, stampedBefore[0].lastModifiedAt);
  ok("...and the edited one gets a new one",
    stamped.find(r => r.id === "b").lastModifiedAt !== stampedBefore[1].lastModifiedAt, true);
  // (e) changedIds reports only what moved, so the push/publish recipients shrink.
  ok("changedIds names only the edited record", changedIds(stamped, stampedBefore), ["b"]);
}

console.log("\n5. THE CLIENT — which jobs are dirty");
{
  const jobs = [job("a"), job("b"), job("c")];
  const keys = jobKeys(jobs);
  ok("a key per job", [...keys.keys()], ["a", "b", "c"]);
  ok("no ack means everything is dirty", [...dirtyIds(keys, null)].sort(), ["a", "b", "c"]);
  ok("...and no delta is built at all — a full write is simpler", buildDelta(jobs, null), null);

  const ack = jobKeys(jobs);
  ok("nothing changed, nothing dirty", [...dirtyIds(keys, ack)], []);
  const edited = [job("a"), job("b", { title: "edited" }), job("c")];
  const keys2 = jobKeys(edited);
  ok("one edit, one dirty id", [...dirtyIds(keys2, ack)], ["b"]);
  const body = buildDelta(edited, ack);
  ok("...and the envelope carries only it", ids(body.upsert), ["b"]);
  ok("...with nothing to delete", body.delete, []);
  // A removed job becomes an explicit delete — delTask REMOVES from the array,
  // which is why the list is needed at all.
  const removed = [job("a"), job("c")];
  ok("a removed job is named in delete", buildDelta(removed, ack).delete, ["b"]);
  ok("...and is not in the upsert", ids(buildDelta(removed, ack).upsert), []);
  // A new job is dirty because the ack has never seen it.
  ok("a new job is dirty", ids(buildDelta([...jobs, job("d")], ack).upsert), ["d"]);
  // An id-less job cannot be tracked, so it rides in every write.
  ok("an id-less job is always sent", buildDelta([...jobs, { title: "no id" }], ack).upsert.length, 1);

  // UNKNOWN IS DIRTY. A job that will not stringify has no content key, so there
  // is no way to tell whether it changed. The two answers are not symmetric:
  // calling it dirty over-sends one job, calling it clean loses the edit forever,
  // because the NEXT write compares null against null and agrees it is clean
  // again. Without this fixture the `key === null` branch is never executed and a
  // mutant that drops it survives — which is how it was found.
  const circular = { id: "z", title: "cycle" };
  circular.self = circular;
  const ckeys = jobKeys([job("a"), circular]);
  ok("an unstringifiable job has no key", ckeys.get("z"), null);
  const cack = new Map(ckeys);                 // the ack agrees it is null
  ok("...and is dirty anyway, because unknown is not clean",
    [...dirtyIds(ckeys, cack)], ["z"]);
  ok("...so it is in the upsert, not quietly held back",
    ids(buildDelta([job("a"), circular], cack).upsert), ["z"]);
}

console.log("\n6. THE INVARIANT — the check the server cannot do");
{
  const jobs = [job("a"), job("b"), job("c")];
  const ack = jobKeys(jobs);
  const edited = [job("a"), job("b", { title: "edited" }), job("c")];
  const keys = jobKeys(edited);

  ok("a correct delta is complete", missingFromDelta(buildDelta(edited, ack), keys, ack), []);
  // THE FAILURE IT EXISTS FOR: a payload that drops a job which really changed.
  // The server cannot tell this from "that job did not change".
  ok("RED: a delta missing a changed job is caught",
    missingFromDelta({ upsert: [], delete: [] }, keys, ack), ["b"]);
  ok("...and names every one it is missing",
    missingFromDelta({ upsert: [], delete: [] }, jobKeys([job("a", { t: 1 }), job("b", { t: 1 })]), ack).sort(), ["a", "b"]);
  // IT DOES NOT TRUST buildDelta. Given a body built elsewhere — or mutated
  // after it was built — it recomputes from the keys. A check that read the same
  // intermediate value would be a tautology and would pass however wrong the
  // payload was.
  const good = buildDelta(edited, ack);
  const sabotaged = { ...good, upsert: good.upsert.filter(j => j.id !== "b") };
  ok("a payload mutated AFTER it was built is still caught", missingFromDelta(sabotaged, keys, ack), ["b"]);
  // A full write cannot omit anything, so it is vacuously complete.
  ok("a bare array is always complete", missingFromDelta(edited, keys, ack), []);
  ok("...and so is null", missingFromDelta(null, keys, ack), []);
}

console.log("\n7. IT IS WIRED — server");
{
  const T = codeOf(read("../netlify/functions/tasks.js"));
  ok("the envelope is detected by SHAPE, not a version flag",
    /Array\.isArray\(body\)/.test(T) && !/version|apiVersion|v2/.test(T), true);
  ok("a bare array still reconciles by absence", /reconcileDeletions\(incoming, existing\)/.test(T), true);
  ok("...and an envelope deletes explicitly", /applyExplicitWrite\(/.test(T), true);
  ok("the guard is the intent one", /wouldEmptyOrg\(/.test(T), true);
  ok("...and the old shape test is gone", /tasks\.length === 0 && !force/.test(T), false);
  ok("...and it still honours ?force=1", /!force && wouldEmptyOrg\(/.test(T), true);
  // The response iOS reads is untouched.
  ok("the reply still carries ok + conflicts", /conflicts/.test(T), true);
}

console.log("\n8. IT IS WIRED — client");
{
  const C = codeOf(read("../src/TRAQS.jsx"));
  ok("deltaWrite is imported", /from "\.\/deltaWrite\.js"/.test(C), true);
  ok("the ack map is kept across saves", /lastAckJobKeysRef/.test(C), true);
  ok("the invariant runs before the POST", /missingFromDelta\(/.test(C), true);
  ok("...and a failure falls back to the full array", /_deltaBody = dedupedTasks/.test(C), true);
  ok("...loudly", /console\.error\(/.test(C), true);
  // The ack is set ONLY when the server took the write whole. After a conflict it
  // kept its own copy of some jobs, so this client's keys for them describe
  // content that was never stored — a delta built from them would skip exactly
  // the jobs that need re-sending.
  ok("the ack is only updated on a save the server accepted",
    /_hadConflicts \? null : _deltaKeys/.test(C), true);
  ok("...and a conflict is what clears it",
    /const _hadConflicts = Array\.isArray\(results\[0\]\.value\?\.conflicts\)/.test(C), true);
}

console.log("\n9. THE HANDLER ITSELF — the guard, exercised end to end");
{
  // THE REGEXES IN SECTION 7 ARE NOT ENOUGH, and mutation proved it: putting the
  // OLD shape guard back, or reading an envelope as a bare array, changed nothing
  // any assertion could see. A protocol change on the endpoint that lost
  // loggedHours (#323) and emptied tasks.json (2026-06-03) has to be driven
  // through the real handler, on an in-memory S3, the way worker-writes-test does.
  const { register } = await import("node:module");
  register("./timeclock-itest-loader.mjs", import.meta.url);
  let tasksFn;
  try {
    tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
  } catch (e) { console.error("could not load tasks.js:", e); process.exit(2); }

  const KEY = "orgs/TESTORG/tasks.json";   // the loader stubs orgKey to this
  const reset = (stored) => {
    globalThis.__S3 = { [KEY]: JSON.parse(JSON.stringify(stored)) };
    globalThis.__WRITES = [];
    globalThis.__AUTH = { personId: "1", isAdmin: true, email: "a@x.com" };
  };
  const post = (body, qs = {}) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: qs, body: JSON.stringify(body) });
  const storedNow = () => globalThis.__S3[KEY] || [];
  const liveNow = () => storedNow().filter(r => r && !r.deletedAt).length;

  // ── THE 2026-06-03 REQUEST, through the handler that serves it today ──
  reset(SIXTY_FOUR);
  const incident = await post([]);
  ok("RED: the incident request is refused", incident.statusCode, 409);
  ok("...and nothing was written", globalThis.__WRITES.length, 0);
  ok("...and all 64 jobs are still live", liveNow(), 64);

  // The same INTENT through the new envelope — the case the old shape guard
  // would have waved through, because the body is not an empty array.
  reset(SIXTY_FOUR);
  const wipe = await post({ upsert: [], delete: ids(SIXTY_FOUR) });
  ok("PROPERTY 1: deleting everything by name is refused too", wipe.statusCode, 409);
  ok("...and nothing was written", globalThis.__WRITES.length, 0);

  // The no-op the old SHAPE guard would have refused.
  reset(SIXTY_FOUR);
  const noop = await post({ upsert: [], delete: [] });
  ok("an empty envelope is accepted as the no-op it is", noop.statusCode, 200);
  ok("...and leaves every job live", liveNow(), 64);

  // PROPERTY 3, end to end: a one-job delta cannot reach the guard.
  reset(SIXTY_FOUR);
  const one = await post({ upsert: [{ ...SIXTY_FOUR[7], title: "edited" }], delete: [] });
  ok("PROPERTY 3: a one-job delta is accepted", one.statusCode, 200);
  ok("...the other 63 are untouched", liveNow(), 64);
  ok("...and the edit landed", storedNow().find(r => r.id === "j7").title, "edited");

  // An explicit delete does delete — the envelope is not merely ignored.
  reset(SIXTY_FOUR);
  const del = await post({ upsert: [], delete: ["j3"] });
  ok("a named delete tombstones exactly one", [del.statusCode, liveNow()], [200, 63]);
  ok("...and it is the one named", !!storedNow().find(r => r.id === "j3").deletedAt, true);

  // LEGACY, unchanged: the bare array still means "this is the world".
  reset(SIXTY_FOUR);
  const legacy = await post(SIXTY_FOUR.slice(0, 10));
  ok("a bare array still deletes by absence", [legacy.statusCode, liveNow()], [200, 10]);

  // ?force=1 still overrides, which is how an org is intentionally cleared.
  reset(SIXTY_FOUR);
  const forced = await post([], { force: "1" });
  ok("?force=1 still clears the org", [forced.statusCode, liveNow()], [200, 0]);

  // A body that is neither shape is still a 400, not a silent no-op.
  reset(SIXTY_FOUR);
  ok("a junk body is refused", (await post({ nonsense: true })).statusCode, 400);
  ok("...and still nothing was written", globalThis.__WRITES.length, 0);

  // ── #449. THE HOP BETWEEN THEM: the REAL saveTasks ──────────────────────
  //
  // Everything above drives deltaWrite.js or the handler. Neither is the step
  // that lost the edits. src/api.js `saveTasks` sat between them with a 2026-04
  // guard that refused anything but an array and returned `{ ok: true }`, so
  // from 2026-10-07 18:04Z every envelope -- every web save after a session's
  // first -- was dropped in the browser and reported as saved. This drives the
  // real export, with `fetch` routed into the real handler, so a guard that
  // swallows the body shows up as an edit missing from the store.
  console.log("\n9b. #449 — the envelope goes through the REAL saveTasks");
  const { saveTasks } = await import(new URL("../src/api.js", import.meta.url).href);
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), method: init.method, body: init.body });
    const r = await tasksFn({ httpMethod: init.method || "GET", headers: init.headers || {}, queryStringParameters: {}, body: init.body });
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return { ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, json: async () => JSON.parse(text), text: async () => text };
  };
  const token = async () => "t";
  try {
    // THE INCIDENT, as a user made it: an edit to one job after the first save.
    reset(SIXTY_FOUR);
    const edited = { ...SIXTY_FOUR[7], title: "edited after the first save" };
    let threw = null, reply = null;
    try { reply = await saveTasks({ upsert: [edited], delete: [] }, token, "TESTORG"); } catch (e) { threw = e.message; }
    ok("RED: saveTasks does not refuse the {upsert, delete} envelope", threw, null);
    ok("...it actually POSTs it (one request, to /tasks)", sent.map(s => `${s.method} ${s.url}`), ["POST /.netlify/functions/tasks"]);
    ok("...the body on the wire is the envelope, not an array", (() => { const b = JSON.parse(sent[0]?.body || "null"); return !!b && !Array.isArray(b) && b.upsert?.[0]?.id; })(), "j7");
    ok("...and the edit is in the store", storedNow().find(r => r.id === "j7")?.title, "edited after the first save");
    ok("...without touching the other 63", liveNow(), 64);
    // The server's reply, not a client-made one: it carries `stamps` (empty here,
    // where the loader stubs timestamps) -- the old guard's fake had none.
    ok("...and the reply is the server's", [reply?.ok, "stamps" in (reply || {})], [true, true]);

    // An envelope that only deletes is the same shape and must also go.
    reset(SIXTY_FOUR); sent.length = 0;
    await saveTasks({ upsert: [], delete: ["j3"] }, token, "TESTORG");
    ok("a delete-only envelope is sent", sent.length, 1);
    ok("...and the deletion lands", storedNow().find(r => r.id === "j3")?.deletedAt ? "deleted" : "live", "deleted");

    // The bare array -- the first save of a session -- is unchanged.
    reset(SIXTY_FOUR); sent.length = 0;
    await saveTasks(SIXTY_FOUR.map(j => j.id === "j9" ? { ...j, title: "full write" } : j), token, "TESTORG");
    ok("the bare array still goes, and lands", [sent.length, storedNow().find(r => r.id === "j9")?.title], [1, "full write"]);

    // Neither shape: refused LOUDLY. The silent `{ ok: true }` is what let this
    // run for hours with nobody told; a caller must see the refusal.
    reset(SIXTY_FOUR); sent.length = 0;
    let junk = null;
    try { await saveTasks({ nonsense: true }, token, "TESTORG"); } catch (e) { junk = "threw"; }
    ok("a body of neither shape throws instead of reporting success", junk, "threw");
    ok("...and nothing was sent", sent.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log("\n10. iOS IS UNTOUCHED");
{
  const swift = read("../TRAQS Scheduling/TRAQS Scheduling/Services/APIService.swift");
  ok("iOS still encodes a bare array", /JSONEncoder\(\)\.encode\(jobs\)/.test(swift), true);
  ok("...and still reads the same reply", /JobsSaveReply\.conflicts\(in: data\)/.test(swift), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
