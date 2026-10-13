// #507. IDLE IS PAID TIME WITH NO JOB CLOCKED, AND THE DENOMINATOR IS PAID TIME
// MINUS BREAKS — re-ruled 2026-10-13 after the break restore.
//
// THE HISTORY, because the denominator has now moved twice.
//   * Originally `working = pay − break`: breaks are mandatory paid downtime that
//     cannot become production, so counting them caps everyone at ~93.75%.
//   * 2026-10-12 (#505 as first built): a break was credited to the JOB, so it sat
//     in the numerator and was subtracted from the denominator — efficiency read
//     over 100%. Trey ruled `working = pay`.
//   * 2026-10-13: the break rule was BACKWARDS and was restored — on a break pay
//     keeps running and PRODUCTION STOPS. With breaks out of production,
//     `pay − break` cannot exceed 100%, so the reason for `pay` is gone. Trey:
//     the denominator is `pay − break`.
//
// IDLE IS UNCHANGED IN MEANING: paid time with no job clocked at all. A break is
// paid and is not production, but the worker is ON a job (paused), so it is not
// idle either: idle = pay − break − prod. THAT IT IS USUALLY ZERO IS THE POINT —
// a worker on a job all day who takes their breaks reads zero.
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

console.log("\n1. THE DENOMINATOR IS PAID TIME MINUS BREAKS");
{
  // A worker paid 8h who took a 30m break and was on a job for the rest: on the
  // restored rule production is 7.5h, not 8.
  const t = totalsForDays(maps([{ d: D[0], pay: 8, prod: 7.5, brk: 0.5 }]), [D[0]]);
  ok("working is pay minus break", t.working, 7.5);
  ok("a rule-following worker on a job all day is 100%, not 94", efficiencyPct(t), 100);
  ok("break is still reported", t.brk, 0.5);
  ok("pay and prod are unchanged", [t.pay, t.prod], [8, 7.5]);
}

console.log("\n2. IDLE IS PAID TIME WITH NO JOB CLOCKED");
{
  const t = totalsForDays(maps([{ d: D[0], pay: 8, prod: 6, brk: 0.5 }]), [D[0]]);
  ok("idle is pay minus break minus production", t.idle, 1.5);
  ok("...the break is NOT idle — the worker was on a job, paused", t.idle === 8 - 0.5 - 6, true);
  ok("efficiency reads against paid time minus breaks", efficiencyPct(t), 80);
}
{
  // THE POINT OF THE RULING: a worker always on a job reads zero.
  const t = totalsForDays(maps([{ d: D[0], pay: 8, prod: 7.5, brk: 0.5 }]), [D[0]]);
  ok("a worker who was on a job all day, breaks taken, has NO idle time", t.idle, 0);
}
{
  // Production can exceed working time — two people on one op, or a job clock left
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
  ok("working is paid time minus breaks, clamped per day",
    /working \+= Math\.max\(0, p - b\);/.test(S), true);
  ok("idle is paid time minus breaks minus production, clamped per day",
    /idle \+= Math\.max\(0, p - b - r\);/.test(S), true);
  ok("totalsForDays returns it", /return \{ pay, prod, brk, working, idle \};/.test(S), true);
  ok("the 2026-10-12 rule is recorded as superseded rather than deleted",
    /FROM 2026-10-12 TO 2026-10-13 IT WAS `working = pay`/.test(S), true);
  const T = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  ok("the Employees card no longer asserts the old rationale as current",
    /mandatory paid downtime a worker cannot convert into/.test(T), false);
  ok("...and reads idle from the shared total instead of re-deriving it",
    /const totalIdle = rows\.reduce\(\(a, r\) => a \+ r\.idle, 0\);/.test(T), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
