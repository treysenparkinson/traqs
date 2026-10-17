#!/usr/bin/env node
// Record or replay one golden scenario file.
//
//   node scripts/golden/replay.mjs record scripts/golden/scenarios/people.mjs
//   node scripts/golden/replay.mjs check  scripts/golden/scenarios/people.mjs [--backend mem|pg]
//
// record writes fixtures/golden/<area>.json from the current code on the in-memory S3 store.
// check re-runs every scenario on the chosen backend and compares status, headers, body, side
// effects and the store's end state with the recording. One process per file, so module-level
// state (rate limiters, caches) is the same on record and on check.

import { runScenario, canon } from "./runner.mjs";
import { createMemStore } from "./mem-store.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [mode, file, ...rest] = process.argv.slice(2);
const backend = (rest.join(" ").match(/--backend[ =](\w+)/) || [])[1] || "mem";
if (!["record", "check"].includes(mode) || !file) { console.error("usage: replay.mjs record|check <scenarios.mjs> [--backend mem|pg]"); process.exit(2); }

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const area = path.basename(file, ".mjs");
const goldenPath = path.join(ROOT, "fixtures", "golden", `${area}.json`);
const scenarios = (await import(pathToFileURL(path.resolve(ROOT, file)).href)).default;

let makeStore = async (seed) => createMemStore(seed);
let closeStores = async () => {};
if (backend === "pg") ({ makePgStore: makeStore, closePgStores: closeStores } = await import("./pg-store.mjs"));

const names = new Set();
for (const sc of scenarios) { if (names.has(sc.name)) { console.error(`duplicate scenario name: ${sc.name}`); process.exit(2); } names.add(sc.name); }

if (mode === "record") {
  const out = [];
  for (const sc of scenarios) out.push(await runScenario(sc, { makeStore }));
  mkdirSync(path.dirname(goldenPath), { recursive: true });
  writeFileSync(goldenPath, JSON.stringify({ area, recordedAt: "frozen", scenarios: out }, null, 1) + "\n");
  console.log(`recorded ${out.length} scenarios -> ${path.relative(ROOT, goldenPath)}`);
  await closeStores();
  process.exit(0);
}

if (!existsSync(goldenPath)) { console.error(`no golden for ${area}: run record first`); process.exit(2); }
const golden = new Map(JSON.parse(readFileSync(goldenPath, "utf8")).scenarios.map((s) => [s.name, s]));
let pass = 0, fail = 0;
const firstDiff = (a, b, at = "$") => {
  if (canon(a) === canon(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[key], b[key], `${at}.${key}`); if (d) return d; }
  }
  return `${at}: recorded ${JSON.stringify(a)?.slice(0, 300)} | now ${JSON.stringify(b)?.slice(0, 300)}`;
};
for (const sc of scenarios) {
  const want = golden.get(sc.name);
  if (!want) { fail++; console.log(`  FAIL  [${backend}] ${area} / ${sc.name}: not recorded`); continue; }
  const got = await runScenario(sc, { makeStore });
  // sc.unorderedPaths: arrays whose order the HANDLER doesn't fix (e.g. Promise.all completion
  // order, #569) — nondeterministic on S3 as well, so they're compared as sets. Each use names why.
  for (const p of sc.unorderedPaths || []) for (const doc of [want, got]) {
    const parts = p.split("."); const last = parts.pop();
    const parent = parts.reduce((o, k) => (o == null ? o : o[k]), doc);
    if (parent && Array.isArray(parent[last])) parent[last] = [...parent[last]].sort((x, y) => (canon(x) < canon(y) ? -1 : canon(x) > canon(y) ? 1 : 0));
  }
  const d = firstDiff(want, got);
  if (d) { fail++; console.log(`  FAIL  [${backend}] ${area} / ${sc.name}\n        ${d}`); }
  else { pass++; console.log(`  PASS  [${backend}] ${area} / ${sc.name}`); }
}
for (const name of golden.keys()) if (!names.has(name)) { fail++; console.log(`  FAIL  [${backend}] ${area} / ${name}: recorded but no longer a scenario`); }
console.log(`${area}: ${pass} passed, ${fail} failed`);
await closeStores();
process.exit(fail ? 1 : pass ? 0 : 2);
