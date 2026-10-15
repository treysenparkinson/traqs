#!/usr/bin/env node
// THE SHRINKING LEFT EDGE, EXECUTED (#274).
//
// #274 listed `shrunkStartH` as untested, and it was: the one suite that named it
// (day-grid-test) matched its first 400 characters as text. It is the function that
// moves a worked bar's left edge as the session runs, it lives inside the component,
// and nothing outside could call it. So this slices `shrunkStartH` and `shrunkEdge`
// out of TRAQS.jsx and runs them on the real `walkProductiveHours`.
//
// What stays a stand-in, and why: `sessionElapsedH` reads the live session and the
// wall clock. It is replaced by plain elapsed time between two instants given here,
// and every case pins `frozenAtMs` so no case reads Date.now().
//
//   node scripts/shrink-edge-test.mjs
import { readFileSync } from "node:fs";
import { walkProductiveHours, buildDayWindows } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const slice = (anchor) => {
  const at = SRC.indexOf(anchor);
  if (at < 0) { console.error(`ABORT  could not find ${anchor} — anchor moved`); process.exit(2); }
  let i = SRC.indexOf("{", SRC.indexOf("=>", at)), depth = 0;
  for (; i < SRC.length; i++) { if (SRC[i] === "{") depth++; else if (SRC[i] === "}" && --depth === 0) break; }
  return SRC.slice(SRC.indexOf("=", at) + 1, i + 1);
};
const constValue = (anchor) => {
  const at = SRC.indexOf(anchor);
  if (at < 0) { console.error(`ABORT  could not find ${anchor}`); process.exit(2); }
  return SRC.slice(SRC.indexOf("=", at) + 1, SRC.indexOf(";", at));
};
const build = (code, deps) => new Function("scope", `with (scope) { return (${code}); }`)(new Proxy(deps, {
  has: (_, k) => typeof k === "string" && k !== "globalThis",
  get: (t, k) => { if (k === Symbol.unscopables) return undefined; if (k in t) return t[k]; if (k in globalThis) return globalThis[k]; throw new Error("missing dep: " + String(k)); },
}));

// 08:00-16:00 with an hour's lunch at noon: 7 productive hours.
const workStartH = 8, workEndH = 16;
const dayWindowCfg = buildDayWindows(workStartH, workEndH, [], { time: "12:00", durationMinutes: 60 });
const sameId = build(constValue("const sameId = (a, b) =>"), {});
const SHRINK_MIN_REMAINDER_H = Number(new Function(`return (${constValue("const SHRINK_MIN_REMAINDER_H =")})`)());
const deps = {
  sameId, workEndH, dayWindowCfg, walkProductiveHours, SHRINK_MIN_REMAINDER_H,
  isFinished: (s) => s === "Finished",
  sessionElapsedH: (_jc, fromMs, toMs) => (toMs - fromMs) / 3600000,
};
const shrunkEdge = build(slice("const shrunkEdge = (op, storedSH, worked) => {"), deps);
const shrunkStartH = build(slice("const shrunkStartH = (jc, op, storedSH) => {"), { ...deps, shrunkEdge });

const T0 = Date.parse("2026-10-12T08:00:00Z");
const jcFor = (opId, workedH) => ({ reservoirOpId: opId, drainCheckpoint: new Date(T0).toISOString(), frozenAtMs: T0 + workedH * 3600000 });
const op = (o = {}) => ({ id: "OP", status: "In Progress", start: "2026-10-12", end: "2026-10-12", endHour: 16, ...o });

console.log("\n1. ONLY THE RESERVOIR BAR MOVES");
ok("another op's bar keeps its stored hour", shrunkStartH(jcFor("OTHER", 2), op(), 8), 8);
ok("no session keeps the stored hour", shrunkStartH(null, op(), 8), 8);
ok("a finished op shows its full scope", shrunkStartH(jcFor("OP", 2), op({ status: "Finished" }), 8), 8);
ok("no drain checkpoint, no shrink", shrunkStartH({ reservoirOpId: "OP", frozenAtMs: T0 + 7200000 }, op(), 8), 8);
ok("ids compare loosely: a numeric reservoir id matches the string op id",
  shrunkStartH(jcFor(5, 2), op({ id: "5" }), 8), 10);

console.log("\n2. THE EDGE FOLLOWS PRODUCTIVE HOURS (#203)");
ok("two worked hours from 08:00 put the edge at 10:00", shrunkStartH(jcFor("OP", 2), op(), 8), 10);
// 08:00 + 4.5 productive hours crosses the noon lunch: 13:30, not the 12:30 that adding worked
// hours to the clock gave. (Exactly 4 lands on 12:00, the instant lunch begins — the same
// point on the productive line as 13:00, so it cannot tell the two rules apart.)
ok("four and a half worked hours across lunch land at 13:30, not 12:30", shrunkStartH(jcFor("OP", 4.5), op(), 8), 13.5);
ok("no worked time leaves the edge where it is", shrunkStartH(jcFor("OP", 0), op(), 8), 8);

console.log("\n3. IT NEVER REACHES THE END");
ok("a single-day op stops five minutes short of its own end hour",
  shrunkStartH(jcFor("OP", 6), op({ endHour: 14 }), 8), 14 - SHRINK_MIN_REMAINDER_H);
ok("a multi-day op stops five minutes short of the working day's end",
  shrunkStartH(jcFor("OP", 20), op({ end: "2026-10-14", endHour: 12 }), 8), workEndH - SHRINK_MIN_REMAINDER_H);
ok("...and never moves left of where it was stored", shrunkEdge(op({ endHour: 9 }), 10, 1), 10);

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
