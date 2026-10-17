// Applies db/migrations/NNN_name.sql in order, once each, recorded in schema_migrations.
//
// Plain SQL files and this runner, no ORM (plan C3): the handlers keep their own logic, the
// schema is the contract. Each file runs in its own transaction, so a failing migration leaves
// the database at the previous version rather than half-applied.
//
//   import { migrate } from "./db/migrate.mjs";
//   await migrate(client)          // pg.Client, already connected

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
}

export async function migrate(client, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  await client.query(`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  const applied = [];
  for (const name of migrationFiles(dir)) {
    if (done.has(name)) continue;
    const sql = readFileSync(path.join(dir, name), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      e.message = `migration ${name} failed: ${e.message}`;
      throw e;
    }
    applied.push(name);
    log(`applied ${name}`);
  }
  return applied;
}
