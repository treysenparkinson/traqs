// #355/#207 — A MEMBERSHIP COMPARISON MUST GO THROUGH `sameId`/`onTeam`.
//
// Person ids are mixed string/number across the web, iOS and the stored history,
// and a raw `.includes(pid)` against a number-typed id DOES NOT ERROR — it just
// does not match. The op falls through to the department pool, or the counter
// reads zero, and the result is indistinguishable from the behaviour being
// fixed. That is the whole hazard: silence.
//
// IT HAS BITTEN TWICE INSIDE OTHER FIXES IN THIS CAMPAIGN, which is the evidence
// that hand-editing the known sites does not hold — both of these were written
// by someone who had just read the rule:
//
//   #340  `(op.team || []).includes(pp.id)` in the manual-assignment check —
//         "a raw `.includes` silently matches nothing and the op falls through
//         to the department pool, INDISTINGUISHABLE FROM THE SCHEDULER IGNORING
//         THE ASSIGNMENT, WHICH IS THE BUG BEING FIXED."
//   #345  `(pnl.team || []).includes(pid)` in the even-load counter, which made
//         the load read zero for a number-typed member while the fix was
//         explicitly about counting load correctly.
//
// So this is a BUILD ASSERTION rather than nine hand-edits. The listed sites are
// LATENT on today's data — all 161 live memberships are strings, and the only 12
// number-typed ones sit inside three job-level tombstones that `filterLive`
// strips before any client sees them — so editing them has no measurable effect.
// Preventing the NEXT one does.
//
// WHY IT IS SCOPED TO `team`: that is where the hazard is measurable and the
// pattern is unambiguous. A blanket ban on `.includes(` would flag hundreds of
// legitimate string and array uses and would be switched off within a week,
// which is LESSONS #4 — a guard nobody can live with is a guard that gets
// disabled rather than believed.
//
//   node scripts/membership-lint-test.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOf } from "./_code-view.mjs";
import { membershipViolations } from "./_membership-lint.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\n1. RED PROOF — the two cases that bit INSIDE other fixes");
{
  // #340, verbatim shape from the entry.
  const c340 = `const eligible = all.filter(pp => (op.team || []).includes(pp.id));`;
  ok("#340's manual-assignment check is caught", membershipViolations(c340).length, 1);
  ok("...and the finding names the member being tested", membershipViolations(c340)[0]?.member, "pp.id");

  // #345, verbatim from the diff that removed it.
  const c345 = `if ((pnl.team || []).includes(pid) && pnl.status !== "Finished") n++;`;
  ok("#345's load counter is caught", membershipViolations(c345).length, 1);
  ok("...and names it too", membershipViolations(c345)[0]?.member, "pid");

  // The minified form the same file also carried.
  ok("the minified spelling is caught as well",
    membershipViolations(`if((pnl.team||[]).includes(pid) && pnl.status!=="Finished") n++;`).length, 1);
  // And the bare form without the || [] guard.
  ok("a bare team.includes is caught", membershipViolations(`if (op.team.includes(personId)) return;`).length, 1);
}

console.log("\n2. WHAT IT MUST NOT FLAG — or it gets switched off");
{
  ok("the sanctioned helper passes", membershipViolations(`if (onTeam(op, pp.id)) return;`).length, 0);
  ok("sameId passes", membershipViolations(`if ((op.team || []).some(x => sameId(x, pp.id))) return;`).length, 0);
  ok("a String()-normalised includes passes",
    membershipViolations(`if ((op.team || []).map(String).includes(String(pid))) return;`).length, 0);
  ok("...in either order", membershipViolations(`if (team.map(String).includes(String(p.id))) return;`).length, 0);
  ok("includes on something that is not a team passes",
    membershipViolations(`if (["a","b"].includes(kind)) return;`).length, 0);
  ok("a string search passes", membershipViolations(`if (title.toLowerCase().includes(q)) return;`).length, 0);
  ok("a Set of ids passes", membershipViolations(`if (idSet.has(String(pp.id))) return;`).length, 0);
  ok("depGroupIds.has passes", membershipViolations(`if (!depGroupIds.has(op.id)) continue;`).length, 0);
}

console.log("\n3. IT REPORTS WHERE, NOT JUST THAT");
{
  const src = ["// a comment", `const a = (op.team || []).includes(pid);`, "const b = 1;"].join("\n");
  const v = membershipViolations(src);
  ok("the line number is reported", v[0]?.line, 2);
  ok("...and the text, so the message is actionable", /team \|\| \[\]\)\.includes\(pid\)/.test(v[0]?.text || ""), true);
}

console.log("\n4. A COMMENT DESCRIBING THE PATTERN IS NOT A VIOLATION");
{
  // This file, and several entries in SCHEDULE_MAP, quote the banned form in
  // order to explain it. An assertion satisfiable — or violable — by its own
  // documentation is LESSONS #5, and this suite would be its own first failure.
  ok("a line comment quoting it is ignored",
    membershipViolations(`// it used (op.team || []).includes(pid), missing number-typed ids`).length, 0);
  ok("a block comment quoting it is ignored",
    membershipViolations(`/* was: (op.team||[]).includes(pid) */`).length, 0);
}

console.log("\n5. A RATCHET OVER THE LIVE SOURCE — the next one fails the build");
{
  // IT IS A RATCHET, NOT A CLEAN ZERO, and that is the ruling rather than a
  // compromise. All nine standing sites are LATENT: every one of the 161 live
  // memberships at Matrix is a string, and the only 12 number-typed ones sit
  // inside three job-level tombstones that `filterLive` strips before any client
  // sees them. Hand-editing nine unreachable sites is churn with no measurable
  // effect; catching the TENTH is the whole value, because the last two were
  // written mid-fix by someone who had just read the rule (#340, #345).
  //
  // The number may only ever go DOWN. An increase fails with the file and line.
  // A decrease ALSO fails, asking for the baseline to be lowered — a one-line
  // edit, and the only thing that keeps the number honest instead of stale.
  const BASELINE = { "TRAQS.jsx": 9 };
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(f)) files.push(p); } };
  walk(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

  const counts = {}, found = [];
  for (const f of files) {
    const name = f.split(/[\\/]/).pop();
    for (const v of membershipViolations(readFileSync(f, "utf8"))) {
      counts[name] = (counts[name] || 0) + 1;
      found.push(`${name}:${v.line}  ${v.member.padEnd(14)} ${v.text.trim().slice(0, 62)}`);
    }
  }
  console.log(found.length ? found.map(s => `         ${s}`).join("\n") : "         (none)");

  const names = [...new Set([...Object.keys(counts), ...Object.keys(BASELINE)])].sort();
  const over = names.filter(n => (counts[n] || 0) > (BASELINE[n] || 0));
  const under = names.filter(n => (counts[n] || 0) < (BASELINE[n] || 0));
  ok("no file has MORE raw team-membership comparisons than its baseline", over, []);
  ok("...and none has fewer — lower the baseline when one is removed", under, []);
  ok("every other file in src/ is at zero",
    names.filter(n => !(n in BASELINE) && counts[n]), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
