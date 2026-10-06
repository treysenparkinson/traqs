// #349 — approved PTO never reached the schedule, because the roster POST lost it.
//
//   node scripts/timeoff-ownership-test.mjs
//
// Approving a request writes an entry (linked by `reqId`) into person.timeOff. Every one
// written before 2026-10-05 was later removed by a full-roster POST, found by bisecting
// the S3 versions of people.json:
//   * Jul 21 and Jul 31 (both of Heston's): an authenticated GET failed auth (the /userinfo
//     429 burst fixed in 22458c4), fell back to the public projection — no timeOff, no
//     pushToken — and the admin client autosaved that roster as complete. One write took
//     every timeOff key and every push token on the team.
//   * Aug 12 (Treysen's): an iOS roster save round-tripped the entry without `reqId`.
//
// 1–3 run the REAL people.js on an in-memory S3 with conditional writes; 4 the real GET;
// 5 the real src/api.js against a fake fetch; 6 the shared leave rule and its callers.
import { register } from "module";
import { readFileSync } from "node:fs";
register("./itest-loader-real-timestamps.mjs", import.meta.url);

let peopleFn;
try { peopleFn = (await import(new URL("../netlify/functions/people.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load people.js:", e); process.exit(2); }

const KEY = "orgs/TESTORG/people.json";
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const section = async (title, fn) => {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { console.log(`  FAIL  section threw: ${e?.message || e}`); fail++; }
};

const ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const OLD = "2026-09-30T10:00:00.000Z";
const LINKED = { start: "2099-10-05", end: "2099-10-09", type: "PTO", reason: "", reqId: "rq1" };
const MANUAL = { start: "2099-11-02", end: "2099-11-02", type: "UTO", reason: "dentist" };
const seed = () => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null; globalThis.__AUTH_FAIL = null;
  globalThis.__S3 = { [KEY]: [
    { id: 1, name: "Admin", userRole: "admin", email: "a@x", lastModifiedAt: OLD },
    { id: 5, name: "Heston", userRole: "user", pushToken: "tok5", pin: "1234", timeOff: [LINKED, MANUAL], lastModifiedAt: OLD },
    { id: 7, name: "Max", userRole: "user", timeOff: [], lastModifiedAt: OLD },
  ] };
  globalThis.__AUTH = { ...ADMIN };
};
const roster = () => JSON.parse(JSON.stringify(globalThis.__S3[KEY]));
const stored = (id) => globalThis.__S3[KEY].find(p => p.id === id);
const offOf = (id) => (stored(id)?.timeOff || []).map(t => `${t.start}..${t.end}${t.reqId ? "#" + t.reqId : ""}`);
const post = (arr) => peopleFn({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(arr) });
const withHeston = (fn) => roster().map(p => (p.id === 5 ? fn(p) : p));

// What the public GET hands back: no pin, pushToken or timeOff, plus a hasPin flag.
const publicShape = (arr) => arr.map(({ pin, pushToken: _pt, timeOff: _to, ...rest }) => ({ ...rest, hasPin: !!pin }));

await section("1. A missing field is not a cleared field", async () => {
  seed();
  const res = await post(publicShape(roster()));
  ok("the public-shaped roster POST is accepted", res.statusCode, 200);
  ok("Heston keeps the approved entry and the manual one", offOf(5), ["2099-10-05..2099-10-09#rq1", "2099-11-02..2099-11-02"]);
  ok("Max keeps his (empty) timeOff key", "timeOff" in stored(7), true);
  ok("control: push token still pinned", stored(5).pushToken, "tok5");
});

await section("2. The server owns request-backed entries; manual ones are the admin's", async () => {
  seed();
  await post(withHeston(p => ({ ...p, timeOff: p.timeOff.filter(t => !t.reqId) })));
  // Order carries no meaning in timeOff; a restored entry is appended.
  ok("dropping the linked entry from the roster does not remove it", offOf(5).sort(), ["2099-10-05..2099-10-09#rq1", "2099-11-02..2099-11-02"]);
  seed();
  await post(withHeston(p => ({ ...p, timeOff: p.timeOff.map(t => (t.reqId ? { ...t, end: "2099-10-20" } : t)) })));
  ok("editing the linked entry's dates through the roster is ignored", offOf(5), ["2099-10-05..2099-10-09#rq1", "2099-11-02..2099-11-02"]);
  seed();
  await post(withHeston(p => ({ ...p, timeOff: p.timeOff.map(({ reqId: _r, ...t }) => t) })));
  ok("an iOS-shaped copy (no reqId) is not duplicated, and gets its reqId back", offOf(5), ["2099-10-05..2099-10-09#rq1", "2099-11-02..2099-11-02"]);
  seed();
  await post(withHeston(p => ({ ...p, timeOff: [...p.timeOff, { start: "2099-12-01", end: "2099-12-03", type: "PTO", reqId: "forged" }] })));
  ok("an entry claiming a reqId the server never wrote is dropped", offOf(5), ["2099-10-05..2099-10-09#rq1", "2099-11-02..2099-11-02"]);
  seed();
  await post(withHeston(p => ({ ...p, timeOff: [...p.timeOff, { start: "2099-12-01", end: "2099-12-01", type: "PTO", reason: "" }] })));
  ok("a manual entry can be added", offOf(5), ["2099-10-05..2099-10-09#rq1", "2099-11-02..2099-11-02", "2099-12-01..2099-12-01"]);
  seed();
  await post(withHeston(p => ({ ...p, timeOff: p.timeOff.filter(t => t.reqId) })));
  ok("a manual entry can be removed", offOf(5), ["2099-10-05..2099-10-09#rq1"]);
  seed();
  await post(withHeston(p => ({ ...p, timeOff: p.timeOff.map(t => (t.reqId ? t : { ...t, end: "2099-11-03" })) })));
  ok("a manual entry can be edited", offOf(5), ["2099-10-05..2099-10-09#rq1", "2099-11-02..2099-11-03"]);
  seed();
  await post(withHeston(p => ({ ...p, timeOff: [] })));
  ok("an explicit [] clears the manual entries and keeps the linked one", offOf(5), ["2099-10-05..2099-10-09#rq1"]);
  seed();
  await post([...roster(), { id: 9, name: "New", userRole: "user", timeOff: [{ ...LINKED, reqId: "rq1" }, MANUAL] }]);
  ok("a new person cannot arrive carrying someone's reqId", (stored(9)?.timeOff || []).map(t => t.reqId || "manual"), ["manual"]);
});

await section("3. An approval landing inside the POST's read-modify-write survives it", async () => {
  seed();
  const before = roster();
  let fired = false;
  globalThis.__BEFORE_WRITE = async (key) => {
    if (fired || key !== KEY) return;
    fired = true;
    // timeoff.js approve: Max's request rq2 lands between the POST's read and its write.
    globalThis.__S3[KEY] = globalThis.__S3[KEY].map(p => (p.id === 7 ? { ...p, timeOff: [{ start: "2099-10-12", end: "2099-10-12", type: "PTO", reason: "", reqId: "rq2" }] } : p));
    globalThis.__ETAGS[KEY] = String(Number(globalThis.__ETAGS[KEY] ?? 0) + 1);
  };
  const res = await post(before);
  ok("the POST still succeeds", res.statusCode, 200);
  ok("the write went through the conditional path (the hook ran)", fired, true);
  ok("Max's freshly approved entry is still there", offOf(7), ["2099-10-12..2099-10-12#rq2"]);
});

await section("4. The roster GET never silently downgrades a caller who tried to authenticate", async () => {
  const get = (headers) => peopleFn({ httpMethod: "GET", headers, queryStringParameters: {} });
  const projection = (r) => (r.headers || {})["X-People-Projection"] || null;
  seed(); globalThis.__AUTH_FAIL = { status: 401, message: "jwt expired" };
  let r = await get({ authorization: "Bearer stale" });
  ok("token present, auth fails (401) → 401, not a reduced roster", r.statusCode, 401);
  seed(); globalThis.__AUTH_FAIL = { status: 503, message: "Identity provider temporarily unavailable" };
  r = await get({ authorization: "Bearer t" });
  ok("token present, identity provider rate-limited (503) → 503", r.statusCode, 503);
  seed(); globalThis.__AUTH_FAIL = { status: 401, message: "Missing or malformed Authorization header" };
  r = await get({});
  const rows = Array.isArray(r.body) ? r.body : JSON.parse(r.body || "[]");
  ok("no token (the kiosk) → 200 with the public projection", r.statusCode, 200);
  ok("…marked as the public projection", projection(r), "public");
  ok("…without pin, pushToken or timeOff", rows.some(p => "pin" in p || "pushToken" in p || "timeOff" in p), false);
  seed();
  r = await get({ authorization: "Bearer t" });
  ok("a member's roster is not marked", projection(r), null);
});

await section("5. The app refuses a public roster where it asked for the full one", async () => {
  const api = await import(new URL("../src/api.js", import.meta.url).href);
  const realFetch = globalThis.fetch;
  const reply = (projection) => async () => new Response(JSON.stringify([{ id: 1, name: "A" }]), {
    status: 200, headers: projection ? { "X-People-Projection": projection } : {},
  });
  try {
    globalThis.fetch = reply("public");
    let threw = null;
    try { await api.fetchPeople(async () => "tok", "TESTORG"); } catch (e) { threw = e?.message || String(e); }
    ok("fetchPeople with a token throws on a public projection", threw != null && /public/i.test(threw), true);
    globalThis.fetch = reply("public");
    ok("the kiosk's fetchPeople (no token) still takes it", (await api.fetchPeople(null, "TESTORG")).length, 1);
    globalThis.fetch = reply(null);
    ok("control: a full roster is returned as before", (await api.fetchPeople(async () => "tok", "TESTORG")).length, 1);
  } finally { globalThis.fetch = realFetch; }
});

await section("6. One leave rule, and it reads the entry's status", async () => {
  const L = await import(new URL("../src/timeOff.js", import.meta.url).href);
  const denied = { start: "2099-10-05", end: "2099-10-09", type: "PTO", status: "denied" };
  const cancelled = { ...denied, status: "cancelled" };
  const approved = { ...denied, status: "approved" };
  const legacy = { start: "2099-10-05", end: "2099-10-09", type: "PTO" };
  ok("countsAsLeave: approved, legacy (no status) yes; denied, cancelled, pending no",
    [approved, legacy, denied, cancelled, { ...denied, status: "pending" }].map(L.countsAsLeave), [true, true, false, false, false]);
  ok("leaveOn finds the covering entry and skips denied ones",
    [L.leaveOn([denied, legacy], "2099-10-06")?.type, L.leaveOn([denied], "2099-10-06"), L.leaveOn([legacy], "2099-10-10")], ["PTO", null, null]);

  const O = await import(new URL("../src/overlapRules.js", import.meta.url).href);
  const ctx = O.overlapContext({ workStart: "08:00", workEnd: "17:00", breaks: [], lunch: { time: "12:00", durationMinutes: 60 } }, null);
  const free = (timeOff) => O.schedulerAvailability([], ctx, { people: [{ id: 7, timeOff }] }).free(7, "2099-10-06", "2099-10-06");
  ok("schedulerAvailability: a denied entry does not block, an approved one does", [free([denied]), free([approved]), free([legacy])], [true, false, false]);

  const D = await import(new URL("../src/dragMove.js", import.meta.url).href);
  const X = { id: "X", title: "X", start: "2099-10-12", end: "2099-10-12", team: [7] };
  const mover = [{ id: "X", node: X, shareH: 2, isRecord: false, reassigned: false, from: X, to: { start: "2099-10-06", end: "2099-10-06", startHour: 9, endHour: 11, team: [7] } }];
  const refuse = (timeOff) => D.refuseDragMove(mover, { isLocked: () => false, isLive: () => false, isOverdue: () => false, timeOff: () => timeOff, business: false, people: [] })?.kind || null;
  ok("refuseDragMove: a denied entry does not refuse, an approved one does", [refuse([denied]), refuse([approved])], [null, "pto"]);

  // TRAQS.jsx is one component; its guards can only be checked by source. Every raw
  // date-range test against p.timeOff is gone, and the guards call the shared rule.
  // Editing code (delete by index, match by reqId) is not a leave check and stays.
  const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  ok("TRAQS.jsx imports the shared rule", /from "\.\/timeOff\.js"/.test(SRC), true);
  const rangeTests = SRC.match(/\.timeOff\s*\|\|\s*\[\]\)\s*\.(some|find|filter)\(\s*\(?\w+\)?\s*=>[^;\n]{0,80}?\.(start|end)\b/g) || [];
  const rawLoops = SRC.match(/for \(const \w+ of \(\w+\.timeOff \|\| \[\]\)\)/g) || [];
  ok("no raw .timeOff range tests remain in TRAQS.jsx", [...rangeTests, ...rawLoops], []);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
