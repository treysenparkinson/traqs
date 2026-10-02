// Basic-tier overlap lanes.
//
// Matrix is on Business, so there is no live data behind any of this and no org to measure.
// These are the cases stated as arithmetic instead — which is the whole reason basicLanes was
// lifted out of the IIFE it lived in inside the team render, where nothing could call it.
//
// Every case below is one of the five defects:
//   #119  tails, ghosts and dots stayed full height — lanes were per OP, applied to the head
//   #120  bars with no stored startHour, and days after the first, were excluded entirely
//   #121  lanes measured the STORED hpd
//   #123  ...while the bar is PAINTED at barLengthHours, which grows past the estimate
//   #122  stacking and laning both applied, so Basic was packed AND laned
//
//   node scripts/basic-lanes-test.mjs
import { basicLanes, laneKey } from "../src/basicLanes.js";
import { buildDayWindows } from "../src/statsMath.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// An 08:00-17:00 day with an hour of lunch at noon: 8 productive hours, Matrix's own shape.
const dayWindowCfg = buildDayWindows(8, 17, [], { durationMinutes: 60, time: "12:00" });
const nextDay = (ds) => { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const CFG = { dayWindowCfg, workStartH: 8, workEndH: 17, productiveHoursPerDay: 7.5, nextDay };
const bar = (id, { start = "2026-10-05", startHour = 8, hpd = 2, team = ["p1"], worked = 0, isFullyWorked = false } = {}) =>
  ({ id, type: "task", worked, isFullyWorked, task: { id, start, startHour, hpd, team } });
const lanes = (bars) => basicLanes(bars, CFG);
const at = (m, id, day = "2026-10-05") => m.get(laneKey(id, day)) || null;

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. The basics");
{
  const m = lanes([bar("A"), bar("B", { startHour: 14 })]);
  ok("two bars that do not overlap each take lane 0, full height",
    [at(m, "A"), at(m, "B")], [{ lane: 0, lanesTotal: 1 }, { lane: 0, lanesTotal: 1 }]);
}
{
  const m = lanes([bar("A"), bar("B")]);
  ok("two bars in the same range split the row",
    [at(m, "A"), at(m, "B")], [{ lane: 0, lanesTotal: 2 }, { lane: 1, lanesTotal: 2 }]);
}
{
  const m = lanes([bar("A"), bar("B"), bar("C")]);
  ok("three become three lanes", [at(m, "A").lanesTotal, at(m, "B").lane, at(m, "C").lane], [3, 1, 2]);
}
{
  // A bar alone later in the day must be full height even though the morning was crowded.
  const m = lanes([bar("A"), bar("B"), bar("C", { startHour: 15, hpd: 1 })]);
  ok("lanesTotal is local to where the bar sits, not the whole day",
    [at(m, "A").lanesTotal, at(m, "C")], [2, { lane: 0, lanesTotal: 1 }]);
}
{
  const m = lanes([bar("A", { startHour: 8, hpd: 2 }), bar("B", { startHour: 10, hpd: 2 })]);
  ok("bars that merely touch do not overlap", [at(m, "A"), at(m, "B")],
    [{ lane: 0, lanesTotal: 1 }, { lane: 0, lanesTotal: 1 }]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. #121/#123 — the lane follows the PAINTED length, not the stored estimate");
{
  // A 2h estimate worked for 6h paints ~6h long (barLengthHours adds the overrun). The old
  // version measured 2h, found no collision with a bar at 11:00, gave both lane 0, and the
  // two were painted on top of each other.
  const m = lanes([bar("A", { startHour: 8, hpd: 2, worked: 6 }), bar("B", { startHour: 11, hpd: 2 })]);
  ok("an overrunning bar collides with what follows it", [at(m, "A").lanesTotal, at(m, "B").lane], [2, 1]);
}
{
  // isFullyWorked does NOT shrink a bar back to its estimate — I expected it to and was
  // wrong. barLengthHours drops the overrun from the `ahead` half but `behind` is still
  // max(est, worked)/size, so a finished op that took 6h against a 2h estimate still draws
  // 6h: the DONE bar is a record of what was worked, not of what was planned. So the
  // collision is real and the lane has to hold.
  const m = lanes([bar("A", { startHour: 8, hpd: 2, worked: 6, isFullyWorked: true }), bar("B", { startHour: 11, hpd: 2 })]);
  ok("a FINISHED op still draws its worked length, so the collision stands",
    [at(m, "A").lanesTotal, at(m, "B").lanesTotal], [2, 2]);
}
{
  // What isFullyWorked does change: an op finished UNDER its estimate draws the estimate,
  // not the hours. 1h worked against a 2h estimate is a 2h bar, so a bar at 10:00 clears it.
  const m = lanes([bar("A", { startHour: 8, hpd: 2, worked: 1, isFullyWorked: true }), bar("B", { startHour: 10, hpd: 2 })]);
  ok("...and one finished UNDER estimate draws the estimate, colliding with nothing",
    [at(m, "A"), at(m, "B")], [{ lane: 0, lanesTotal: 1 }, { lane: 0, lanesTotal: 1 }]);
}
{
  // The share is per person: a 12h estimate across 3 people is 4h each, not 12.
  const m = lanes([bar("A", { startHour: 8, hpd: 12, team: ["p1", "p2", "p3"] }), bar("B", { startHour: 13, hpd: 1 })]);
  ok("the length is one person's share of the estimate", [at(m, "A"), at(m, "B")],
    [{ lane: 0, lanesTotal: 1 }, { lane: 0, lanesTotal: 1 }]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. #120 — bars the old version dropped entirely");
{
  // No stored startHour. It is DRAWN from the start of the working day, so that is where it
  // has to be laned; the old filter required startHour != null and excluded it, after which
  // it overlapped everything freely.
  const m = lanes([bar("A", { startHour: null }), bar("B", { startHour: 8 })]);
  ok("a bar with no stored startHour is laned from the start of the day",
    [at(m, "A"), at(m, "B")], [{ lane: 0, lanesTotal: 2 }, { lane: 1, lanesTotal: 2 }]);
}
{
  // A bar with NO estimate is still drawn — barLengthHours falls back to a full productive
  // day — so it has to be laned too. The old filter required (hpd || 0) > 0 and dropped it,
  // which is the other half of #120: an unestimated bar overlapped everything freely.
  const m = lanes([bar("A", { hpd: 0 }), bar("B", { startHour: 10, hpd: 1 })]);
  // Optional chaining on purpose: when this regresses the bar is absent from the map, and a
  // bare .lanesTotal throws — which aborts the run and takes every later assertion with it.
  // A missing lane should read as a clean failure, not as a crash.
  ok("a bar with no estimate is laned at the fallback day length, not skipped",
    [at(m, "A")?.lanesTotal ?? null, at(m, "B")?.lanesTotal ?? null], [2, 2]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. #119 — every day a bar is drawn on, not just its first");
{
  // 12h for one person over an 8-productive-hour day: 8h on day one, 4h on day two. The old
  // version keyed lanes on the op's START day only, so day two's tail, its ghost and its dot
  // were full height and overlapped whatever else was there.
  const m = lanes([bar("A", { start: "2026-10-05", startHour: 8, hpd: 12 })]);
  ok("a multi-day bar is laned on day one", at(m, "A", "2026-10-05"), { lane: 0, lanesTotal: 1 });
  ok("...and on day two", at(m, "A", "2026-10-06"), { lane: 0, lanesTotal: 1 });
  ok("...and not on day three", at(m, "A", "2026-10-07"), null);
}
{
  // The tail on day two must collide with a bar that starts that morning.
  const m = lanes([
    bar("A", { start: "2026-10-05", startHour: 8, hpd: 12 }),
    bar("B", { start: "2026-10-06", startHour: 8, hpd: 2 }),
  ]);
  ok("day one is uncontested", at(m, "A", "2026-10-05"), { lane: 0, lanesTotal: 1 });
  // Which bar gets lane 0 is an ordering detail, not a contract — asserting a specific
  // index here would pin the sort rather than the behaviour. What matters is that the tail
  // and the new bar end up in DIFFERENT lanes, each knowing the row splits in two.
  const d2A = at(m, "A", "2026-10-06"), d2B = at(m, "B", "2026-10-06");
  ok("...and the TAIL shares day two with the new bar",
    [d2A.lanesTotal, d2B.lanesTotal, d2A.lane !== d2B.lane], [2, 2, true]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Lunch, and the shape of the day");
{
  // 11:30 + 1h of work crosses the noon lunch, so it ends at 13:30 — a bar starting at 13:00
  // overlaps it, and one starting at 14:00 does not.
  const m = lanes([bar("A", { startHour: 11.5, hpd: 1 }), bar("B", { startHour: 13, hpd: 1 })]);
  ok("a bar that crosses lunch is measured to where it really ends", at(m, "A").lanesTotal, 2);
  const m2 = lanes([bar("A", { startHour: 11.5, hpd: 1 }), bar("B", { startHour: 14, hpd: 1 })]);
  ok("...and stops colliding past it", [at(m2, "A"), at(m2, "B")],
    [{ lane: 0, lanesTotal: 1 }, { lane: 0, lanesTotal: 1 }]);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. Degenerate input is not a crash");
ok("no bars", basicLanes([], CFG).size, 0);
ok("null bars", basicLanes(null, CFG).size, 0);
ok("no nextDay helper", basicLanes([bar("A")], { ...CFG, nextDay: undefined }).size, 0);
ok("a bar with no task", basicLanes([{ id: "x", type: "task" }], CFG).size, 0);
ok("a non-task bar (PTO) is not laned", basicLanes([{ ...bar("A"), type: "pto" }], CFG).size, 0);
{
  // Deterministic: the same input must always give the same lanes, or a re-render reshuffles
  // bars between rows.
  const a = lanes([bar("A"), bar("B"), bar("C")]);
  const b = lanes([bar("C"), bar("B"), bar("A")]);
  ok("lane assignment does not depend on input order",
    ["A", "B", "C"].map(id => at(a, id).lane), ["A", "B", "C"].map(id => at(b, id).lane));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. The render actually uses it");
// A fixture suite proves the arithmetic; it cannot prove the render calls it. These read
// the source, because the failure they catch is "the function is correct and nothing
// invokes it" — which is exactly what the old IIFE looked like from the outside.
{
  const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const has = (re) => re.test(SRC);
  ok("the team render calls basicLanes", has(/basicOverlapLanes = billingTier === "business" \? null : basicLanes\(/), true);
  ok("...and no IIFE is left computing lanes inline", !has(/basicOverlapLanes = billingTier === "business" \? null : \(\(\) =>/), true);
  // #119 — the head and the tail each look up their OWN day.
  ok("the head lanes by its own segment day", has(/_laneGeom\(firstBarSeg\?\.start/), true);
  ok("the tail lanes by its own segment day", has(/const _tailLane = _laneGeom\(seg\.start\);/), true);
  ok("...and the tail paints at that lane, not full height", has(/top: _tailLane\.top, left: tailX/) && has(/height: _tailLane\.height/), true);
  // #122 — packing is a Business behaviour; Basic must not be packed AND laned.
  ok("single-day packing is tier-gated", has(/if \(billingTier === "business" && \(tMode === "month"/), true);
  // #160 — the Basic bar click was the one edit entry point with no permission check.
  // Anchored to the Basic branch of openJobDetailOrEdit, not grepped loose. `if
  // (!can("editJobs")) return;` appears six times in this file, so a bare search for it
  // passed even with the one that matters deleted — the mutation harness caught that, which
  // is the whole reason it exists.
  {
    const fn = SRC.slice(SRC.indexOf("const openJobDetailOrEdit = (t) => {"),
      SRC.indexOf("const AI_TOOLS"));
    ok("the Basic bar click checks editJobs", /if \(!can\("editJobs"\)\) return;/.test(fn), true);
    ok("...before it opens the editor", fn.indexOf('if (!can("editJobs")) return;') < fn.indexOf("openSimpleEditForJob"), true);
  }
  // #159 — the simple editor refuses a job it cannot describe rather than collapsing it.
  ok("the simple editor refuses a job it cannot describe", has(/const why = simpleEditable\(job\);/) && has(/refuseSimpleEdit\(job, why\)/), true);
  // The load-bearing comment that was wrong is gone.
  // The old comment claimed the lanes measured where a Basic bar paints. The phrase is
  // still in the file ON PURPOSE — the new comment quotes it to say why it was wrong — so
  // asserting its absence tested the wrong thing. What matters is that the refutation is
  // there, and that nothing measures lanes from the stored estimate any more.
  ok("the old claim is quoted and refuted, not left standing", SRC.includes("growth is not a push"), true);
  ok("...and no lane is measured from personShareHours of the stored hpd",
    !SRC.includes("walkProductiveHours(b.task.startHour, personShareHours(b.task.hpd"), true);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
