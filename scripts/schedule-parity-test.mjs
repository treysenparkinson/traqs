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
  opDaySegments, dayViewBlocks, isAssignedHere, productiveHoursBetween, endOfWorkingDayMs,
  sessionWorkedHours, dayGridHours } from "../src/statsMath.js";
import { withOrgDefaults } from "../src/orgDefaults.js";
import { legibleBarColor, doneBarFill, barPaint } from "../src/barPaint.js";
import { shopDay, shopHour, shopMs, endOfDayFor } from "../src/shopTime.js";
import { workCalendar, unitDepartments } from "../src/scheduleRules.js";
import { candidatesFor } from "../src/placement.js";
import { getPayPeriodFromDates, getPayPeriodAtOffsetFromDates } from "../src/payPeriod.js";

// shopTime takes its viewer-local path whenever a zone equals the machine's own. Pin the
// machine to UTC so every zone below goes through the zoned path, whoever runs this.
process.env.TZ = "UTC";
if (new Date(0).getTimezoneOffset() !== 0 || Intl.DateTimeFormat().resolvedOptions().timeZone !== "UTC") {
  console.error("schedule-parity: could not pin the process to UTC"); process.exit(2);
}

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
  // #264/#307: a lunch with no length is the default 30 (withOrgDefaults); a BREAK with no
  // length is no break at all (buildDayWindows drops it) — not 30, not 15.
  { name: "missing-lengths", workStart: "07:30", workEnd: "16:15", workDays: [1, 2, 3, 4, 5], holidays: [],
    lunch: { time: "11:00" }, breaks: [{ time: "09:30" }, { time: "15:00", durationMinutes: 10 }] },
];
const hourOf = (t) => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
// Through withOrgDefaults first, as the app does: that is where a missing lunch length
// becomes 30. A no-op for an org that sets everything.
const cfgOf = (org) => { const o = withOrgDefaults(org);
  return buildDayWindows(hourOf(o.workStart), hourOf(o.workEnd), o.breaks, o.lunch); };
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

  // Departments and candidates (src/scheduleRules.js, src/placement.js): who may take a unit.
  // The nearest level that states a department wins; [] is anyone; a stated department with
  // nobody in it is NOBODY (no fallback to all crew); an existing team wins outright.
  const DEPTS = ["Wire", "Cut", "Layout", "Engineering"];
  const deptShape = () => { const r = rnd();
    if (r < 0.35) return {};
    if (r < 0.6) return { requiredDepartment: pick(DEPTS) };
    if (r < 0.75) return { requiredDepartment: pick(DEPTS).toLowerCase() };
    if (r < 0.9) { const set = [...new Set([pick(DEPTS), pick(DEPTS)])]; return { requiredDepartments: set, requiredDepartment: set[0] }; }
    return { requiredDepartments: [] }; };
  const crew = [
    { id: "p1", name: "A", department: "Wire", userRole: "user" },
    { id: "p2", name: "B", department: "Cut", secondaryDepartment: "Wire", userRole: "user" },
    { id: "p3", name: "C", department: "Layout", userRole: "user" },
    { id: "p4", name: "D", department: "wire", userRole: "user" },
    { id: "p5", name: "E", department: "", userRole: "user" },
    { id: 6, name: "F", department: "Cut", userRole: "user" },
  ];
  const candidates = [];
  for (let k = 0; k < 120; k++) {
    const op = { id: `o${k}`, title: pick(["Wire", "Cut", "Layout", "Inspect"]), ...deptShape() };
    const tr = rnd();
    if (tr < 0.2) op.team = [pick(["p1", "p3", 6, "6"])];
    else if (tr < 0.27) op.team = ["gone"];
    const panel = { id: `P${k}`, title: "Panel", ...deptShape() };
    const job = { id: `J${k}`, title: "Job", ...deptShape() };
    candidates.push({ op, panel, job,
      departments: unitDepartments(op, panel, job),
      candidates: candidatesFor(op, crew, { panel, job }).map((p) => String(p.id)) });
  }

  // Shop time (src/shopTime.js) and job-clock session hours (statsMath sessionWorkedHours) —
  // the live-hours rule (#250) and the instants it is built on. Zones include both 2026 US DST
  // changes (Mar 8, Nov 1) and a half-hour offset.
  const ZONES = ["America/Denver", "America/New_York", "UTC", "Asia/Kolkata", "Australia/Sydney"];
  const shop = [];
  for (const tz of ZONES) {
    for (const ds of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-05", "2026-11-01", "2026-11-02"]) {
      for (const h of [0, 1.5, 7, 8.25, 12, 17, 23.75]) {
        const ms = shopMs(ds, h, tz);
        shop.push({ tz, day: ds, hour: h, ms, backDay: shopDay(ms, tz), backHour: shopHour(ms, tz) });
      }
    }
  }
  const sessions = [];
  const sessOrgs = [ORGS[0], ORGS[2]];   // Matrix shape; a 4-day week with holidays
  for (const [si, o] of sessOrgs.entries()) {
    for (const tz of ["America/Denver", "America/New_York", "Asia/Kolkata"]) {
      const cfg = { ...cfgOf(o), workDays: o.workDays, holidays: o.holidays, timeZone: tz };
      const at = (ds, h) => shopMs(ds, h, tz);
      const H = 3600000;
      const cases = [
        { name: "inside one morning", in: at("2026-10-05", 8.5), now: at("2026-10-05", 11.75) },
        { name: "across lunch and a break", in: at("2026-10-05", 9), now: at("2026-10-05", 15) },
        { name: "left open past quitting time", in: at("2026-10-05", 13), now: at("2026-10-05", 21) },
        { name: "Friday into Monday", in: at("2026-10-09", 14), now: at("2026-10-12", 10) },
        { name: "clocked in after quitting time", in: at("2026-10-05", 18), now: at("2026-10-06", 10) },
        { name: "open pause", in: at("2026-10-05", 8), now: at("2026-10-05", 14), pausedAt: new Date(at("2026-10-05", 11)).toISOString() },
        { name: "held (frozen)", in: at("2026-10-05", 8), now: at("2026-10-05", 16), frozenAtMs: at("2026-10-05", 10.5) },
        { name: "manual and auto pauses", in: at("2026-10-05", 8), now: at("2026-10-05", 16), totalPausedMs: 1.5 * H, autoPausedMs: 1 * H },
        { name: "closed session", in: at("2026-10-05", 8), clockOut: at("2026-10-05", 12.5), now: at("2026-10-07", 9) },
        { name: "across a holiday", in: at("2026-10-05", 14), now: at("2026-10-07", 9) },
        { name: "DST fall-back weekend", in: at("2026-10-30", 15), now: at("2026-11-02", 9) },
        { name: "DST spring-forward Monday", in: at("2026-03-09", 8), now: at("2026-03-09", 12) },
      ];
      for (const c of cases) {
        const r = sessionWorkedHours({ clockInMs: c.in, clockOutMs: c.clockOut, pausedAt: c.pausedAt ?? null,
          frozenAtMs: c.frozenAtMs, totalPausedMs: c.totalPausedMs ?? 0, autoPausedMs: c.autoPausedMs ?? 0, nowMs: c.now, cfg });
        sessions.push({ org: [0, 2][si], tz, name: c.name, clockInMs: c.in, clockOutMs: c.clockOut ?? null,
          pausedAt: c.pausedAt ?? null, frozenAtMs: c.frozenAtMs ?? null, totalPausedMs: c.totalPausedMs ?? 0,
          autoPausedMs: c.autoPausedMs ?? 0, nowMs: c.now,
          hours: r.hours, endMs: r.endMs, frozen: r.frozen, unclosed: r.unclosed,
          between: productiveHoursBetween(c.in, c.now, cfg),
          endOfDay: endOfWorkingDayMs(c.in, cfg) });
      }
    }
  }

  // The day view's hour grid (#257): whole hours, floor of the start, ceiling of the end.
  const grids = [];
  for (const [a, b] of [[7, 15], [7.5, 16.25], [8, 17], [6.75, 14.5], [0, 24], [23.5, 23.75], [8, 8]]) {
    const g = dayGridHours(a, b);
    grids.push({ workStartH: a, workEndH: b, start: g.HS, end: g.HE });
  }
  // Bar colour (#253) and the DONE fill (#252), src/barPaint.js.
  const paint = [];
  for (const c of ["#94a3b8", "#ffffff", "#000000", "#eda412", "#30b8f8", "#6c4fe0", "#d63c8c", "#1a9b6a",
    "#ffeb3b", "#ff6b5b", "#9ca3af", "#22d3ee", "#7c3aed", "#f59e0b"]) {
    for (const row of ["#ffffff", "#202024", "#fbfaf7"]) {
      // The day view's finished fill: doneBarFill over barPaint's finished mute (TRAQS.jsx _dayFill).
      const legible = legibleBarColor(c);
      paint.push({ color: c, row, legible, done: doneBarFill({}, barPaint({ status: "Finished" }, legible), row) });
    }
  }

  // Pay periods by payDates (src/payPeriod.js) — ruled a SHOP concept (iOS chunk D): `today`
  // is the shop's day and so is the answer. Month ends, a leap February, the year turn, an
  // unsorted pair, a 31st, and both directions of the offset walk.
  const payPeriods = [];
  const PAY_DATES = [[5, 20], [1, 16], [20, 5], [15, 31], [10, 25], [1, 15], [28, 14]];
  const PAY_DAYS = ["2026-10-04", "2026-10-05", "2026-10-19", "2026-10-20", "2026-10-31", "2026-01-01",
    "2026-01-04", "2026-12-31", "2026-02-28", "2028-02-29", "2026-03-01", "2026-03-15", "2026-03-16", "2026-11-30"];
  for (const payDates of PAY_DATES) {
    for (const today of PAY_DAYS) {
      for (const offset of [0, -1, -3, 1, 2]) {
        const p = offset === 0 ? getPayPeriodFromDates(payDates, today) : getPayPeriodAtOffsetFromDates(payDates, today, offset);
        payPeriods.push({ payDates, today, offset, start: p.start, end: p.end, periodNumber: p.periodNumber });
      }
    }
  }

  return { generatedBy: "scripts/schedule-parity-test.mjs", orgs, walks, clockHours, calendar,
    shares, segments, dayView, assigned, crew, candidates, shop, sessions, grids, paint, payPeriods };
}

const now = compute();
const text = JSON.stringify(now, null, 1) + "\n";
const total = ["walks", "clockHours", "calendar", "shares", "segments", "dayView", "assigned", "candidates", "shop", "sessions", "grids", "paint", "payPeriods"]
  .reduce((n, k) => n + now[k].length, 0);
// Guard the INPUT: a refactor that empties a section must not read as a pass.
if (total < 500 || now.dayView.filter((c) => c.blocks.length).length < 250
    || now.segments.filter((c) => c.segments.length > 1).length < 10
    || now.candidates.filter((c) => c.candidates.length === 0).length < 5
    || now.candidates.filter((c) => c.departments.length > 1).length < 5
    || now.sessions.filter((c) => c.unclosed).length < 4 || now.sessions.filter((c) => c.hours > 0).length < 30
    || now.payPeriods.length < 400 || now.payPeriods.some((c) => ![c.start, c.end].every((d) => /^\d{4}-\d\d-\d\d$/.test(d)))) {
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
// NEWLINES NORMALISED, and it is not cosmetic (#376). git checks this repo out
// with core.autocrlf=true: the index holds LF, the working copy holds CRLF, and
// `text` above is built in memory and is therefore LF. The gate below is a
// WHOLE-FILE string compare, so on any Windows checkout it differed by one \r
// per line — 49,474 of them — and reported that the web rules had drifted when
// nothing had changed at all.
//
// The tell was in the suite's own output: the section-by-section diff printed
// directly below parses both sides and names what differs, and it named
// NOTHING. A gate that fails while its own explanation finds no difference is
// comparing the wrong thing.
//
// The FIXTURE IS LEFT ALONE. Regenerating it with --write would have committed
// CRLF into the blob, broken it for every other machine, and — per this file's
// own message — put iOS out of parity until ScheduleParityTests was re-run. The
// source is not the problem; what is compared is normalised.
const committed = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");

// EOL canary. If the normalisation above is ever removed, this gate goes back to
// failing on every Windows checkout for a reason that has nothing to do with the
// schedule rules — and the next person spends a day on it, as happened here. A
// surviving \r means the normalisation is gone; say so plainly rather than
// letting it surface as a phantom rule change.
if (/\r/.test(committed)) {
  console.error("schedule-parity: a CR survived normalisation — the EOL canary is broken (#376)");
  process.exit(2);
}

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
