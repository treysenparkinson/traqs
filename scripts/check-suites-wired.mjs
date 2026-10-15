#!/usr/bin/env node
// Every suite in scripts/ must be run by `npm run build`.
//
// Eleven of them were not. basic-lanes, clock-atomicity, conflict-log, css-dead,
// finish-requests and session-hours are all suites added during this defect campaign — each
// one written, proved by mutation, and then never wired into the build that is supposed to
// run it. invite, orgcode, rekey, signup and tiers predate it and had drifted out the same
// way. A suite nobody runs is the same shape as a log nobody reads and an assertion nothing
// executes: it reports as coverage and is not.
//
// This is the guard for the next one. It is cheap, it is in the build chain itself, and it
// fails loudly with the exact line to paste.
//
//   node scripts/check-suites-wired.mjs

import { readFileSync, readdirSync } from "node:fs";
const ROOT = new URL("../", import.meta.url);

const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
const build = String(pkg.scripts?.build || "");
const wired = new Set([...build.matchAll(/scripts\/([a-zA-Z0-9._-]+\.mjs)/g)].map((m) => m[1]));
// `-itest` TOO, AND THAT OMISSION COST EXACTLY WHAT THIS FILE EXISTS TO PREVENT (#273,
// 2026-10-12). The guard matched `-test.mjs` only, so `timeclock-itest.mjs` — a full
// integration suite running the REAL handler against an in-memory S3 — was invisible to
// it, stayed out of the build, and rotted: it now crashes on its first section, because
// the end-of-day rule (#215) deliberately changed what an evening job session credits and
// nothing re-ran the assertions that encoded the old answer.
//
// A GUARD WITH A NAMING BLIND SPOT IS THE SAME FAILURE IT GUARDS AGAINST, one file along.
// Matched on the shape a suite actually has — `test` before `.mjs`, with or without a
// prefix letter — rather than on one exact suffix.
// WIDENED 2026-10-15 (#273). The line was held at `-test` because timeclock-itest had four
// failures that were one open question: should the shop's scheduled lunch come off a MEASURED
// session on top of its own recorded pauses? #505 (Trey's rule, 2026-10-12) answered it — a
// measured session drops the scheduled windows and subtracts its recorded pauses once — and
// the four pass on that code with their assertions untouched since 2026-10-12. So the suite
// is in the build and this guard sees it.
const suites = readdirSync(new URL("scripts/", ROOT)).filter((f) => /-i?test\.mjs$/.test(f)).sort();

const missing = suites.filter((f) => !wired.has(f));
if (missing.length) {
  console.error(`\n${missing.length} test suite${missing.length === 1 ? " is" : "s are"} not run by \`npm run build\`:\n`);
  for (const m of missing) console.error(`   scripts/${m}`);
  console.error(`\nAdd to the build script, before \`vite build\`:\n`);
  console.error(`   ${missing.map((f) => `node scripts/${f}`).join(" && ")}\n`);
  process.exit(1);
}
// The lint step is the reason this file exists at all: `npx vite build` runs the bundler and
// nothing else, so it skips lint AND every suite above. If the chain ever stops starting with
// lint, the no-undef that catches a scope error stops running too.
if (!/^\s*npm run lint\b/.test(build)) {
  console.error("\n`npm run build` no longer starts with `npm run lint`.");
  console.error("That is the step that catches no-undef — a render-time ReferenceError that");
  console.error("neither the bundler nor any suite here can see. Put it back first in the chain.\n");
  process.exit(1);
}
console.log(`ok    all ${suites.length} suites are wired into npm run build, and it starts with lint`);
