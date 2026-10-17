#!/usr/bin/env node
// Runs a command with one throwaway Postgres for its whole lifetime.
//
//   node scripts/db/with-pg.mjs node scripts/run-suites.mjs
//
// Starts a cluster, builds the migrated template database (scripts/db/test-db.mjs), exports
// TRAQS_TEST_PG_URL for the child, runs it, and always stops the cluster afterwards. The exit
// code is the child's. This is what puts a real database inside `npm run build` (plan step 1).

import { spawn } from "node:child_process";
import { startCluster } from "./pg-cluster.mjs";
import { buildTemplate } from "./test-db.mjs";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) { console.error("usage: node scripts/db/with-pg.mjs <command> [args...]"); process.exit(2); }

const t0 = Date.now();
let cluster;
try {
  cluster = await startCluster();
  await buildTemplate(cluster);
} catch (e) {
  console.error(`with-pg: ${e.message}`);
  if (cluster) await cluster.stop().catch(() => {});
  process.exit(2);
}
console.log(`with-pg: Postgres 17 on :${cluster.port}, template migrated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const child = spawn(cmd === "node" ? process.execPath : cmd, args, { stdio: "inherit", env: { ...process.env, TRAQS_TEST_PG_URL: cluster.url } });
const code = await new Promise((resolve) => {
  child.on("close", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
  child.on("error", () => resolve(1));
});
await cluster.stop().catch((e) => console.error(`with-pg: stop failed: ${e.message}`));
process.exit(code);
