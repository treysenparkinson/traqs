// What one render of the Jobs list and the Schedule costs.
//
// renderStdCell is called ONCE PER COLUMN. Its first fifteen lines were per-ROW
// work: three separate walks of the job's whole subtree (health, hours, percent)
// plus linear scans of people, clients and tasks. With thirteen standard columns
// that was the same work thirteen times over for every row on the page -- measured
// at 12ms a render on 120 jobs, most of a 60fps frame, before React reconciled a
// single node. With 441 pieces of state in this component and no memo boundary,
// every hover, keystroke and 60-second clock tick paid it again.
//
//   node scripts/render-perf-test.mjs
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// ── the row's work happens once ──────────────────────────────────────────────
ok("the row's context is built by one function", S.includes("const stdCellCtx = (item, level, jobId, alwaysExpand = false, groupPrefix = \"\") => {"));
ok("...called once in the row, above the column loop", (S.match(/const cellCtx = stdCellCtx\(/g) || []).length === 1);
ok("...and handed to every cell", S.includes("groupPrefix, cellCtx);"));
ok("the cell renderer accepts it", /const renderStdCell = \([^)]*ctx = null\) => \{/.test(S));
ok("...and reads it rather than recomputing", /= ctx \|\| stdCellCtx\(item, level, jobId, alwaysExpand, groupPrefix\);/.test(S));

// Each of these was a separate subtree walk or list scan, per cell.
const CELL = S.slice(S.indexOf("const renderStdCell = ("), S.indexOf('case "appr": {'));
for (const [what, re] of [
  ["the health rollup", /healthOf\(item\)/],
  ["the hours rollup", /jobHrs\(item\)/],
  ["the percent rollup", /jobPct\(item\)/],
  ["the assignee rollup", /_assigneesOf\(item\)/],
  ["the client lookup", /clientsById\.get|clients\.find/],
  ["the team lookup", /personOf\(id\)|people\.find/],
]) ok(`${what} is out of the per-column path`, !re.test(CELL));

// ── lookups are by key, not by scan ──────────────────────────────────────────
ok("there are id maps for people, clients and jobs",
  S.includes("const peopleById = useMemo(") && S.includes("const clientsById = useMemo(") && S.includes("const tasksById = useMemo("));
// idKey is `typeof v + ":" + v`, which files the number 1 and the string "1"
// separately -- the exact drift sameId exists to absorb. These key on String(id).
ok("...keyed the way sameId compares, not by idKey",
  S.includes("const k = String(x.id); if (!m.has(k)) m.set(k, x);") &&
  !/byStrId[\s\S]{0,200}idKey/.test(S));
ok("the row's scheduled-later flag is a map hit, not a scan of every job",
  S.includes("tasksById.get(String(jobId))?.scheduledLater") && !/tasks\.find\(t => t\.id === jobId\)\?\.scheduledLater/.test(S));
ok("the assignee rollup dedupes by key rather than scanning what it has so far",
  S.includes("const k = String(v); if (seen.has(k)) return; seen.add(k); ids.push(v);"));
ok("...and resolves people through the map", S.includes("return ids.map(id => personOf(id)).filter(Boolean);"));

// ── the cost, measured ───────────────────────────────────────────────────────
// Same operands either way; what changes is how often the work is done.
const JOBS = 120, PANELS = 4, OPS = 6, PEOPLE = 40, CLIENTS = 25, COLS = 13;
const people = Array.from({ length: PEOPLE }, (_, i) => ({ id: i + 1, name: `P${i}` }));
const clients = Array.from({ length: CLIENTS }, (_, i) => ({ id: i + 1, name: `C${i}` }));
const jobs = Array.from({ length: JOBS }, (_, j) => ({
  id: `j${j}`, clientId: (j % CLIENTS) + 1, team: [], status: "In Progress",
  subs: Array.from({ length: PANELS }, (_, p) => ({
    id: `j${j}p${p}`, team: [], status: "In Progress",
    subs: Array.from({ length: OPS }, (_, o) => ({ id: `j${j}p${p}o${o}`, hpd: 7.5, loggedHours: o, status: "In Progress", team: [((j + p + o) % PEOPLE) + 1] })),
  })),
}));

let ops = 0;
const pair = (op) => { ops++; return { logged: Math.max(0, op.loggedHours || 0), est: Math.max(0.0001, op.hpd || 8) }; };
const jobPair = (job) => { let l = 0, e = 0; for (const pn of job.subs || []) for (const o of pn.subs || []) { const h = pair(o); l += h.logged; e += h.est; } return { l, e }; };
const jobPct = (j) => { const { l, e } = jobPair(j); return e === 0 ? 0 : Math.round(l / e * 100); };
const jobHrs = (j) => (j.subs || []).reduce((s, p) => s + (p.subs || []).reduce((t, o) => { ops++; return t + (o.hpd ?? 7.5); }, 0), 0);

const scanRow = (item) => {
  clients.find(c => { ops++; return String(c.id) === String(item.clientId); });
  (item.team || []).map(id => people.find(p => { ops++; return p.id === id; }));
  jobPct(item); jobHrs(item); jobPct(item);                       // health, hrs, pct
  const ids = [];
  const walk = (n) => { ops++; const k = (n.subs || []).filter(Boolean); if (k.length) k.forEach(walk); else (n.team || []).forEach(v => { if (!ids.some(x => { ops++; return String(x) === String(v); })) ids.push(v); }); };
  walk(item);
  ids.map(id => people.find(p => { ops++; return String(p.id) === String(id); }));
};
const peopleById = new Map(people.map(p => [String(p.id), p]));
const clientsById = new Map(clients.map(c => [String(c.id), c]));
const mapRow = (item) => {
  ops++; clientsById.get(String(item.clientId));
  (item.team || []).map(id => { ops++; return peopleById.get(String(id)); });
  jobPct(item); jobHrs(item); jobPct(item);
  const ids = [], seen = new Set();
  const walk = (n) => { ops++; const k = (n.subs || []).filter(Boolean); if (k.length) k.forEach(walk); else (n.team || []).forEach(v => { const s = String(v); if (!seen.has(s)) { seen.add(s); ids.push(v); } }); };
  walk(item);
  ids.map(id => { ops++; return peopleById.get(String(id)); });
};
const run = (fn) => { ops = 0; const t = process.hrtime.bigint(); fn(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, ops }; };

const before = run(() => { for (const j of jobs) for (let c = 0; c < COLS; c++) scanRow(j); });
const after = run(() => { for (const j of jobs) mapRow(j); });
console.log(`\n  ${JOBS} jobs x ${PANELS} phases x ${OPS} ops, ${PEOPLE} people, ${COLS} columns`);
console.log(`  per column, by scan : ${before.ms.toFixed(1)}ms  ${before.ops.toLocaleString()} ops`);
console.log(`  per row, by map     : ${after.ms.toFixed(1)}ms  ${after.ops.toLocaleString()} ops`);
console.log(`  ${(before.ops / after.ops).toFixed(0)}x less work\n`);

ok("hoisting and keying cuts the work by at least 20x", before.ops / after.ops >= 20);
// A 60fps frame is 16.6ms, and this is only the prelude.
ok("...and the old shape really did eat most of a frame on its own", before.ms > 5);
ok("...while the new one leaves the frame to React", after.ms < 5);

// ── sorting the Jobs list ────────────────────────────────────────────────────
// Every sort key used to be computed inside the comparator, so sorting by Hrs,
// Progress or Assignee walked a job's whole subtree twice per COMPARISON.
ok("sort keys are computed once per job, not per comparison",
  S.includes("const dec = arr.map((t, i) => ({ t, i, k: keyOf(t) }));"));
ok("...and the comparator only compares them", S.includes("dec.sort((x, y) => (mul * (numeric ? x.k - y.k"));
ok("...with equal keys keeping their original order", S.includes("|| (x.i - y.i));"));
ok("no rollup is called from inside the comparator",
  !/sort\(\(a, b\) => \{[\s\S]{0,1400}_job(Hrs|Pct)\(a\)/.test(S));

{
  // The old shape and the new one, on the same rows, must agree exactly.
  const rows = Array.from({ length: 200 }, (_, i) => ({
    id: i, title: `Job ${(i * 7) % 200}`, jobNumber: String((i * 13) % 200),
    hrs: (i * 31) % 97, pct: (i * 17) % 53,
  }));
  const keyOf = (t) => t.hrs;
  for (const dir of ["asc", "desc"]) {
    const mul = dir === "asc" ? 1 : -1;
    const oldWay = [...rows].sort((a, b) => mul * (keyOf(a) - keyOf(b)));
    const dec = rows.map((t, i) => ({ t, i, k: keyOf(t) }));
    dec.sort((x, y) => (mul * (x.k - y.k)) || (x.i - y.i));
    ok(`a numeric sort matches the old comparator (${dir})`,
      dec.map(d => d.t.id).join() === oldWay.map(t => t.id).join());
  }
  // Ties are where a decorated sort could diverge, so they are the case to prove.
  const tied = Array.from({ length: 50 }, (_, i) => ({ id: i, k: i % 3 }));
  const oldTies = [...tied].sort((a, b) => a.k - b.k);
  const decTies = tied.map((t, i) => ({ t, i, k: t.k }));
  decTies.sort((x, y) => (x.k - y.k) || (x.i - y.i));
  ok("...and equal keys come out in the same order as before",
    decTies.map(d => d.t.id).join() === oldTies.map(t => t.id).join());
}

// ── the Schedule ─────────────────────────────────────────────────────────────
// getPersonBars walks every job, phase and operation, and is called once per
// visible person row. Inside that walk, three tests asked "is anybody clocked into
// this?" with `people.some(...)` -- a scan of the whole roster per node, per person
// row. That is quadratic in the roster and linear in the tree on top of it.
ok("the clocked-into check is an id set, not a roster scan per node",
  S.includes("const _liveOpIds = useMemo(") && S.includes("const isLiveOpId = useCallback("));
// Scoped to getPersonBars' own walk: the predicate is shared now (the row-slack memo asks
// it too), so counting across the whole file would drift every time a caller is added.
ok("...and all three call sites in the walk use it",
  (S.slice(S.indexOf("const getPersonBars = ("), S.indexOf("// Schedule-side bar filter"))
    .match(/isLiveOpId\((op|panel|sub)\.id\)/g) || []).length === 3);
ok("...with no roster scan left in the walk",
  !/people\.some\(lp => lp\.activeJobClock/.test(S));
// Same predicate as before, deliberately: keyed on opId alone, NOT on the deepest
// target _activeJobClocksByOp uses, so a leaf panel someone is clocked into keeps
// behaving exactly as it does now rather than changing visibility inside a
// performance change.
ok("...keyed on opId, so no bar changes visibility here", S.includes("jc.opId != null) s.add(String(jc.opId))"));
ok("today is formatted once per person row, not once per node",
  // TD is the shop's today, set once per render (root cause 6) — no per-row formatting at all.
  S.includes("const _today = TD;") &&
  !/(op|panel|sub)\.end < toDS\(new Date\(\)\)/.test(S));
ok("the person for a row is a map hit", S.includes("const person = personOf(pid);"));
ok("...and so is the client on each bar", !/clients\.find\(x => x\.id === job\.clientId\)/.test(S));

{
  const NODES = JOBS * PANELS * OPS, ROWS = PEOPLE;
  const roster = people.map(p => ({ ...p, activeJobClock: null }));
  roster[7].activeJobClock = { clockIn: 1, opId: "j3p1o2" };
  let n = 0;
  const scanLive = (id) => { for (const lp of roster) { n++; if (lp.activeJobClock?.clockIn && String(lp.activeJobClock.opId) === String(id)) return true; } return false; };
  const live = new Set(roster.filter(p => p.activeJobClock?.clockIn).map(p => String(p.activeJobClock.opId)));
  const setLive = (id) => { n++; return live.has(String(id)); };

  const walk = (check) => { for (let r = 0; r < ROWS; r++) for (const j of jobs) for (const pn of j.subs) for (const o of pn.subs) check(o.id); };
  n = 0; const t0 = process.hrtime.bigint(); walk(scanLive); const scanMs = Number(process.hrtime.bigint() - t0) / 1e6; const scanOps = n;
  n = 0; const t1 = process.hrtime.bigint(); walk(setLive); const setMs = Number(process.hrtime.bigint() - t1) / 1e6; const setOps = n;

  console.log(`  ${ROWS} person rows x ${NODES.toLocaleString()} nodes`);
  console.log(`  roster scan per node : ${scanMs.toFixed(1)}ms  ${scanOps.toLocaleString()} ops`);
  console.log(`  id set per node      : ${setMs.toFixed(1)}ms  ${setOps.toLocaleString()} ops`);
  console.log(`  ${(scanOps / setOps).toFixed(0)}x less work\n`);
  ok("the schedule's live check stops being quadratic in the roster", scanOps / setOps >= 10);
  // Both answer the same question about the same nodes.
  ok("...and still answers identically", scanLive("j3p1o2") === setLive("j3p1o2") && scanLive("nope") === setLive("nope"));
}



// ── the schedule's row-slack pre-pass ────────────────────────────────────────
// This block sat in renderTeam's BODY, unmemoised, and called productiveHoursBetween
// once per op over the span from that op's planned start to NOW -- walked day by day.
// Measured on production data (805 ops; planned starts p50 71 days back, p90 311, max
// 374) it cost 225ms on EVERY render, and grew ~2ms per day because the span is
// anchored to "now": 175ms as of 1 Sep, 225ms on 1 Oct, 358ms by 1 Dec. With the
// schedule re-rendering on every hover crossing, that is the 5fps.
//
// THE BOUND IS NOT A MAGIC NUMBER. Slack exists to widen the bar query so a bar that is
// PAINTED inside the window is not filtered out by its STORED dates. getPersonBars
// already refuses to draw an op whose end is before today (unless somebody is clocked
// into it), so an op that cannot be drawn cannot need slack -- and every op that can be
// drawn has its end on or after today, which puts its planned start at most its own
// length behind. The unbounded walk was computing displacement for work the schedule
// had already decided not to show.
{
  const { slackDaysByPerson } = await import("../src/statsMath.js");
  const { productiveHoursBetween, buildDayWindows } = await import("../src/statsMath.js");
  const TODAY = "2026-10-01";
  const nowMs = Date.parse(TODAY + "T12:00:00Z");
  const cfg = { ...buildDayWindows(7, 15, [], { time: "12:00", durationMinutes: 30 }),
                workStart: "07:00", workEnd: "15:00", lunch: { time: "12:00", durationMinutes: 30 },
                breaks: [], timeZone: "America/Denver", workDays: [1, 2, 3, 4, 5], holidays: [] };
  const productiveBetween = (a, b) => productiveHoursBetween(a, b, cfg);
  const day = (n) => new Date(Date.parse(TODAY + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const op = (o) => ({ hpd: 8, teamSize: 1, team: ["p1"], startHour: 7, status: "In Progress",
                       workedHoursShown: 0, isFullyWorked: false, locked: false, isLive: false, ...o });
  const run = (ops) => slackDaysByPerson({ ops, nowMs, today: TODAY, productiveBetween,
                                           productiveHoursPerDay: 7.5, hourTs: (d, h) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00Z`) });

  // what it is FOR: untouched work whose window opened before today is pushed to now,
  // so the query has to reach back far enough to find it.
  const pushed = run([op({ start: day(-10), end: day(2) })]);
  ok("slack still covers an untouched op the cursor has run past", (pushed.get("p1") || 0) >= 5);

  // what it must NOT pay for: work the schedule refuses to draw.
  const history = run([op({ start: day(-300), end: day(-200) })]);
  ok("an op whose window closed before today costs nothing — it is never drawn", (history.get("p1") || 0) === 0);

  // the one exception getPersonBars makes, mirrored exactly.
  const liveHistory = run([op({ start: day(-300), end: day(-200), isLive: true })]);
  ok("...unless somebody is clocked into it, as getPersonBars allows", (liveHistory.get("p1") || 0) > 0);

  // worked and locked work is not pushed, so it has no cursor slack
  ok("a worked op contributes no cursor slack", (run([op({ start: day(-10), end: day(2), workedHoursShown: 4 })]).get("p1") || 0) === 0);
  ok("a locked op contributes no cursor slack", (run([op({ start: day(-10), end: day(2), locked: true })]).get("p1") || 0) === 0);

  // ── the budget, at production shape ───────────────────────────────────────
  // 805 ops, 70% of them history, planned starts spread the way Matrix's are.
  const fixture = [];
  for (let i = 0; i < 805; i++) {
    const historyOp = i % 10 < 7;                       // 70% closed before today, as measured
    const startBack = historyOp ? 60 + (i * 7) % 315 : (i * 3) % 12;
    const endBack = historyOp ? startBack - 20 : -((i * 2) % 20) - 1;
    fixture.push(op({ start: day(-startBack), end: day(-endBack), team: ["p" + (i % 24)] }));
  }
  run(fixture);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) run(fixture);
  const perRender = Number(process.hrtime.bigint() - t0) / 1e6 / 5;
  console.log(`  row-slack pre-pass, ${fixture.length} ops: ${perRender.toFixed(1)}ms per call`);
  ok(`the pre-pass costs under 15ms at production shape (${perRender.toFixed(1)}ms)`, perRender < 15);

  // Slack accrued against an id with no person row is computed and thrown away: the caller
  // reads this map by roster id. On Matrix 9 of 26 team ids resolve to nobody, across 207 of
  // 1,148 assigned nodes, and one of them carried 1,335 days against a row that never renders.
  const onRosterRun = (ops) => slackDaysByPerson({ ops, nowMs, today: TODAY, productiveBetween,
    productiveHoursPerDay: 7.5, hourTs: (d, h) => Date.parse(`${d}T${String(h).padStart(2, "0")}:00:00Z`),
    onRoster: (pid) => pid === "p1" });
  const ghost = onRosterRun([op({ start: day(-200), end: day(2), team: ["nobody"] })]);
  ok("slack is not accrued against an id with no person row", (ghost.get("nobody") || 0) === 0);
  ok("...while a real person still gets theirs", (onRosterRun([op({ start: day(-10), end: day(2) })]).get("p1") || 0) >= 5);
  // No predicate means no filtering, so an existing caller cannot silently lose slack.
  ok("...and with no onRoster given, nothing is filtered", (run([op({ start: day(-10), end: day(2), team: ["anyone"] })]).get("anyone") || 0) >= 5);
}

// ── the pre-pass is memoised, and hover does not re-render ───────────────────
{
  const team = S.slice(S.indexOf("const renderTeam ="), S.indexOf("const renderAnalytics ="));
  ok("the row-slack pre-pass is out of renderTeam's body", !/rowSlackHours\s*\(/.test(team) && !/slackDaysByPerson\s*\(/.test(team));
  ok("...and is a memo with a dependency array", /const overrunSlackDays = useMemo\(/.test(S) && /slackDaysByPerson\(/.test(S));
  ok("hovering a bar does not set React state", !/setHoveredBarPid\s*\(/.test(team));
  ok("...it swaps one CSS rule instead", /hoverDim/.test(team));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
