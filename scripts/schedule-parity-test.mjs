#!/usr/bin/env node
// The schedule rules iOS ports from the web, run by the REAL web code and frozen to a file
// both sides test against.
//
// Swift cannot import the JS, so iOS carries ports: WorkDayClock (buildDayWindows,
// walkProductiveHours, productiveClockHours), WorkCalendar (workCalendar), OverlapRule
// (personShareHours, opDaySegments) and GanttLayout (isAssignedHere, dayViewBlocks). Until
// this file the only thing holding each port to its source was a comment saying "a change to
// either side must land on both", plus fixtures copied by hand — and a second implementation
// that drifts is the shape behind most of this campaign's defects (SCHEDULE_MAP root causes
// 5 and 6, iOS chunk A).
//
// So the expected values are not written by anyone. This script computes them from
// src/statsMath.js and src/scheduleRules.js and compares them with the committed
// fixtures/schedule-parity.json:
//   - the JS drifts  → this suite fails here, in `npm run build`;
//   - the Swift drifts → ScheduleParityTests (TRAQS SchedulingTests) fails on the same file.
// A deliberate rule change regenerates the file with --write, and the Swift suite then fails
// until the port follows. Neither side can move alone.
//
//   node scripts/schedule-parity-test.mjs          check
//   node scripts/schedule-parity-test.mjs --write  regenerate after a deliberate change
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildDayWindows, walkProductiveHours, productiveClockHours, personShareHours,
  opDaySegments, dayViewBlocks, isAssignedHere } from "../src/statsMath.js";
import { workCalendar } from "../src/scheduleRules.js";

const FILE = new URL("../fixtures/schedule-parity.json", import.meta.url);
const WRITE = process.argv.includes("--write");

// ── Orgs: Matrix's own shape, the org defaults, and the edges buildDayWindows exists for ──
const ORGS = [
  { name: "matrix", workStart: "08:00", workEnd: "17:00", workDays: [1, 2, 3, 4, 5], holidays: [],
    lunch: { time: "12:00", durationMinutes: 60 },
    breaks: [{ time: "10:00", durationMinutes: 15 }, { time: "14:00", durationMinutes: 15 }] },
  { name: "defaults", workStart: "07:00", workEnd: "15:00", workDays: [1, 2, 3, 4, 5], holidays: [],
    lunch: { time: "12:00", durationMinutes: 30 }, breaks: [{ time: "10:00", durationMinutes: 15 }] },
  { name: "holidays-4day", workStart: "07:30", workEnd: "16:00", workDays: [1, 2, 3, 4],
    holidays: ["2026-10-06", "2026-10-12"],
    lunch: { time: "11:30", durationMinutes: 30 }, breaks: [{ time: "09:00", durationMinutes: 15 }] },
  // A break before the day opens and one overlapping lunch: banked at the start, merged.
  { name: "odd-breaks", workStart: "08:00", workEnd: "16:00", workDays: [1, 2, 3, 4, 5], holidays: [],
    lunch: { time: "12:00", durationMinutes: 45 },
    breaks: [{ time: "06:00", durationMinutes: 20 }, { time: "12:30", durationMinutes: 30 }] },
  { name: "no-lunch", workStart: "06:00", workEnd: "14:30", workDays: [0, 1, 2, 3, 4, 5, 6], holidays: [],
    lunch: { time: "12:00", durationMinutes: 0 }, breaks: [] },
];
const hourOf = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
const cfgOf = (o) => buildDayWindows(hourOf(o.workStart), hourOf(o.workEnd), o.breaks, o.lunch);
const prodOf = (o) => { const c = cfgOf(o); return Math.max(1, (c.workEndH - c.workStartH) - c.deadH); };

const DAYS = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07",
  "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"];
let seed = 20261004;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(rnd() * a.length)];

function compute() {
  const orgs = ORGS.map((o) => {
    const c = cfgOf(o);
    return { ...o, windows: { workStartH: c.workStartH, workEndH: c.workEndH,
      dead: c.deadWindows.map((w) => ({ start: w.start, duration: w.dur })) },
      productiveHoursPerDay: prodOf(o) };
  });

  const walks = [], clockHours = [], calendar = [], segments = [], dayView = [];
  ORGS.forEach((o, oi) => {
    const cfg = cfgOf(o), prod = prodOf(o), cal = workCalendar(o);
    for (const startH of [0, cfg.workStartH, 9.25, 11.9, 12, 13.5, cfg.workEndH - 0.5, 23]) {
      for (const hours of [0, 0.25, 1, 3.75, prod, prod + 0.5, 19, 40]) {
        const w = walkProductiveHours(startH, hours, cfg);
        walks.push({ org: oi, startH, hours, days: w.days, endHour: w.endHour, columns: w.columns });
      }
    }
    // Inside the working day only: that is the domain opDaySegments calls it on. Outside it
    // the two sides differ (the JS does not clip to the day; WorkDayClock does) — logged.
    for (const [a, b] of [[cfg.workStartH, cfg.workEndH], [cfg.workStartH, cfg.workStartH + 2.5],
      [Math.max(cfg.workStartH, 9), 11], [11.5, 13], [12, 12.5], [14, 10], [cfg.workEndH - 1, cfg.workEndH]]) {
      clockHours.push({ org: oi, from: a, to: b, hours: productiveClockHours(a, b, cfg) });
    }
    for (const day of DAYS) calendar.push({ org: oi, day, isWorkDay: cal.isWorkDay(day) });

    const isWorkDay = (d) => cal.isWorkDay(d);
    const unit = (i) => {
      const s = pick(DAYS), e = rnd() < 0.45 ? s : pick(DAYS.filter((d) => d >= s));
      const u = { id: `u${i}`, start: s, end: e, hpd: pick([0, 0.5, 2.5, 4, 7.5, 12, 30, 75]),
        team: pick([["a"], ["a", "b"], ["a", "b", "c"]]) };
      if (rnd() < 0.5) u.startHour = pick([5, 7, 8, 9.5, 11.75, 12.25, 13, 16]);
      return u;
    };
    for (let k = 0; k < 24; k++) {
      const u = unit(k);
      segments.push({ org: oi, unit: u,
        segments: opDaySegments(u, { cfg, productiveHoursPerDay: prod, isWorkDay })
          .map((x) => ({ day: x.day, start: x.startH, end: x.endH })) });
    }
    for (let k = 0; k < 40; k++) {
      const units = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) => unit(i));
      const bars = units.map((u) => ({ type: "task", start: u.start, end: u.end, task: u }));
      // A day one of the units covers, so most cases actually exercise the pack.
      const u0 = pick(units), span = DAYS.filter((d) => d >= u0.start && d <= u0.end);
      const day = pick(span.length ? span : DAYS);
      for (const business of [true, false]) {
        dayView.push({ org: oi, day, business, units,
          blocks: dayViewBlocks(bars, { day, cfg, productiveHoursPerDay: prod, isWorkDay, business })
            .map((x) => ({ index: x.index, start: x.startH, end: x.endH, isFirst: x.isFirstSeg, isLast: x.isLastSeg })) });
      }
    }
  });

  const shares = [];
  for (const hpd of [0, 0.5, 8, 30, 75]) for (const teamCount of [0, 1, 2, 3]) for (const p of [7.25, 7.5]) {
    shares.push({ hpd, teamCount, productiveHoursPerDay: p, hours: personShareHours(hpd, teamCount, p) });
  }

  // isAssignedHere: which node is the one a person is assigned, and so gets a bar. A panel
  // with live ops is never one — even when this person is on the panel and on none of them
  // (#241, the panel bar drawn for other people's ops).
  const me = "a";
  const onTeam = (team) => (team || []).map(String).includes(me);
  const op = (team, extra = {}) => ({ team, ...extra });
  const assigned = [
    { name: "op on my team", node: op(["a"]) },
    { name: "op not mine", node: op(["b"]) },
    { name: "panel, mine, no ops", node: { team: ["a"], subs: [] } },
    { name: "panel, mine, only others' live ops", node: { team: ["a"], subs: [op(["b"]), op(["c"])] } },
    { name: "panel, mine, my live op", node: { team: ["a"], subs: [op(["a"])] } },
    { name: "panel, mine, all ops deleted", node: { team: ["a"], subs: [op(["b"], { deletedAt: "2026-09-01" })] } },
    { name: "panel, not mine, no ops", node: { team: ["b"], subs: [] } },
  ].map((c) => ({ ...c, assigned: isAssignedHere(c.node, onTeam) }));

  return { generatedBy: "scripts/schedule-parity-test.mjs", orgs, walks, clockHours, calendar,
    shares, segments, dayView, assigned };
}

const now = compute();
const text = JSON.stringify(now, null, 1) + "\n";
const total = ["walks", "clockHours", "calendar", "shares", "segments", "dayView", "assigned"]
  .reduce((n, k) => n + now[k].length, 0);
// Guard the INPUT: a refactor that empties a section must not read as a pass.
if (total < 500 || now.dayView.filter((c) => c.blocks.length).length < 250
    || now.segments.filter((c) => c.segments.length > 1).length < 10) {
  console.error(`schedule-parity: only ${total} cases generated — the generator is broken`);
  process.exit(2);
}

if (WRITE) {
  writeFileSync(FILE, text);
  console.log(`schedule-parity: wrote ${total} cases to fixtures/schedule-parity.json`);
  process.exit(0);
}
if (!existsSync(FILE)) {
  console.error("schedule-parity: fixtures/schedule-parity.json is missing — run with --write");
  process.exit(2);
}
const committed = readFileSync(FILE, "utf8");
if (committed !== text) {
  const was = JSON.parse(committed);
  const changed = Object.keys(now).filter((k) => JSON.stringify(was[k]) !== JSON.stringify(now[k]));
  console.error(`schedule-parity: FAIL — the web rules no longer produce the committed fixture.`);
  console.error(`  sections that changed: ${changed.join(", ")}`);
  console.error(`  If the change is deliberate: node scripts/schedule-parity-test.mjs --write,`);
  console.error(`  then make ScheduleParityTests (iOS) pass against it before shipping.`);
  process.exit(1);
}
console.log(`schedule-parity: PASS — ${total} cases match fixtures/schedule-parity.json`);
