// #507. IDLE IS PAID TIME WITH NO JOB CLOCKED, AND THE DENOMINATOR IS PAID TIME.
//
// Trey's ruling, 2026-10-12, after #505 made a clocked break count as production.
//
// WHAT WAS THERE. `working = pay − break`, on the reasoning that "breaks are
// mandatory paid downtime that cannot be converted into production, so they
// come out of the denominator — otherwise following the rules caps everyone at
// ~93.75%". That was true while a break was deleted from production. #505 made
// a break production, so the break sat in the NUMERATOR and was removed from
// the DENOMINATOR, and efficiency could read over 100%. A metric that shows
// 104% teaches people to ignore it.
//
// WHAT IT IS NOW. `working = pay`, and idle is `pay − prod`: paid time with no
// job clocked at all — a worker on the pay clock with no `activeJobClock`.
// THAT IT IS USUALLY ZERO IS THE POINT. The old number was non-zero by
// construction for every rule-following worker, so it measured the RULE rather
// than the worker; a figure that cannot reach zero however well someone works
// is not telling you about the work.
//
//   node scripts/idle-metric-test.mjs
import { readFileSync } from "node:fs";
import { totalsForDays, efficiencyPct } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const maps = (rows) => ({
  payByDay: Object.fromEntries(rows.map(r => [r.d, r.pay])),
  prodByDay: Object.fromEntries(rows.map(r => [r.d, r.prod])),
  breakByDay: Object.fromEntries(rows.map(r => [r.d, r.brk])),
});
const D = ["2026-10-05", "2026-10-06"];

console.log("\n1. THE DENOMINATOR IS PAID TIME — BREAKS STAY IN IT");
{
  // The exact shape that produced 104%: a worker paid 8h who took a 30m break
  // and, since #505, is credited for all 8h of production.
  const t = totalsForDays(maps([{ d: D[0], pay: 8, prod: 8, brk: 0.5 }]), [D[0]]);
  ok("working is pay, not pay minus break", t.working, 8);
  ok("efficiency is 100, not 107", efficiencyPct(t), 100);
  ok("break is still reported", t.brk, 0.5);
  ok("pay and prod are unchanged", [t.pay, t.prod], [8, 8]);
}

console.log("\n2. IDLE IS PAID TIME WITH NO JOB CLOCKED");
{
  const t = totalsForDays(maps([{ d: D[0], pay: 8, prod: 6.5, brk: 0.5 }]), [D[0]]);
  ok("idle is pay minus production", t.idle, 1.5);
  ok("...and the break is NOT part of it — it was on a job", t.idle === 8 - 6.5, true);
  ok("efficiency reads against paid time", efficiencyPct(t), 81);
}
{
  // THE POINT OF THE RULING: a worker always on a job reads zero, which the old
  // metric could never do.
  const t = totalsForDays(maps([{ d: D[0], pay: 8, prod: 8, brk: 0.5 }]), [D[0]]);
  ok("a worker who was on a job all day has NO idle time", t.idle, 0);
  ok("...which the old break-subtracting rule could not report", t.working - t.prod, 0);
}
{
  // Production can exceed pay — two people on one op, or a job clock left
  // running past a pay clock-out. Idle floors at zero rather than going negative.
  const t = totalsForDays(maps([{ d: D[0], pay: 4, prod: 6, brk: 0 }]), [D[0]]);
  ok("idle never goes negative", t.idle, 0);
}

console.log("\n3. IT STILL CLAMPS PER DAY");
{
  // A malformed day must not eat a good one. Kept from the original, because
  // the clamp was never the thing that was wrong.
  const t = totalsForDays(maps([{ d: D[0], pay: 8, prod: 2, brk: 0 }, { d: D[1], pay: 0, prod: 0, brk: 9 }]), D);
  ok("a day with more break than pay contributes no negative working time", t.working >= 8, true);
  ok("...and no negative idle", t.idle >= 0, true);
}

console.log("\n4. EMPTY AND MISSING DAYS");
{
  const t = totalsForDays(maps([]), []);
  ok("no days is all zeros", [t.pay, t.prod, t.brk, t.working, t.idle], [0, 0, 0, 0, 0]);
  ok("efficiency with no working time is null, not a divide by zero", efficiencyPct(t), null);
  const u = totalsForDays(maps([{ d: D[0], pay: 8, prod: 4, brk: 0 }]), [D[0], "2026-12-25"]);
  ok("a day with no entries contributes nothing", [u.pay, u.idle], [8, 4]);
}

console.log("\n5. THE REASONING THAT NO LONGER HOLDS IS GONE FROM THE SOURCE");
{
  // A wrong comment survives an audit a bare line does not (LESSON #17), and
  // this one argued FOR the behaviour being removed.
  // THE FIRST DRAFT OF THIS BANNED THE PHRASE OUTRIGHT and was wrong: the
  // docblock QUOTES the old rationale while explaining why it no longer holds,
  // which is exactly what R2 asks for. It also passed by accident, because the
  // phrase it searched for happened to straddle a line break in the new text.
  // So the assertions are on the CODE, plus a check that the history is kept.
  const S = readFileSync(new URL("../src/statsMath.js", import.meta.url), "utf8");
  ok("working is no longer computed as pay minus break",
    /working \+= Math\.max\(0, p - b\)/.test(S), false);
  ok("working is paid time", /working \+= Math\.max\(0, p\);/.test(S), true);
  ok("idle is paid time minus production", /idle \+= Math\.max\(0, p - r\);/.test(S), true);
  ok("totalsForDays returns it", /return \{ pay, prod, brk, working, idle \};/.test(S), true);
  ok("the superseded rule is recorded rather than deleted",
    /IT USED TO BE `working = pay − break`/.test(S), true);
  const T = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  ok("the Employees card no longer asserts the old rationale as current",
    /mandatory paid downtime a worker cannot convert into/.test(T), false);
  ok("...and reads idle from the shared total instead of re-deriving it",
    /const totalIdle = rows\.reduce\(\(a, r\) => a \+ r\.idle, 0\);/.test(T), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
