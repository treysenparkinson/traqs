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

const variants = [
  {
    id: "iOS HoursCalculator.swift:45  (the shared helper)",
    kind: "C",
    // guard let started = ... else { return 0 }
    // let elapsedH = now.timeIntervalSince(started) / 3600
    // let pausedH  = (totalPausedMs ?? 0) / 3_600_000
    // return max(0, elapsedH - pausedH)
    fn: ({ clockIn, totalPausedMs = 0, now }) => {
      const started = parseNative(clockIn);
      if (started === null) return 0;
      return Math.max(0, (now - started) / H - (totalPausedMs || 0) / H);
    },
  },
  {
    id: "iOS AppState.swift:3273       (op-progress)",
    kind: "C",
    // let elapsedH = Date().timeIntervalSince(started) / 3600
    // let pausedH  = (jc.totalPausedMs ?? 0) / 3_600_000
    // return acc + max(0, elapsedH - pausedH)
    fn: ({ clockIn, totalPausedMs = 0, now }) => {
      const started = parseNative(clockIn);
      if (started === null) return 0;
      return Math.max(0, (now - started) / H - (totalPausedMs || 0) / H);
    },
  },
  {
    id: "iOS MoreView.swift:571/727/1220, TasksView.swift:1335",
    kind: "B",
    // var ms = now.timeIntervalSince(s) * 1000
    // ms -= (jc.totalPausedMs ?? 0)
    // if let pa = jc.pausedAt, let ps = ... { ms -= now.timeIntervalSince(ps) * 1000 }
    // max(0, ms / 1000 / 3600)
    fn: ({ clockIn, pausedAt, totalPausedMs = 0, now }) => {
      const s = parseNative(clockIn);
      if (s === null) return 0;
      let ms = now - s - (totalPausedMs || 0);
      const ps = pausedAt ? parseNative(pausedAt) : null;
      if (ps !== null) ms -= now - ps;          // unfloored
      return Math.max(0, ms) / H;
    },
  },
  {
    id: "Android TimeClockScreen.kt:142/:410, JobsScreen.kt:1259",
    kind: "B",
    // var ms = (now - start).toDouble(); ms -= jc.totalPausedMs ?: 0.0
    // pausedAt -> parseFlexibleISO(p)?.let { ms -= (now - it).toDouble() }
    // max(0.0, ms / 1000 / 3600)
    fn: ({ clockIn, pausedAt, totalPausedMs = 0, now }) => {
      const s = parseNative(clockIn);
      if (s === null) return 0;
      let ms = now - s - (totalPausedMs || 0);
      const ps = pausedAt ? parseNative(pausedAt) : null;
      if (ps !== null) ms -= now - ps;          // unfloored
      return Math.max(0, ms) / H;
    },
  },
  {
    id: "Android AppState.kt:624       (op-progress)",
    kind: "C",
    // val elapsedH = (System.currentTimeMillis() - started) / 3_600_000.0
    // val pausedH  = (jc.totalPausedMs ?: 0.0) / 3_600_000.0
    // live = maxOf(0.0, elapsedH - pausedH)
    fn: ({ clockIn, totalPausedMs = 0, now }) => {
      const started = parseNative(clockIn);
      if (started === null) return 0;
      return Math.max(0, (now - started) / H - (totalPausedMs || 0) / H);
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
