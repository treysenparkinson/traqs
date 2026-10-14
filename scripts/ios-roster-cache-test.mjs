// iOS: the roster and the cache across a logout (Trey, 2026-10-13 — every DM read "DM").
//
// The behaviour is held in Swift (RosterCacheTests: a closed cache refuses a late sync;
// mergeFullPeople replaces a stale roster). What Swift tests cannot reach is AppState's
// WIRING, which is private — so it is pinned here, by source:
//
//   1. clearForLogout CLOSES the cache it clears, so a /sync in flight at logout cannot
//      write rows or a cursor into it afterwards.
//   2. loadAll's GET /people reaches the cache (mergeFullPeople), unless a delta moved the
//      cursor mid-fetch — then the cache is fresher and the race guard rehydrates from it.
//   3. A GET /people failure SURFACES. It was `try? api.fetchPeople()`: a real error showed
//      nothing, and the stale roster on screen made a fine request look like a failed one.
//
//   node scripts/ios-roster-cache-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const src = (p) => readFileSync(new URL(`../TRAQS Scheduling/TRAQS Scheduling/${p}`, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "");               // assertions are on code, not comments
const body = (s, sig) => {
  const i = s.indexOf(sig);
  if (i < 0) return "";
  let d = 0, j = s.indexOf("{", i);
  for (let k = j; k < s.length; k++) { if (s[k] === "{") d++; else if (s[k] === "}" && --d === 0) return s.slice(i, k + 1); }
  return "";
};
const A = strip(src("Services/AppState.swift"));
const L = strip(src("Services/LocalCache.swift"));

console.log("\n1. LOGOUT CLOSES THE CACHE IT CLEARS");
{
  const b = body(A, "func clearForLogout()");
  ok("clearForLogout found", b.length > 0, true);
  ok("...it clears, then closes", /localCache\?\.clearAll\(\)\s*\n\s*localCache\?\.close\(\)/.test(b), true);
  ok("LocalCache.close() exists", /func close\(\)/.test(L), true);
  for (const fn of ["func applyBatch<", "func reconcile<", "func setCursor("]) {
    ok(`${fn.replace(/[<(]$/, "")} refuses a closed cache`, /guard[^\n]*!isClosed/.test(body(L, fn)), true);
  }
}

console.log("\n2. loadAll's ROSTER REACHES THE CACHE");
{
  const b = body(A, "func loadAll() async");
  ok("loadAll found", b.length > 0, true);
  ok("it fetches the raw roster", /api\.fetchPeopleData\(\)/.test(b), true);
  ok("...and writes it to the cache when the cursor hasn't moved",
    /localCache\?\.cursor\(\) == startCursor[\s\S]{0,200}?syncService\?\.mergeFullPeople\(/.test(b), true);
}

console.log("\n3. A GET /people FAILURE SURFACES");
{
  const b = body(A, "func loadAll() async");
  ok("people is no longer fetched with try?", /try\? api\.fetchPeople/.test(b), false);
  ok("a failure sets the error banner", /errorMessage = "Couldn't load the team/.test(b), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
