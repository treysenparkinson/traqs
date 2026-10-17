// A real Postgres 17 for tests and local dev, from npm (embedded-postgres, plan D1).
//
// startCluster() initialises a cluster in a fresh temp directory on a free port and starts it;
// stop() shuts it down and (unless persistent) removes the directory. Used by
// scripts/db/with-pg.mjs (one cluster for a whole build) and by scripts/db/test-db.mjs when a
// suite runs on its own.

import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

export const PG_USER = "traqs";
export const PG_PASSWORD = "traqs-local-only";

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

export const urlFor = (port, database = "postgres") =>
  `postgres://${PG_USER}:${encodeURIComponent(PG_PASSWORD)}@127.0.0.1:${port}/${database}`;

export async function startCluster({ dir = null, port = null, persistent = false, quiet = true } = {}) {
  const databaseDir = dir || mkdtempSync(path.join(os.tmpdir(), "traqs-pg-"));
  const p = port || (await freePort());
  const logs = [];
  const server = new EmbeddedPostgres({
    databaseDir, port: p, user: PG_USER, password: PG_PASSWORD, persistent,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: (m) => { logs.push(String(m)); if (!quiet) process.stdout.write(String(m)); },
    onError: (m) => { logs.push(String(m)); },
  });
  try {
    if (!dir || !persistent) await server.initialise();
    await server.start();
  } catch (e) {
    e.message = `embedded postgres failed to start: ${e.message}\n${logs.slice(-20).join("")}`;
    throw e;
  }
  return {
    port: p, databaseDir, url: urlFor(p),
    urlFor: (db) => urlFor(p, db),
    async client(database = "postgres") { const c = new pg.Client({ connectionString: urlFor(p, database) }); await c.connect(); return c; },
    stop: () => server.stop(),
  };
}
