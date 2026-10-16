#!/usr/bin/env node
// Runs every suite in scripts/suites.mjs, in parallel, for `npm run build`.
//
// The suites share nothing — clock-shift-test has run them concurrently since
// 2026-10-05 — so the only reason they ran one at a time was the `&&` chain they
// lived in. Each suite's output is held until it finishes and printed in list
// order, so the log reads the same as the chain's did. Unlike the chain, a
// failure does not stop the rest: every failing suite is named at the end, and a
// suite that dies without printing anything still shows up there with its exit code.
//
//   node scripts/run-suites.mjs
//   SUITE_JOBS=1 node scripts/run-suites.mjs      # one at a time, as before

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { SUITES, TIMED } from "./suites.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const JOBS = Math.max(1, Number(process.env.SUITE_JOBS) || availableParallelism());

if (SUITES.length < 10) { console.error(`run-suites: only ${SUITES.length} suites in scripts/suites.mjs — the list is broken`); process.exit(2); }
const strayTimed = TIMED.filter((s) => !SUITES.includes(s));
if (strayTimed.length) { console.error(`run-suites: TIMED lists suites that are not in SUITES, so they never run: ${strayTimed.join(", ")}`); process.exit(2); }

const run = (suite) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [suite], { cwd: ROOT });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("error", (err) => resolve({ suite, code: -1, out: `${out}${err.stack || err}\n`, ms: Date.now() - started }));
  child.on("close", (code, signal) => resolve({ suite, code: code ?? signal, out, ms: Date.now() - started }));
});

const started = Date.now();
const results = new Array(SUITES.length);
let printed = 0;
// Print in list order: a finished suite waits until every suite before it is printed.
const flush = () => {
  while (printed < SUITES.length && results[printed]) process.stdout.write(results[printed++].out);
};
const indices = SUITES.map((_, i) => i);
const parallel = indices.filter((i) => !TIMED.includes(SUITES[i]));
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, parallel.length) }, async () => {
  while (next < parallel.length) {
    const i = parallel[next++];
    results[i] = await run(SUITES[i]);
    flush();
  }
}));
// TIMED suites last, alone: see suites.mjs.
for (const i of indices.filter((i) => TIMED.includes(SUITES[i]))) {
  results[i] = await run(SUITES[i]);
  flush();
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
const failures = results.filter((r) => r.code !== 0);
if (failures.length) {
  console.error(`\n${failures.length} of ${SUITES.length} suites failed (${secs} s):`);
  for (const f of failures) console.error(`   ${f.suite}  (exit ${f.code})`);
  console.error("");
  process.exit(1);
}
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3).map((r) => `${r.suite.replace("scripts/", "")} ${(r.ms / 1000).toFixed(1)} s`);
console.log(`\nok    all ${SUITES.length} suites passed in ${secs} s, ${JOBS} at a time (slowest: ${slowest.join(", ")})`);
