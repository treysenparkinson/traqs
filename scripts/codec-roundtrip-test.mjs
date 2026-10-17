// Every S3 file shape survives the trip into tables and back (Postgres migration plan, step 4).
//
// Corpus: the fixture org plus every file state the 356 golden scenarios produced — real handler
// output, in every shape the handlers write. For each:
//   1. pure:     encode(decode(x)) deep-equals x, and no realistic file is declined to raw storage;
//   2. database: through the real Postgres store, write x, read it back -> x; then overwrite the
//                seed's version with x (the diff path: updates, inserts and deletes of child rows)
//                and read back -> x again.
// tools/db/verify-snapshot.mjs runs the same checks over the production snapshot.

import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { decodeKey, encodeKey, codecFor } from "../netlify/functions/_utils/store/codecs.js";
import { createPgStore } from "../netlify/functions/_utils/store/pg.js";
import { orgSeed } from "./golden/fixture-org.mjs";
import { openTestDb } from "./db/test-db.mjs";

let pass = 0, fail = 0;
const ok = (label, good, detail = "") => { if (good) pass++; else fail++; if (!good || process.env.VERBOSE) console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n        ${detail}`}`); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().filter((key) => x[key] !== undefined).map((key) => [key, x[key]])) : x));
// EXACT: same keys in the same order, same values, as JSON.stringify sees them. Key order is
// behaviour (handlers compare with JSON.stringify), so semantic equality is not enough.
const firstDiff = (a, b, at = "$") => {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (!Array.isArray(a) && canon(Object.keys(a).sort()) === canon(Object.keys(b).sort()) && Object.keys(a).join() !== Object.keys(b).join())
      return `${at}: key order: want ${Object.keys(a).join(",").slice(0, 150)} | got ${Object.keys(b).join(",").slice(0, 150)}`;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${at}.${k}`); if (d) return d; }
  }
  return `${at}: want ${JSON.stringify(a)?.slice(0, 200)} | got ${JSON.stringify(b)?.slice(0, 200)}`;
};

// ── corpus ─────────────────────────────────────────────────────────────────
const seed = orgSeed();
const corpus = [];             // { label, key, value, base? }
for (const [key, value] of Object.entries(seed)) if (!value?.__binary) corpus.push({ label: `fixture ${key}`, key, value });
const dir = new URL("../fixtures/golden/", import.meta.url);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const g = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
  for (const sc of g.scenarios) for (const [key, value] of Object.entries(sc.store.writes)) {
    if (value?.__binary) continue;
    corpus.push({ label: `${g.area} / ${sc.name} / ${key.split("/").slice(2).join("/")}`, key, value, base: seed[key] });
  }
}
console.log(`codec round-trip: ${corpus.length} file states (${new Set(corpus.map((c) => codecFor(c.key)?.name || "raw")).size} kinds)`);

// ── 1. pure ────────────────────────────────────────────────────────────────
const declined = [];
let raw = 0;
for (const c of corpus) {
  const d = decodeKey(c.key, c.value);
  if (d.raw) { raw++; continue; }
  if (d.declined) { declined.push(`${c.label}: ${d.declined}`); continue; }
  const back = encodeKey(c.key, d.tables);
  const diff = firstDiff(c.value, back);
  ok(`pure ${c.label}`, !diff, diff);
}
// A decline is lossless (the file is kept verbatim in raw_documents), but it means the data isn't
// relational, so each one must be a known, logged defect in the data itself.
const KNOWN_DECLINES = [
  // SCHEDULE_MAP #573: invite accept mints a numeric id that collides with a tombstoned string id.
  /^org \/ invite POST accept: a tombstoned row for the address does not bind \/ people\.json: a person id appears twice$/,
];
const unexpected = declined.filter((d) => !KNOWN_DECLINES.some((re) => re.test(d)));
ok(`no realistic file is declined to raw storage beyond the known #573 (${declined.length} declined)`, unexpected.length === 0 && declined.length === KNOWN_DECLINES.length, [...unexpected, ...(declined.length !== KNOWN_DECLINES.length ? [`expected ${KNOWN_DECLINES.length} known declines, got ${declined.length}`] : [])].slice(0, 5).join("\n        "));
console.log(`  pure: ${corpus.length - raw - declined.length} relational, ${raw} raw by design, ${declined.length} declined`);

// ── 2. through Postgres ────────────────────────────────────────────────────
const db = await openTestDb();
const pool = new pg.Pool({ connectionString: db.url, max: 4 });
const store = createPgStore({ pool });
try {
  let n = 0;
  for (const c of corpus) {
    // fresh: write x, read x
    await store.deleteObject(c.key);
    await store.writeJson(c.key, c.value);
    const back = await store.readJson(c.key);
    const d1 = firstDiff(c.value, back);
    ok(`db fresh ${c.label}`, !d1, d1);
    // diff path: the seed's version first, then x on top
    if (c.base !== undefined) {
      await store.deleteObject(c.key);
      await store.writeJson(c.key, c.base);
      await store.writeJson(c.key, c.value);
      const d2 = firstDiff(c.value, await store.readJson(c.key));
      ok(`db over seed ${c.label}`, !d2, d2);
    }
    n++;
  }
  const { etag } = await store.readJsonVersioned(corpus[0].key);
  ok("a stored key has a version (the ETag)", typeof etag === "string" && etag.length > 0, String(etag));
  ok("a missing key reads null with a null ETag", canon(await store.readJsonVersioned("orgs/TESTORG/nope.json")) === canon({ data: null, etag: null }));
  console.log(`  db: ${n} file states written and read back`);
} finally {
  await pool.end();
  await db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : pass ? 0 : 2);
