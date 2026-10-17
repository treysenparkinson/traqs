// The golden harness's in-place reset is a fresh clone in all but cost (scripts/golden/pg-store.mjs).
//
// golden-test replays ~350 scenarios on Postgres. Each used to get a new clone of the template,
// seeded through the store; now one database per process is reset between scenarios from
// snapshots. If the reset missed anything (a table, a sequence, the audit log, store_versions),
// state would leak from one scenario into the next and the goldens would be checking something
// else. This compares the reset database with a fresh clone seeded the old way, every table and
// sequence in `public`, row for row (only server-clock columns are left out), after a scenario
// has scribbled on it.

delete process.env.GOLDEN_PG_FRESH;
const { makePgStore, closePgStores, __goldenDbForTests } = await import("./golden/pg-store.mjs");
const { createPgStore } = await import("../netlify/functions/_utils/store/pg.js");
const { orgSeed, ORG } = await import("./golden/fixture-org.mjs");
const { openTestDb } = await import("./db/test-db.mjs");
const pg = (await import("pg")).default;

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
};

// Every table and sequence in public, rows as sorted text. Columns the server stamps with its
// own clock (defaults of now() / clock_timestamp(), and raw_documents.last_written_at) differ
// between any two runs, so they are left out.
async function stateOf(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const clock = new Set((await c.query(`select c.relname || '.' || a.attname as col from pg_attrdef d
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum join pg_class c on c.oid = d.adrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and pg_get_expr(d.adbin, d.adrelid) ~ '(now|clock_timestamp)\\(\\)'`)).rows.map((r) => r.col));
    clock.add("raw_documents.last_written_at");
    const rels = (await c.query(`select c.relname, c.relkind, array_agg(a.attname::text order by a.attnum) filter (where a.attnum > 0 and not a.attisdropped) as cols
      from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relkind in ('r', 'S') group by c.relname, c.relkind order by 1`)).rows;
    const out = {};
    for (const { relname, relkind, cols } of rels) {
      if (relkind === "S") { out[relname] = (await c.query(`select last_value::text, is_called from public."${relname}"`)).rows[0]; continue; }
      const kept = cols.filter((col) => !clock.has(`${relname}.${col}`));
      out[relname] = (await c.query(`select ${kept.map((col) => `"${col}"::text`).join(", ")} from public."${relname}"`)).rows.map((r) => JSON.stringify(r)).sort();
    }
    return out;
  } finally { await c.end(); }
}
const differences = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((t) => JSON.stringify(a[t]) !== JSON.stringify(b[t]));
const rowCount = (s) => Object.values(s).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
const same = (label, want, got) => {
  const d = differences(want, got);
  ok(`${label}: ${Object.keys(want).length} tables and sequences, ${rowCount(want)} rows, identical to a fresh clone`, d.length === 0,
    d.slice(0, 3).map((t) => `${t}: fresh ${JSON.stringify(want[t])?.slice(0, 200)} | reset ${JSON.stringify(got[t])?.slice(0, 200)}`).join("\n        "));
};

// The old way: a fresh clone of the template, seeded through the store.
async function freshState(seed) {
  const db = await openTestDb();
  const pool = new pg.Pool({ connectionString: db.url, max: 3 });
  const store = createPgStore({ pool });
  for (const [key, value] of Object.entries(seed)) {
    if (value && value.__binary) await store.writeBinary(key, Buffer.from(value.__binary, "base64"), value.contentType);
    else await store.writeJson(key, value);
  }
  await pool.end();
  try { return await stateOf(db.url); } finally { await db.close(); }
}

const custom = () => {
  const s = orgSeed();
  s[`orgs/${ORG}/clients.json`].push({ id: "c_new", name: "New Co", color: "#000000" });
  delete s[`orgs/${ORG}/invites.json`];
  s[`orgs/${ORG}/attachments/QqQqQqQqQ-note.txt`] = { __binary: Buffer.from("hello").toString("base64"), contentType: "text/plain" };
  return s;
};

try {
  const [freshDefault, freshCustom] = await Promise.all([freshState(orgSeed()), freshState(custom())]);
  ok("the fixture org fills the tables the comparison reads", rowCount(freshDefault) > 100 && Object.keys(freshDefault).length > 40);

  console.log("golden reset: the default seed");
  let s = await makePgStore(orgSeed());
  const { url } = await __goldenDbForTests();
  same("first scenario (seeded the slow way, then snapshotted)", freshDefault, await stateOf(url));
  const people = await s.readJson(`orgs/${ORG}/people.json`);
  people[0].name = "Scribbled"; people.push({ id: 500, name: "Extra" });
  await s.writeJson(`orgs/${ORG}/people.json`, people);
  await s.writeJson(`orgs/${ORG}/brand-new.json`, { x: 1 });
  await s.deleteObject(`orgs/${ORG}/groups.json`);
  const scribbled = differences(freshDefault, await stateOf(url));
  ok("a scenario's writes show up in the comparison (people, change_log, store_versions, raw_documents)",
    ["people", "change_log", "store_versions", "raw_documents", "chat_groups"].every((t) => scribbled.includes(t)), `differs: ${scribbled.join(", ")}`);
  await s.close();
  s = await makePgStore(orgSeed());
  same("next scenario (restored from the snapshot)", freshDefault, await stateOf(url));
  ok("...and reads the fixture org back", (await s.readJson(`orgs/${ORG}/people.json`))?.[0]?.name === "Ada Admin");
  await s.writeJson(`orgs/${ORG}/tasks.json`, []);
  await s.close();

  console.log("golden reset: a scenario with its own seed");
  s = await makePgStore(custom());
  same("custom seed (migrated state restored, then seeded the slow way)", freshCustom, await stateOf(url));
  await s.close();
  s = await makePgStore(orgSeed());
  same("the default seed again after a custom one", freshDefault, await stateOf(url));

  console.log("golden reset: a scenario's pool");
  await Promise.all([s.close(), s.close()]);
  ok("closing twice resolves both", true);
  let late;
  try { await s.readJson(`orgs/${ORG}/people.json`); late = "went through"; } catch (e) { late = e.message; }
  ok("a call after close is refused, as on an ended pg.Pool", /after calling end/.test(late), late);
} finally {
  await closePgStores();
}
if (process.env.TRAQS_TEST_PG_URL) {
  const admin = new pg.Client({ connectionString: process.env.TRAQS_TEST_PG_URL });
  await admin.connect();
  const left = (await admin.query(`select datname from pg_database where datname = $1`, [`g_${process.pid}`])).rows;
  await admin.end();
  ok("the process's database is dropped at the end", left.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
