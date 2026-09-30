#!/usr/bin/env node
// What migrating each NATIVE live-hours site onto the shared helper changes.
//
// Neither native toolchain exists on the machine this was written on (no Swift,
// no JDK), so the Swift and Kotlin cannot be compiled or run here. This is the
// substitute and its limits should be read before its output is trusted: each
// variant below is a hand transcription of the native source, so it proves the
// LOGIC of a migration and not that the native code compiles. A transcription
// error is invisible to it. Every entry cites file:line and keeps the original
// expression adjacent so the transcription can be checked by eye.
//
// It exists because the native variants have had less scrutiny than the web
// ones, and on web the grid — not review — is what surfaced the 56-year bug and
// the NaN case.
//
// Run: node scripts/live-hours-native-grid.mjs

import { liveElapsedHours } from "../src/statsMath.js";

const H = 3600000;
const NOW = Date.parse("2026-09-18T15:00:00Z");
const at = (hoursAgo) => new Date(NOW - hoursAgo * H).toISOString();

// Both native parsers return an optional/nullable and the call sites bail on
// nil, and `clockIn` is a non-optional String on iOS and Kotlin alike. So the
// epoch-for-null hole that JS has cannot arise there — modelled faithfully.
const parseNative = (s) => {
  if (typeof s !== "string" || s === "") return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
};

// Every native live-hours site now routes through one helper per platform, so
// each platform is a single variant. The call sites are listed so the grid
// still names every place a divergence would reach.
const variants = [
  {
    id: "iOS HoursCalculator.swift:51  (shared helper)\n" +
        "    callers: AppState.swift:3255/3299, AppState+JobsProgress.swift:51,\n" +
        "             MoreView.swift:570/723/1214, TasksView.swift:1343",
    kind: "helper",
    // guard let started = Date.fromFlexibleISO8601(clockIn) else { return 0 }
    // var ms = now.timeIntervalSince(started) * 1000 - (totalPausedMs ?? 0)
    // if let pa = pausedAt, let pausedSince = ... {
    //     ms -= max(0, now.timeIntervalSince(pausedSince) * 1000) }
    // return max(0, ms) / 3_600_000
    fn: ({ clockIn, pausedAt, totalPausedMs = 0, now }) => {
      const started = parseNative(clockIn);
      if (started === null) return 0;
      let ms = now - started - (totalPausedMs || 0);
      const ps = pausedAt ? parseNative(pausedAt) : null;
      if (ps !== null) ms -= Math.max(0, now - ps);
      return Math.max(0, ms) / H;
    },
  },
  {
    id: "Android HoursCalculator.kt:35  (shared helper)\n" +
        "    callers: AppState.kt:621, TimeClockScreen.kt:141/408, JobsScreen.kt:1259",
    kind: "helper",
    // val started = parseFlexibleISO(clockIn) ?: return 0.0
    // var ms = (now - started).toDouble() - (totalPausedMs ?: 0.0)
    // val pausedSince = parseFlexibleISO(pausedAt)
    // if (pausedSince != null) ms -= maxOf(0.0, (now - pausedSince).toDouble())
    // return maxOf(0.0, ms) / 3_600_000.0
    fn: ({ clockIn, pausedAt, totalPausedMs = 0, now }) => {
      const started = parseNative(clockIn);
      if (started === null) return 0;
      let ms = now - started - (totalPausedMs || 0);
      const ps = pausedAt ? parseNative(pausedAt) : null;
      if (ps !== null) ms -= Math.max(0, now - ps);
      return Math.max(0, ms) / H;
    },
  },
];

const cases = [
  { name: "plain elapsed",              args: { clockIn: at(2), now: NOW } },
  { name: "closed pause",               args: { clockIn: at(2), totalPausedMs: 0.5 * H, now: NOW } },
  { name: "OPEN pause (lunch)",         args: { clockIn: at(2), pausedAt: at(0.5), now: NOW } },
  { name: "closed + open pause",        args: { clockIn: at(3), totalPausedMs: 0.5 * H, pausedAt: at(0.5), now: NOW } },
  { name: "FUTURE pausedAt (skew)",     args: { clockIn: at(2), pausedAt: at(-0.5), now: NOW } },
  { name: "pause exceeds elapsed",      args: { clockIn: at(1), totalPausedMs: 5 * H, now: NOW } },
  { name: "unparseable pausedAt",       args: { clockIn: at(2), pausedAt: "garbage", now: NOW } },
  { name: "empty clockIn",              args: { clockIn: "", now: NOW } },
];

const near = (a, b) => Math.abs(a - b) < 1e-9;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(4) : String(n));

console.log("\nMigration impact per native variant — helper value vs current value");
console.log("(transcribed from native source; proves logic, NOT that it compiles)\n");

let totalChanges = 0;
for (const v of variants) {
  const changes = [];
  for (const c of cases) {
    const mine = liveElapsedHours(c.args);
    const theirs = v.fn(c.args);
    if (!near(mine, theirs)) changes.push(`${c.name}: ${fmt(theirs)} -> ${fmt(mine)}`);
  }
  totalChanges += changes.length;
  console.log(`${v.id}  [variant ${v.kind}]`);
  if (changes.length === 0) console.log("    no behaviour change");
  else for (const ch of changes) console.log(`    ${ch}`);
  console.log("");
}

// The web helper grew a falsy-clockIn guard because `new Date(null)` is the
// epoch. Neither native platform can reach that state: `clockIn` is a
// non-optional String and both parsers return nil for unparseable input, so the
// guard is a JS-specific fix and porting it would be cargo cult.
const nativeNullSafe = variants.every(v => near(v.fn({ clockIn: "", now: NOW }), 0));
console.log(`null/empty clockIn safe on native without an added guard: ${nativeNullSafe ? "yes" : "NO"}`);
console.log(`\n${totalChanges} behaviour change(s) across ${variants.length} native variants`);
process.exit(totalChanges === 0 && nativeNullSafe ? 0 : 1);
