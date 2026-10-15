// One rule for how many working days an op spans — #352 (D2).
//
// Thirteen sites computed it: `ceil(hpd / ppd)`, `ceil(hpd / (team × ppd))`, and
// `ceil(personShareHours(...) / ppd)`. They are ONE rule — the per-person share of the total
// (hpd is the whole crew's total, #212) over a productive day — with a different crew size N,
// and they agreed only while every site's N matched the crew the op actually got. They now all
// call durationDays(hpd, N, ppd) with N stated. The one site whose N was wrong — the pending
// tray's drop, which sized for one person and then committed the MERGED team — passes the team
// it commits.
//
//   node scripts/duration-days-test.mjs

import { readFileSync } from "node:fs";
import { durationDays } from "../src/statsMath.js";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

ok("#352 one person, 7.5 h, a 7.5 h day: one day", durationDays(7.5, 1, 7.5) === 1);
ok("#352 one person, 16 h: three days", durationDays(16, 1, 7.5) === 3);
ok("#352 two people share it: 16 h is 8 h each, two days", durationDays(16, 2, 7.5) === 2);
ok("#352 three people, 22.5 h: one day each", durationDays(22.5, 3, 7.5) === 1);
ok("no estimate is a one-day op", durationDays(0, 1, 7.5) === 1 && durationDays(null, 2, 7.5) === 1);
ok("never less than a day", durationDays(1, 1, 7.5) === 1);
ok("a missing team counts as one person", durationDays(16, 0, 7.5) === 3);
// Every old spelling, on the same inputs.
for (const [h, n] of [[7.5, 1], [16, 1], [16, 2], [30, 4], [45, 3], [0.5, 1]]) {
  const old = Math.max(1, Math.ceil(h / (n * 7.5)));
  ok(`same answer as the team-divided spelling for ${h} h / ${n}`, durationDays(h, n, 7.5) === old);
}

const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");
const left = (S.match(/Math\.ceil\(\s*\(?[A-Za-z_.?|()0-9 ]*(hpd|totalHours)[^)]*\)?\s*\/\s*\(?[^)]*productiveHoursPerDay/g) || [])
  .filter(m => !/Math\.ceil\(40 \//.test(m));
ok(`#352 no duration is computed by hand any more (found ${left.length}${left.length ? ": " + JSON.stringify(left) : ""})`, left.length === 0);
const dropAt = S.indexOf("const handlePendingItemDrop");
const drop = S.slice(dropAt, S.indexOf("if (commitDates(node, {", dropAt) + 200);
ok("#352 the pending drop sizes for the team it commits", /durationDays\([^)]*withPerson\(node\.team, personId\)\.length/.test(drop));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
