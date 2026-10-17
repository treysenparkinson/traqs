// The Postgres store keeps the s3.js contract (Postgres migration plan, step 5).
//
// The same cases run against the in-memory S3 stand-in the goldens were recorded on, and against
// the REAL `_utils/s3.js` with STORAGE_BACKEND=postgres (so the routing is tested too): missing
// keys, versions as ETags, conditional writes (stale / create-if-missing), a real parallel race
// under updateJson, binaries, listing, copy/delete. Postgres-only: the actor lands in change_log,
// and local dev refuses a non-local database.

import { openTestDb } from "./db/test-db.mjs";
import { createMemStore } from "./golden/mem-store.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const throwsCode = async (fn) => { try { await fn(); return "no error"; } catch (e) { return e?.preconditionFailed ? "precondition" : e?.name || "error"; } };

async function contract(name, s, updateJson) {
  console.log(`store contract: ${name}`);
  const K = "orgs/TESTORG/clients.json";
  ok(`${name}: a missing key reads null`, await s.readJson(K), null);
  ok(`${name}: ...with a null version`, await s.readJsonVersioned(K), { data: null, etag: null });
  await s.writeJson(K, [{ id: "c1", name: "A" }]);
  ok(`${name}: written then read`, await s.readJson(K), [{ id: "c1", name: "A" }]);
  const v1 = (await s.readJsonVersioned(K)).etag;
  ok(`${name}: a stored key has a version`, typeof v1 === "string" && v1.length > 0);
  await s.writeJson(K, [{ id: "c1", name: "B" }]);
  const v2 = (await s.readJsonVersioned(K)).etag;
  ok(`${name}: every write moves the version`, v1 !== v2);
  ok(`${name}: a write on a stale version is refused`, await throwsCode(() => s.writeJsonIfMatch(K, [{ id: "c1", name: "X" }], v1)), "precondition");
  ok(`${name}: ...and changes nothing`, await s.readJson(K), [{ id: "c1", name: "B" }]);
  await s.writeJsonIfMatch(K, [{ id: "c1", name: "C" }], v2);
  ok(`${name}: a write on the current version lands`, await s.readJson(K), [{ id: "c1", name: "C" }]);
  ok(`${name}: create-if-missing on an existing key is refused`, await throwsCode(() => s.writeJsonIfMatch(K, [], null)), "precondition");
  const N = "orgs/TESTORG/groups.json";
  await s.writeJsonIfMatch(N, [{ id: "g1", name: "G", memberIds: [1, "7"] }], null);
  ok(`${name}: create-if-missing on a new key lands, id types kept`, await s.readJson(N), [{ id: "g1", name: "G", memberIds: [1, "7"] }]);
  await s.writeJson("orgs/TESTORG/tasks.json", []);
  ok(`${name}: an empty array is stored, not absent`, await s.readJsonVersioned("orgs/TESTORG/tasks.json").then((r) => [r.data, r.etag !== null]), [[], true]);

  // updateJson's retry loop with writers really in flight together
  if (updateJson) {
    const P = "orgs/TESTORG/payhours.json";
    await s.writeJson(P, []);
    const adds = Array.from({ length: 8 }, (_, i) => updateJson(P, (cur) => ({ value: [...(cur || []), { id: `tc_${i}`, personId: "7", hours: i }] }), { attempts: 20 }));
    await Promise.all(adds);
    const ids = (await s.readJson(P)).map((r) => r.id).sort();
    ok(`${name}: 8 concurrent updateJson writers all land (none lost)`, ids, Array.from({ length: 8 }, (_, i) => `tc_${i}`).sort());
  }

  await s.writeBinary("orgs/TESTORG/attachments/AbCdEfGhI-a.pdf", Buffer.from("%PDF test"), "application/pdf");
  const b = await s.readBinaryWithMeta("orgs/TESTORG/attachments/AbCdEfGhI-a.pdf");
  ok(`${name}: a binary comes back with its type`, [b.data.toString(), b.contentType], ["%PDF test", "application/pdf"]);
  let missing; try { await s.readBinaryWithMeta("orgs/TESTORG/attachments/none.pdf"); } catch (e) { missing = [e.name, e.$metadata?.httpStatusCode]; }
  ok(`${name}: a missing binary throws NoSuchKey/404, as GetObject does`, missing, ["NoSuchKey", 404]);
  await s.writeJson("orgs/MAT.CEPE.3A96/config.json", { name: "M" });
  await s.writeJson("orgs/_index/code/MAT.CEPE.3A96.json", { orgCode: "MAT.CEPE.3A96", auth0OrgId: null });
  ok(`${name}: listOrgCodes lists every org prefix, _index included (as S3's delimiter listing does)`, (await s.listOrgCodes()).sort(), ["MAT.CEPE.3A96", "TESTORG", "_index"]);
  await s.copyObject(K, "orgs/TESTORG/clients-copy.json");
  ok(`${name}: copyObject`, await s.readJson("orgs/TESTORG/clients-copy.json"), [{ id: "c1", name: "C" }]);
  await s.deleteObject("orgs/TESTORG/clients-copy.json");
  ok(`${name}: deleteObject`, await s.readJsonVersioned("orgs/TESTORG/clients-copy.json"), { data: null, etag: null });
  await s.deleteObject("orgs/TESTORG/clients-copy.json");
  ok(`${name}: deleting a missing key is a no-op`, true);
}

// ── in memory (the goldens' store) ─────────────────────────────────────────
const mem = createMemStore({});
const memUpdate = async (key, mutate, { attempts = 5 } = {}) => {
  for (let i = 0; i < attempts; i++) {
    const { data, etag } = await mem.readJsonVersioned(key);
    const out = mutate(data);
    try { await mem.writeJsonIfMatch(key, out.value, etag); return out; } catch (e) { if (!e.preconditionFailed) throw e; }
  }
  throw new Error("contention");
};
await contract("mem", mem, memUpdate);

// ── Postgres, through the real s3.js ───────────────────────────────────────
const db = await openTestDb();
try {
  process.env.STORAGE_BACKEND = "postgres";
  process.env.TRAQS_DATABASE_URL = db.url;
  process.env.STORAGE_BINARIES = "postgres";
  const s3 = await import("../netlify/functions/_utils/s3.js");
  const { updateJson } = await import("../netlify/functions/_utils/update-json.js");
  const { setActor } = await import("../netlify/functions/_utils/store/select.js");
  await contract("postgres via s3.js", s3, updateJson);

  console.log("store contract: postgres only");
  await new Promise((resolve) => setImmediate(async () => {
    setActor({ personId: "7", email: "wendy@testpanels.example", source: "timeclock:POST" });
    await s3.writeJson("orgs/TESTORG/clients.json", [{ id: "c1", name: "D" }]);
    resolve();
  }));
  const log = (await db.client.query("select actor_person_id, actor_email, source from change_log where table_name = 'clients' and op = 'U' order by id desc limit 1")).rows[0];
  ok("the request's actor is recorded with the change", [log?.actor_person_id, log?.actor_email, log?.source], ["7", "wendy@testpanels.example", "timeclock:POST"]);
  const rows = (await db.client.query("select count(*)::int n from change_log where table_name = 'clients'")).rows[0].n;
  ok("rewriting clients.json logs only real changes (insert, then one update per edit)", rows, 4);
} finally {
  const { __closePgStoreForTests } = await import("../netlify/functions/_utils/store/select.js");
  await __closePgStoreForTests();
  await db.close();
}

// local dev refuses a database that isn't local (the #454 rule applied to Postgres)
{
  const { pgStore, __setPgStoreForTests } = await import("../netlify/functions/_utils/store/select.js");
  __setPgStoreForTests(null);
  process.env.NETLIFY_DEV = "true";
  process.env.TRAQS_DATABASE_URL = "postgres://u:p@prod-db.example.amazonaws.com:5432/traqs";
  let refused; try { pgStore(); } catch (e) { refused = e.name; }
  ok("local dev refuses a non-local TRAQS_DATABASE_URL", refused, "LocalDevWriteRefused");
  delete process.env.NETLIFY_DEV;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : pass ? 0 : 2);
