#!/usr/bin/env node
// Proves `liveElapsedHours` against the three variants it replaces.
//
// The migration's whole claim is "variant A sites are unchanged, B and C are
// fixed". That claim is only checkable if the old shapes are written down, so
// they are reproduced here verbatim from the call sites they came from and the
// helper is diffed against each across a grid of inputs.
//
//   A  liveOpHours (TRAQS.jsx)          — open pause subtracted, FLOORED
//   B  payProdByDay / End Job / job timer — open pause subtracted, UNFLOORED
//   C  current-work card / op-progress   — no open-pause term at all
//
// `now` is passed explicitly everywhere: a future `pausedAt` and a frozen
// session are the two cases worth testing and both are races against Date.now().
//
// Run: node scripts/live-hours-test.mjs

import { liveElapsedHours } from "../src/statsMath.js";

const H = 3600000;
const NOW = Date.parse("2026-09-18T15:00:00Z");
const at = (hoursAgo) => new Date(NOW - hoursAgo * H).toISOString();

// ── the three legacy shapes, as they were written ────────────────────────────
const variantA = ({ clockIn, pausedAt, totalPausedMs = 0, now }) => {
  const started = new Date(clockIn).getTime();
  if (!Number.isFinite(started)) return 0;
  let h = (now - started) / H - (totalPausedMs || 0) / H;
  if (pausedAt) {
    const p = new Date(pausedAt).getTime();
    if (Number.isFinite(p)) h -= Math.max(0, (now - p) / H);
  }
  return Math.max(0, h);
};
const variantB = ({ clockIn, pausedAt, totalPausedMs = 0, now }) => {
  const started = new Date(clockIn).getTime();
  if (!Number.isFinite(started)) return 0;
  let ms = now - started - (totalPausedMs || 0);
  if (pausedAt) ms -= now - new Date(pausedAt).getTime();
  return Math.max(0, ms) / H;
};
const variantC = ({ clockIn, totalPausedMs = 0, now }) => {
  const started = new Date(clockIn).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, (now - started) / H - (totalPausedMs || 0) / H);
};

// ── cases ────────────────────────────────────────────────────────────────────
const cases = [
  { name: "plain elapsed, no pause",        args: { clockIn: at(2), now: NOW },                                          expect: 2 },
  { name: "closed pause subtracted",        args: { clockIn: at(2), totalPausedMs: 0.5 * H, now: NOW },                  expect: 1.5 },
  { name: "OPEN pause subtracted",          args: { clockIn: at(2), pausedAt: at(0.5), now: NOW },                       expect: 1.5 },
  { name: "closed + open pause",            args: { clockIn: at(3), totalPausedMs: 0.5 * H, pausedAt: at(0.5), now: NOW }, expect: 2 },
  { name: "FUTURE pausedAt adds nothing",   args: { clockIn: at(2), pausedAt: at(-0.5), now: NOW },                      expect: 2 },
  { name: "pause exceeding elapsed floors", args: { clockIn: at(1), totalPausedMs: 5 * H, now: NOW },                    expect: 0 },
  { name: "invalid clockIn",                args: { clockIn: "not-a-date", now: NOW },                                   expect: 0 },
  { name: "missing clockIn",                args: { clockIn: null, now: NOW },                                           expect: 0 },
  { name: "Date object accepted",           args: { clockIn: new Date(NOW - 2 * H), now: NOW },                          expect: 2 },
  { name: "invalid pausedAt ignored",       args: { clockIn: at(2), pausedAt: "garbage", now: NOW },                     expect: 2 },
  // Commit 1 accepts frozenAtMs and ignores it; commit 2 makes it freeze.
  { name: "frozenAtMs ignored (commit 1)",  args: { clockIn: at(2), frozenAtMs: NOW - 1 * H, now: NOW },                  expect: 2 },
];

let failures = 0;
const near = (a, b) => Math.abs(a - b) < 1e-9;

console.log("\nvalues");
for (const c of cases) {
  const got = liveElapsedHours(c.args);
  const ok = near(got, c.expect);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${c.name.padEnd(34)} expected ${c.expect}  got ${got}`);
}

// ── variant diffs: the migration's actual claim ──────────────────────────────
// A must agree everywhere. B must differ ONLY on a future pausedAt. C must
// differ ONLY when a pause is open. Any other divergence is an unintended
// behaviour change and the migration is not safe to land.
console.log("\nvariant agreement");
const grid = cases.filter(c => c.args.clockIn && c.args.clockIn !== "not-a-date");
// B differs on TWO counts, not one: the missing floor (future pausedAt) and the
// missing validity check — `now - NaN` is NaN, so an unparseable pausedAt makes
// every B site render NaN rather than degrade to the unpaused value.
const expectDiffer = {
  A: [],
  B: ["FUTURE pausedAt adds nothing", "invalid pausedAt ignored"],
  C: ["OPEN pause subtracted", "closed + open pause"],
};

for (const [label, legacy] of [["A", variantA], ["B", variantB], ["C", variantC]]) {
  for (const c of grid) {
    const mine = liveElapsedHours(c.args);
    const theirs = legacy(c.args);
    const differs = !near(mine, theirs);
    const shouldDiffer = expectDiffer[label].includes(c.name);
    if (differs !== shouldDiffer) {
      failures++;
      console.log(`  FAIL ${label} ${c.name.padEnd(34)} ${differs ? "differs but should match" : "matches but should differ"} (${theirs} vs ${mine})`);
    }
  }
  console.log(`  ok   ${label}: ${expectDiffer[label].length === 0 ? "identical everywhere" : `differs only on ${expectDiffer[label].length} intended case(s)`}`);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
