// Today's behaviour, pinned (Postgres migration plan, step 2).
//
// Replays every golden scenario file (scripts/golden/scenarios/*.mjs, recorded in
// fixtures/golden/*.json) against the REAL handlers: status, headers, body, side effects and the
// store's end state must match the recording exactly. Each file runs in its own process (module
// state such as rate limiters is per process, as it was when recorded), files in parallel.
//
// GOLDEN_BACKENDS=mem,pg runs each file against both stores; the default is the in-memory S3
// stand-in until the Postgres store exists (step 5), then both.
//
// Re-record a file ON PURPOSE when behaviour is meant to change:
//   node scripts/golden/replay.mjs record scripts/golden/scenarios/<area>.mjs

import { spawn } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(new URL("./golden/scenarios/", import.meta.url)).filter((f) => f.endsWith(".mjs")).sort();
const pgStore = existsSync(new URL("./golden/pg-store.mjs", import.meta.url));
const backends = (process.env.GOLDEN_BACKENDS || (pgStore ? "mem,pg" : "mem")).split(",").map((s) => s.trim()).filter(Boolean);

const run = (file, backend) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["scripts/golden/replay.mjs", "check", `scripts/golden/scenarios/${file}`, "--backend", backend], { cwd: ROOT });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("close", (code) => resolve({ file, backend, code, out }));
});

console.log(`golden: ${files.length} scenario files x ${backends.join(" + ")}`);
const results = await Promise.all(files.flatMap((f) => backends.map((b) => run(f, b))));
let failed = 0, scenarios = 0;
for (const r of results) {
  const passLines = (r.out.match(/^\s+PASS\s/gm) || []).length;
  scenarios += passLines;
  if (r.code !== 0) { failed++; console.log(r.out.split("\n").filter((l) => !/^\s+PASS\s/.test(l)).join("\n")); }
  else console.log(`  PASS  [${r.backend}] ${r.file}: ${passLines} scenarios`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed (${scenarios} scenario replays)`);
process.exit(failed ? 1 : results.length ? 0 : 2);
