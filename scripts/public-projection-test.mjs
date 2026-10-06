// #385 — THE UNAUTHENTICATED /people PROJECTION IS A DENY-LIST, AND THAT IS THE
// DEFECT.
//
// `GET /people` stays open so the kiosk can draw the team-select roster before
// anyone signs in. It dropped `pin`, `pushToken` and `timeOff` and returned
// EVERYTHING ELSE. Measured on MTX2026TRAQS with nothing but the org code — 18
// live people, 21 populated fields:
//
//     email 18   cap 18   role 18   color 18   userRole 18   department 18
//     canClockInOut 17   isEngineer 16   noAutoSchedule 10   payType 10
//     canSignOff 9   adminPerms 4   phone 3   image 2   activeClockIn 2
//
// A deny-list fails OPEN. And these were NOT fields that arrived after it was
// written: `adminPerms`, `canSignOff`, `isEngineer` and `noAutoSchedule` all date
// from the initial commit (2026-02-26) and `payType` from 2026-03-20, while the
// deny-list is from 2026-06-15. Every one of them was already in the records; it
// denied three fields and let the rest through. Before that commit the GET was
// open with no projection at all beyond `pin`, so this roster has been readable
// with nothing but the org code SINCE THE KIOSK SHIPPED — and the kiosk prints
// that code on its own footer (App.jsx:1408).
//
// THE FIX IS AN EXPLICIT PICK, so a new field is private by default.
//
// WHAT THE KIOSK ACTUALLY READS, traced before cutting rather than assumed:
//   - the roster screen (App.jsx:1244-1300) reads id, name, color, department,
//     userRole, and derives a status pill from activeClockIn
//   - THE PIN-PAD FLOW READS NOTHING FROM THIS ENDPOINT. handlePinConfirm POSTs
//     { action: "identify", pin } to /timeclock and gets { name, personId,
//     activeClockIn } back; handleClockYes POSTs { action, personId, pin }. The
//     PIN is checked server-side and never leaves the person record.
//
// So the roster's status pill is the only thing that needed activeClockIn, and
// `clockStatusOf` computes it on the server instead — the same four values the
// kiosk derived for itself, without the timestamps, job ids or event log.
//
//   node scripts/public-projection-test.mjs
import { register } from "module";
register("./itest-loader-real-timestamps.mjs", import.meta.url);
import { PUBLIC_PERSON_FIELDS, publicPerson, clockStatusOf } from "../netlify/functions/_utils/public-person.js";
import { rateLimit, _resetRateLimit } from "../netlify/functions/_utils/rate-limit.js";

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

// One person carrying every field the live org has, so "what leaks" is measured
// against the real shape rather than a convenient one.
const FULL = {
  id: 7, name: "Wendy", color: "#10b981", department: "Shop", userRole: "user",
  email: "wendy@example.com", phone: "555-0101", payType: "hourly", cap: 40,
  role: "Fabricator", adminPerms: { editJobs: true }, canClockInOut: true,
  canSignOff: true, isEngineer: false, noAutoSchedule: true, image: "data:image/png;base64,AAAA",
  pin: "1234", pushToken: "tok-abc", timeOff: [{ start: "2026-11-02", end: "2026-11-06" }],
  activeClockIn: { startedAt: "2026-10-06T14:00:00.000Z", events: [] },
  activeJobClock: { opId: "OP1" }, activeBreak: { startedAt: "x" },
  lastModifiedAt: "2026-10-06T14:00:00.000Z",
};
// `seed(null)` is THE KIOSK: no token at all. The loader's requireOrgMember does
// `return { ...globalThis.__AUTH }`, and `{...null}` is `{}` — TRUTHY — so
// setting __AUTH to null does NOT simulate an anonymous caller, it simulates a
// member with no fields. My first version did exactly that and every public
// assertion failed against the member projection. __AUTH_FAIL is how the loader
// makes auth throw, which is what people.js swallows when no token was sent.
const seed = (auth) => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {};
  globalThis.__S3 = { [KEY]: [FULL] };
  globalThis.__AUTH = auth ? { ...auth } : null;
  globalThis.__AUTH_FAIL = auth ? null : { status: 401, message: "no token" };
};
const get = (headers = {}) => peopleFn({ httpMethod: "GET", headers, queryStringParameters: {} });
const bodyOf = (res) => (typeof res.body === "string" ? JSON.parse(res.body) : res.body);

console.log("\n1. THE PROPERTY — the public roster is an explicit PICK, not a deny-list");
{
  seed(null);
  const row = bodyOf(await get({}))[0];
  // THE assertion. Keys, exactly — not "these are absent", which is the deny-list
  // shape in a test and fails open the same way.
  ok("the public row carries exactly the allow-listed keys",
    Object.keys(row).sort(), [...PUBLIC_PERSON_FIELDS, "clockStatus"].sort());
  // Spelled out as well as derived, so a field quietly added to
  // PUBLIC_PERSON_FIELDS cannot make the assertion above agree with itself.
  ok("...and that list is literally these five, plus the computed status",
    [...PUBLIC_PERSON_FIELDS].sort(), ["color", "department", "id", "name", "userRole"]);
  ok("...with `status` deliberately NOT in it — no live record carries one",
    PUBLIC_PERSON_FIELDS.includes("status"), false);
  ok("...which is what the kiosk reads, and no more",
    [row.id, row.name, row.color, row.department, row.userRole], [7, "Wendy", "#10b981", "Shop", "user"]);
}

console.log("\n2. Every field #385 measured is gone");
{
  seed(null);
  const row = bodyOf(await get({}))[0];
  for (const f of ["email", "phone", "payType", "adminPerms", "cap", "role",
                   "canClockInOut", "canSignOff", "isEngineer", "noAutoSchedule",
                   "image", "pin", "hasPin", "pushToken", "timeOff",
                   "activeClockIn", "activeJobClock", "activeBreak", "lastModifiedAt"]) {
    ok(`${f} is not in the public roster`, f in row, false);
  }
}

console.log("\n3. A NEW field is private by default — the whole point of the pick");
{
  seed(null);
  globalThis.__S3[KEY] = [{ ...FULL, homeAddress: "12 Example St", ssnLast4: "0000" }];
  const row = bodyOf(await get({}))[0];
  ok("a field nobody thought to deny does not appear", "homeAddress" in row, false);
  ok("...nor the next one", "ssnLast4" in row, false);
  ok("...and the row is still exactly the allow-list",
    Object.keys(row).sort(), [...PUBLIC_PERSON_FIELDS, "clockStatus"].sort());
}

console.log("\n4. The MEMBER projection is untouched — this must not break the app");
{
  seed({ personId: "7", isAdmin: false, email: "w@x" });
  const row = bodyOf(await get({ authorization: "Bearer t" }))[0];
  ok("a member still gets timeOff, which scheduling needs", Array.isArray(row.timeOff), true);
  ok("...and email, payType and the permission flags", [row.email, row.payType, row.canSignOff],
    ["wendy@example.com", "hourly", true]);
  ok("...and hasPin rather than the PIN", [row.hasPin, "pin" in row], [true, false]);
  seed({ personId: "1", isAdmin: true, email: "a@x" });
  const arow = bodyOf(await get({ authorization: "Bearer t" }))[0];
  ok("an admin still gets the decrypted PIN for the reveal", typeof arow.pin, "string");
}

console.log("\n5. clockStatus — the kiosk's own getStatus, moved to the server");
{
  const ev = (...types) => ({ activeClockIn: { events: types.map(t => ({ type: t })) } });
  ok("no clock-in is offline", clockStatusOf({}), "offline");
  ok("clocked in with no events is online", clockStatusOf(ev()), "online");
  ok("an open lunch is lunch", clockStatusOf(ev("lunchStart")), "lunch");
  ok("a closed lunch is back online", clockStatusOf(ev("lunchStart", "lunchEnd")), "online");
  ok("an open break is break", clockStatusOf(ev("breakStart")), "break");
  ok("a closed break is back online", clockStatusOf(ev("breakStart", "breakEnd")), "online");
  ok("lunch outranks a closed break, as the kiosk had it",
    clockStatusOf(ev("breakStart", "breakEnd", "lunchStart")), "lunch");
  // It must leak nothing beyond the four words.
  ok("the value is one of exactly four", ["offline", "online", "lunch", "break"].includes(clockStatusOf(ev("lunchStart"))), true);
  seed(null);
  const row = bodyOf(await get({}))[0];
  ok("and the public row carries it instead of activeClockIn", row.clockStatus, "online");
}

console.log("\n6. The projection header still says it is reduced");
{
  seed(null);
  const res = await get({});
  ok("X-People-Projection: public is still set", res.headers?.["X-People-Projection"], "public");
}

console.log("\n7. Rate limiting");
{
  _resetRateLimit();
  const hit = (ip) => rateLimit({ key: `people:${ip}`, limit: 3, windowMs: 1000, now: 1000 });
  ok("the first three are allowed", [hit("1.1.1.1").ok, hit("1.1.1.1").ok, hit("1.1.1.1").ok], [true, true, true]);
  ok("the fourth is refused", hit("1.1.1.1").ok, false);
  ok("...and says how long to wait", hit("1.1.1.1").retryAfter > 0, true);
  ok("a different caller is unaffected", hit("2.2.2.2").ok, true);
  // A fixed window, so the next window starts clean.
  ok("the window resets", rateLimit({ key: "people:1.1.1.1", limit: 3, windowMs: 1000, now: 2001 }).ok, true);
  _resetRateLimit();
  ok("keys are independent", [rateLimit({ key: "a", limit: 1, windowMs: 1000, now: 0 }).ok,
                              rateLimit({ key: "b", limit: 1, windowMs: 1000, now: 0 }).ok], [true, true]);
  ok("...and each still has its own ceiling", rateLimit({ key: "a", limit: 1, windowMs: 1000, now: 0 }).ok, false);
}

console.log("\n8. The endpoints are wired, and only the UNAUTHENTICATED path is limited");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const P = codeOf(readFileSync(new URL("../netlify/functions/people.js", import.meta.url), "utf8"));
  const O = codeOf(readFileSync(new URL("../netlify/functions/org.js", import.meta.url), "utf8"));
  ok("people.js uses the allow-list projection", /publicPerson\(/.test(P), true);
  ok("...and no longer destructures a deny-list", /pushToken: _pt, timeOff: _to/.test(P), false);
  ok("people.js rate-limits", /rateLimit\(/.test(P), true);
  ok("org.js rate-limits", /rateLimit\(/.test(O), true);
  // A member must never be throttled by the kiosk's budget: the app polls.
  ok("the limit is applied only when there is no member", /if \(!isMember\)[\s\S]{0,200}?rateLimit\(/.test(P), true);

  // THE CLIENT READS THAT SURVIVED THE CUT, asserted because dropping a field the
  // app needs is the way this change breaks people rather than protects them.
  const A = codeOf(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"));
  ok("the kiosk status pill reads the server-computed value", /if \(person\.clockStatus\) return person\.clockStatus;/.test(A), true);
  ok("...and still derives locally for the authenticated roster", /if \(!person\.activeClockIn\) return "offline";/.test(A), true);
  // The one that would have locked everybody out: `inRoster` scanned the roster
  // for your own email, and the public roster no longer carries it.
  ok("membership is read from the server, not scanned out of the roster",
    /const inRoster = orgConfig\.isMember !== false;/.test(A), true);
  ok("...and the email scan is gone", /roster\.some\(p => p\.email/.test(A), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
