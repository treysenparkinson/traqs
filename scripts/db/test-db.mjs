// A fresh, fully migrated database for one suite.
//
// Under `npm run build`, scripts/db/with-pg.mjs has already started ONE cluster and built a
// migrated template database; it passes both through the environment, and each suite clones the
// template (CREATE DATABASE ... TEMPLATE is a file copy, far cheaper than re-running migrations).
// Run on its own (`node scripts/x-test.mjs`), a suite starts and stops its own cluster.
//
//   const db = await openTestDb();   // { client, url, close }
//   ... db.client.query(...)
//   await db.close();

import pg from "pg";
import { startCluster } from "./pg-cluster.mjs";
import { migrate } from "../../db/migrate.mjs";

export const TEMPLATE_DB = "traqs_template";

export async function buildTemplate(cluster) {
  const admin = await cluster.client("postgres");
  await admin.query(`drop database if exists ${TEMPLATE_DB}`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();
  const c = await cluster.client(TEMPLATE_DB);
  try { await migrate(c); } finally { await c.end(); }
}

const nameFor = () => `t_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export async function openTestDb() {
  let cluster = null;
  let base = process.env.TRAQS_TEST_PG_URL;           // postgres://.../postgres
  if (!base) {
    cluster = await startCluster();
    await buildTemplate(cluster);
    base = cluster.url;
  }
  const name = nameFor();
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  // A template can't be cloned while another session is connected to it; suites run in
  // parallel, so retry briefly rather than fail on that race.
  for (let i = 0; ; i++) {
    try { await admin.query(`create database ${name} template ${TEMPLATE_DB}`); break; }
    catch (e) { if (i >= 40 || !/being accessed by other users/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 100)); }
  }
  const url = base.replace(/\/[^/]*$/, `/${name}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return {
    client, url, name,
    async close() {
      await client.end().catch(() => {});
      await admin.query(`drop database if exists ${name} with (force)`).catch(() => {});
      await admin.end().catch(() => {});
      if (cluster) await cluster.stop();
    },
  };
}
