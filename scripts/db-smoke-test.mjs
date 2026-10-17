// A real Postgres runs inside the build (Postgres migration plan, step 1).
//
// Proves the plumbing every DB suite stands on: a cluster is reachable, the template database
// carries every migration in db/migrations/, a clone is independent of other clones, and the
// runner is idempotent. Under `npm run build` the cluster comes from scripts/db/with-pg.mjs;
// run alone, this suite starts its own.

import { openTestDb } from "./db/test-db.mjs";
import { migrate, migrationFiles } from "../db/migrate.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

console.log("db-smoke: a real Postgres, migrated, one database per suite");
const a = await openTestDb();
const b = await openTestDb();
try {
  const v = (await a.client.query("show server_version")).rows[0].server_version;
  ok(`server is Postgres 17 (${v})`, /^17\./.test(v));
  ok("select 1", (await a.client.query("select 1 as one")).rows[0].one, 1);
  const applied = (await a.client.query("select name from schema_migrations order by name")).rows.map((r) => r.name);
  ok("every migration file is applied to the clone", applied, migrationFiles());
  ok("citext is installed", (await a.client.query("select count(*)::int as n from pg_extension where extname = 'citext'")).rows[0].n, 1);
  ok("running the migrations again applies nothing", await migrate(a.client), []);
  await a.client.query("create table only_in_a (x int)");
  const inB = (await b.client.query("select to_regclass('only_in_a') is not null as present")).rows[0].present;
  ok("two suites' databases are independent", inB, false);
} finally {
  await a.close();
  await b.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : pass ? 0 : 2);
