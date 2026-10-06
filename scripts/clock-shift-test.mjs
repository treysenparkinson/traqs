#!/usr/bin/env node
// Every suite in the build must pass with the clock moved forward.
//
// overlap-test section 7 used MON = "2026-10-05" against tasks.js, which takes "today" from
// the real clock (UTC when the org has no timeZone) and ignores past days. It was green all
// day and went red at 00:00 UTC 2026-10-06, blocking the production deploy behind it. Nothing
// in the files had changed — only the time. A suite can be green because of when it ran, so
// the check is to run it with the clock moved, not only with the files changed.
//
// CONVENTION: a fixture date that must be in the future is obviously in the future — use
// 2099 (2099-10-05 is a Monday). A date that only has to be in the past can stay where it is;
// moving the clock forward keeps it past. The last clock below is in 2098, so any near
// "future" date a suite depends on fails here, today, rather than on the day it arrives.
//
// There is no list of clock-sensitive suites to keep up to date: the suites are read from
// `npm run build` itself, and every one of them is rerun at every clock. A suite that starts
// reading the server's clock tomorrow is covered without anyone remembering to add it.
//
//   node scripts/clock-shift-test.mjs

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SHIM = fileURLToPath(new URL("./clock-shift-shim.mjs", import.meta.url));
const SELF = "scripts/clock-shift-test.mjs";
const DAY = 86400000;
const CLOCKS = [
  ["now + 2 days", new Date(Date.now() + 2 * DAY).toISOString()],
  ["now + 400 days", new Date(Date.now() + 400 * DAY).toISOString()],
  ["2098-06-15", "2098-06-15T12:00:00.000Z"],
];

const build = String(JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")).scripts?.build || "");
const suites = [...build.matchAll(/node (scripts\/[a-zA-Z0-9._-]+\.mjs)/g)].map((m) => m[1]).filter((s) => s !== SELF);
if (suites.length < 10) { console.error(`clock-shift: found only ${suites.length} suites in the build script — the parse is broken`); process.exit(2); }

const run = (args, to) => new Promise((resolve) => {
  const env = { ...process.env, CLOCK_SHIFT_TO: to, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import ${JSON.stringify(SHIM)}`.trim() };
  const child = spawn(process.execPath, args, { cwd: ROOT, env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  child.on("close", (code) => resolve({ code, out }));
});

// Guard the harness: if the shift does not reach a child process, every suite below runs on
// the real clock and this reports a clean pass that proves nothing.
for (const [label, to] of CLOCKS) {
  const { code, out } = await run(["-e", "process.stdout.write(new Date().toISOString().slice(0, 10) + ' ' + Date().slice(11, 15) + ' ' + new Date(Date.now()).getUTCFullYear())"], to);
  const want = `${to.slice(0, 10)} ${to.slice(0, 4)} ${to.slice(0, 4)}`;
  if (code !== 0 || out.trim() !== want) {
    console.error(`clock-shift: the clock did not move in a child process (${label}): got "${out.trim()}", want "${want}"`);
    process.exit(2);
  }
}

const jobs = CLOCKS.flatMap(([label, to]) => suites.map((suite) => ({ label, to, suite })));
const failures = [];
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, Math.floor(availableParallelism() / 2)) }, async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    const { code, out } = await run([job.suite], job.to);
    if (code !== 0) failures.push({ ...job, out });
  }
}));

if (failures.length) {
  console.error(`\n${failures.length} suite run${failures.length === 1 ? "" : "s"} failed with the clock moved forward:\n`);
  for (const f of failures) {
    console.error(`   ${f.suite}  at ${f.label} (${f.to})`);
    const lines = f.out.split("\n").filter((l) => /FAIL|rror/.test(l)).slice(0, 6);
    for (const l of lines.length ? lines : f.out.trim().split("\n").slice(-6)) console.error(`      ${l.trim()}`);
  }
  console.error(`\nThe suite passes on the real clock and fails on a later one, so it depends on when it runs.`);
  console.error(`If a fixture date has to be in the future, make it obviously so: use 2099 (2099-10-05 is a Monday).\n`);
  process.exit(1);
}
console.log(`ok    all ${suites.length} build suites pass at ${CLOCKS.map(([l]) => l).join(", ")}`);
