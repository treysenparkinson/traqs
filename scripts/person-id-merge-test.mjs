// #384/#349 — ONE DEFECT, seen from two ends. A person whose id changes TYPE
// between the stored roster and the POST matches nothing, so every preserve in
// people.js's merge is skipped at once.
//
// THE REAL WRITE, isolated from S3's version history:
//
//   21:26:10   Trey id=99  (number)  PIN     Max id=100  (number)  PIN
//   21:26:28   Trey id="99" (string) NONE    Max id="100" (string) NONE
//
// A client normalised two numeric ids to strings. `existingMap` was built as
// `new Map(existing.map(p => [p.id, p]))` and read as `existingMap.get(p.id)` —
// the RAW id — so `stored` came back undefined for exactly those two records.
//
// #349 WAS THE SAME WRITE FROM THE OTHER END. It was filed as "a missing field
// is not a cleared field" and fixed with `mergeTimeOff`, so an absent `timeOff`
// preserves and only an explicit `[]` clears. That fix reads the SAME MAP, so it
// never covered the records that find no stored copy at all. Two entries, one
// write, one lookup.
//
// EVERY PRESERVE IS GATED ON THAT ONE LOOKUP, which is why a single id-type
// change takes all of them together:
//
//   stored?.pin && !pIn.pin                      the PIN
//   mergeTimeOff(stored, …)                      approved time off
//   if (stored) … serverOwnedPersonFields(stored) pushToken, activeClockIn,
//                                                 activeJobClock, activeBreak
//
// That is why the write that dropped two PINs is also the write that stripped
// `reqId` from Treysen's PTO. It was never two bugs.
//
// The fix is what `reconcileDeletions` in `_utils/timestamps.js` already does to
// the same array: compare ids as strings. The two disagreed, and the one that
// did it correctly was the one nobody had filed a bug against.
//
//   node scripts/person-id-merge-test.mjs
import { register } from "module";
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
const ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const OLD = "2026-09-30T10:00:00.000Z";

// The roster as it stood at 21:26:10: two numeric ids among the token ids, both
// carrying a PIN, with the server-owned fields and an approved PTO entry on one
// of them — everything a real record holds that the merge is supposed to keep.
const seed = () => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [KEY]: [
    { id: 1, name: "Admin", userRole: "admin", lastModifiedAt: OLD },
    { id: 99, name: "Trey", userRole: "admin", pin: "1111", pushToken: "tok-trey",
      activeClockIn: { at: "2026-09-30T08:00:00.000Z" }, activeJobClock: null, activeBreak: null,
      timeOff: [{ reqId: "r1", start: "2026-10-01", end: "2026-10-02", status: "approved" }],
      lastModifiedAt: OLD },
    { id: 100, name: "Max", userRole: "user", pin: "2222", pushToken: "tok-max", lastModifiedAt: OLD },
    { id: "t0gnvtljt", name: "Draven", userRole: "user", pin: "3333", lastModifiedAt: OLD },
  ] };
  globalThis.__AUTH = { ...ADMIN };
};
const stored = (id) => globalThis.__S3[KEY].find(p => String(p.id) === String(id));
const post = (arr) => peopleFn({ httpMethod: "POST", headers: {}, body: JSON.stringify(arr) });
// What iOS sends: the same roster with every id decoded as a String, and without
// the fields the client never holds (pin is stripped from its GET; the clock
// fields and pushToken belong to the server).
const asIosRoster = () => globalThis.__S3[KEY].map(p => {
  const { pin: _p, pushToken: _t, activeClockIn: _c, activeJobClock: _j, activeBreak: _b, timeOff: _o, ...rest } = p;
  return { ...rest, id: String(p.id) };
});

console.log("\n1. RED PROOF — the 2026-08-12 write, replayed");
{
  seed();
  const res = await post(asIosRoster());
  ok("the POST succeeds, exactly as it did on the day", res.statusCode, 200);
  ok("Trey's PIN survives the id becoming a string", stored(99)?.pin != null, true);
  ok("...and Max's", stored(100)?.pin != null, true);
  ok("...and the token id was never at risk", stored("t0gnvtljt")?.pin != null, true);
  ok("no live person lost a PIN",
    globalThis.__S3[KEY].filter(p => !p.deletedAt && !p.pin).map(p => p.name), ["Admin"]);
  // The id itself is allowed to be rewritten as a string — that is the client
  // normalising, not a defect. What must not happen is losing the record's state.
  ok("the roster is still four people, none duplicated",
    globalThis.__S3[KEY].filter(p => !p.deletedAt).length, 4);
  ok("...and nobody was tombstoned as missing",
    globalThis.__S3[KEY].filter(p => p.deletedAt).length, 0);
}

console.log("\n2. THE OTHER PRESERVES THE SAME LOOKUP GATES");
{
  seed();
  await post(asIosRoster());
  // #349's half. The client never had timeOff, so absence must preserve — but
  // that only works if the stored record is FOUND.
  ok("the approved PTO survives (this is #349, same write)",
    stored(99)?.timeOff?.[0]?.reqId, "r1");
  // serverOwnedPersonFields — skipped entirely when `stored` is undefined.
  ok("the push token survives", stored(99)?.pushToken, "tok-trey");
  ok("...on both numeric records", stored(100)?.pushToken, "tok-max");
  ok("the active clock survives", stored(99)?.activeClockIn?.at, "2026-09-30T08:00:00.000Z");
}

console.log("\n3. THE MIRROR — a client that sends numbers where strings are stored");
{
  // Android declares `val id: Int = 0` (#442). The fix has to be symmetric, or
  // it only protects against the client that happened to cause the incident.
  seed();
  globalThis.__S3[KEY] = globalThis.__S3[KEY].map(p => ({ ...p, id: String(p.id) }));
  const numeric = globalThis.__S3[KEY].map(p => {
    const { pin: _p, pushToken: _t, ...rest } = p;
    return { ...rest, id: /^\d+$/.test(p.id) ? Number(p.id) : p.id };
  });
  const res = await post(numeric);
  ok("the POST succeeds", res.statusCode, 200);
  ok("a stored string id matched by an incoming number keeps its PIN",
    stored("99")?.pin != null, true);
  ok("...and its push token", stored("99")?.pushToken, "tok-trey");
  ok("...and nobody was tombstoned", globalThis.__S3[KEY].filter(p => p.deletedAt).length, 0);
}

console.log("\n4. THE MERGE AND THE DELETION RECONCILER NOW AGREE");
{
  // They disagreed: reconcileDeletions compared `String(rec.id)` while the merge
  // compared raw. That is what let one write both KEEP a record (the reconciler
  // matched it) and STRIP it (the merge did not).
  seed();
  await post(asIosRoster());
  ok("a record matched by the reconciler is also matched by the merge",
    globalThis.__S3[KEY].filter(p => !p.deletedAt).length, 4);

  // And removal still works for an admin, by id, across a type change — or the
  // fix would have made people undeletable from a client that normalises.
  seed();
  const minusMax = asIosRoster().filter(p => p.id !== "100");
  await post(minusMax);
  ok("leaving a numeric-id person out still tombstones them", !!stored(100)?.deletedAt, true);
  ok("...and the tombstone still drops their PIN", stored(100)?.pin ?? null, null);
  ok("...while everyone else is untouched", stored(99)?.pin != null, true);
}

console.log("\n5. A CHANGED PIN STILL WINS, AND AN ABSENT ONE STILL PRESERVES");
{
  // The preserve must not become "the server always wins" — a user changing
  // their own PIN has to work. That rule is unchanged; only the lookup moved.
  seed();
  const r = asIosRoster().map(p => (p.id === "99" ? { ...p, pin: "9999" } : p));
  await post(r);
  ok("a PIN the client supplies replaces the stored one", stored(99)?.pin != null, true);
  ok("...and it is not the old value", stored(99)?.pin !== "1111", true);

  seed();
  await post(asIosRoster().map(p => (p.id === "99" ? { ...p, pin: "" } : p)));
  ok("an empty PIN still preserves rather than clearing", stored(99)?.pin != null, true);
}

console.log("\n6. THE SOURCE — both sides of the lookup, not one");
{
  const src = (await import("node:fs")).readFileSync(
    new URL("../netlify/functions/people.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  ok("the map is keyed by String(id)",
    /new Map\(existing\.map\(p => \[String\(p\.id\), p\]\)\)/.test(src), true);
  ok("...and every read of it is too",
    (src.match(/existingMap\.(get|has)\(String\(p\.id\)\)/g) || []).length,
    (src.match(/existingMap\.(get|has)\(/g) || []).length);
  ok("no raw-id lookup survives", /existingMap\.(get|has)\(p\.id\)/.test(src), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
