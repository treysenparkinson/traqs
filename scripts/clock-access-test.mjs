// #549 — the app clock-in permission has a control again, beside the PIN.
//
//   node scripts/clock-access-test.mjs
//
// c28e01b (the 2026-10-04 Settings redesign) removed the per-worker clock-in tiles, the only
// control that ever wrote `canClockInOut`, while the server and iOS kept enforcing it: 12 of
// Matrix's 18 people stored `false` and no screen could change it. Ruled 2026-10-16 (Trey):
// "restore the control … put canClockInOut back in Settings beside the PIN, so the two are
// visible together, which was the point of the original entry" (#443).
//
// A toggle that does not SAVE is worse than none — it reads as fixed. So this follows the
// value end to end: the screen's toggle → the field list its save sends → the server's
// allow-list on POST /people?action=fields → people.json.
import { register } from "module";
import { readFileSync } from "node:fs";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let RE, peopleFn;
try {
  RE = await import(new URL("../src/rosterEdits.js", import.meta.url).href);
  peopleFn = (await import(new URL("../netlify/functions/people.js", import.meta.url).href)).handler;
} catch (e) { console.error("could not load the code under test:", e); process.exit(2); }

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// ── 1. Both screens' saves send it ─────────────────────────────────────────
console.log("\n1. The two Settings saves send canClockInOut");
for (const name of ["SETTINGS_FIELDS", "PERMISSION_FIELDS"]) {
  ok(`${name} (the screen's save) carries canClockInOut`, RE[name].includes("canClockInOut"), true);
}
const base = [{ id: "7", canClockInOut: false, pin: "x" }, { id: "8" }];
ok("turning it ON for someone stored false is sent as true",
  RE.fieldEdits(base, [{ id: "7", canClockInOut: true, pin: "x" }, { id: "8" }], RE.SETTINGS_FIELDS), [{ id: "7", fields: { canClockInOut: true } }]);
ok("turning it OFF for someone with no stored value is sent as false",
  RE.fieldEdits(base, [{ id: "7", canClockInOut: false, pin: "x" }, { id: "8", canClockInOut: false }], RE.PERMISSION_FIELDS), [{ id: "8", fields: { canClockInOut: false } }]);

// ── 2. The server keeps it ─────────────────────────────────────────────────
console.log("\n2. POST /people?action=fields (real handler)");
const KEY = "orgs/TESTORG/people.json";
const seed = (auth) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [KEY]: [{ id: "1", name: "Ada", userRole: "admin" }, { id: "7", name: "Wendy", userRole: "user", canClockInOut: false }] };
  globalThis.__AUTH = { ...auth };
};
const ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x", orgCode: "TESTORG" };
const NO_TEAM = { personId: "1", isAdmin: true, adminPerms: { manageTeam: false }, email: "a@x", orgCode: "TESTORG" };
const post = (edits) => peopleFn({ httpMethod: "POST", headers: {}, queryStringParameters: { action: "fields" }, body: JSON.stringify({ edits }) });
const wendy = () => globalThis.__S3[KEY].find(p => p.id === "7");
seed(ADMIN);
{ const r = await post([{ id: "7", fields: { canClockInOut: true } }]);
  ok("an admin with manageTeam turns it on, and it is stored", [r.statusCode, wendy().canClockInOut], [200, true]); }
seed(ADMIN);
{ await post([{ id: "7", fields: { canClockInOut: true } }]); await post([{ id: "7", fields: { canClockInOut: false } }]);
  ok("...and off again", wendy().canClockInOut, false); }
seed(NO_TEAM);
{ const r = await post([{ id: "7", fields: { canClockInOut: true } }]);
  ok("without manageTeam: refused, unchanged", [r.statusCode, wendy().canClockInOut], [403, false]); }

// ── 3. The controls, beside the PIN ────────────────────────────────────────
console.log("\n3. The toggle sits beside the PIN on both screens");
// LF, as every literal below is: on a CRLF checkout "\n  };\n" never matches (#376).
const RAW = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (from, to) => {
  const a = RAW.indexOf(from), b = RAW.indexOf(to, a + 1);
  if (a < 0 || b < 0 || RAW.indexOf(from, a + 1) >= 0) { console.error(`anchor not unique: ${from}`); process.exit(2); }
  return RAW.slice(a, b);
};
const tcList = between('sRow("Clock-in PINs"', "</div>)}");
ok("Time Clock: each PIN row renders the PIN", /sPin\(p, updDraftPerson\)/.test(tcList), true);
ok("...and the clock-in toggle beside it, reading the opt-out default", /sClockIn\(p, updDraftPerson\)/.test(tcList), true);
const userRow = between('sRow("Clock-in", ', "</>)}");
ok("Users page: the person's Clock-in row has the PIN", /sPin\(person, updDraftPerson\)/.test(userRow), true);
ok("...and the toggle", /sClockIn\(person, updDraftPerson\)/.test(userRow), true);
const helper = between("const sClockIn = (p, upd) =>", "\n  };\n");
ok("the toggle reads canClockInOut !== false (absent means allowed, as the server does)", /p\.canClockInOut !== false/.test(helper), true);
ok("...and writes an explicit boolean", /upd\(p\.id, \{ canClockInOut: !on \}\)/.test(helper), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
