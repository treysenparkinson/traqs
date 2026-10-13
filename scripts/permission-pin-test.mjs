// #522 / #525 — A ROSTER SAVE MAY NOT DROP A STORED PERMISSION KEY.
//
// An old iOS build models nine of the server's eleven permission keys, so any roster
// POST it makes — a Team-screen edit, or the push-token fallback firing on a network
// blip (#525) — arrives without `manageTimeclock` and `confirmTimesheet`. Since #295 an
// absent key is NOT granted, so storing that record revoked both. The iOS fix (#522)
// reaches only phones that install it; this pin closes it for every build, now.
//
// THE RULE: for an ADMIN record that stays an admin, a key the stored permissions carry
// and the incoming record omits is kept as stored; and an admin record arriving with no
// `adminPerms` at all keeps the stored object rather than becoming unrestricted. An
// explicit value always wins — the web writes the complete set (`fullPerms`), so a real
// toggle is never an omission. Demotion (userRole → user) is not pinned.
//
//   node scripts/permission-pin-test.mjs
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
const TEAM_ADMIN = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
const OLD = "2026-09-30T10:00:00.000Z";
const ELEVEN = {
  editJobs: true, moveJobs: true, reassign: true, manageTeam: true, manageClients: true,
  undoHistory: true, orgSettings: true, approveCompletions: true, approveTimeOff: true,
  manageTimeclock: true, confirmTimesheet: true,
};
// What an old iOS build sends back: the nine keys it models.
const { manageTimeclock: _mt, confirmTimesheet: _ct, ...NINE } = ELEVEN;

const seed = () => {
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [KEY]: [
    { id: "1", name: "Owner", userRole: "admin", lastModifiedAt: OLD },
    { id: "4", name: "Kevin", userRole: "admin", adminPerms: { ...ELEVEN }, lastModifiedAt: OLD },
    { id: "7", name: "Wendy", userRole: "user", lastModifiedAt: OLD },
  ] };
  globalThis.__AUTH = { ...TEAM_ADMIN };
};
const stored = (id) => JSON.parse(JSON.stringify(globalThis.__S3[KEY])).find((p) => String(p.id) === id);
const post = (arr) => peopleFn({ httpMethod: "POST", headers: {}, body: JSON.stringify(arr) });
const base = () => JSON.parse(JSON.stringify(globalThis.__S3[KEY]));
const withKevin = (patch) => base().map((p) => (p.id === "4" ? { ...p, ...patch } : p));

console.log("\n1. AN OLD iOS SAVE (nine keys) DOES NOT REVOKE THE OTHER TWO");
{
  seed();
  const r = await post(withKevin({ adminPerms: { ...NINE } }));
  ok("the save succeeds", r.statusCode, 200);
  ok("manageTimeclock is still granted", stored("4").adminPerms.manageTimeclock, true);
  ok("confirmTimesheet is still granted", stored("4").adminPerms.confirmTimesheet, true);
  ok("the nine it sent are stored as sent", stored("4").adminPerms.editJobs, true);
}

console.log("\n2. AN ADMIN ARRIVING WITH NO adminPerms DOES NOT BECOME UNRESTRICTED");
{
  seed();
  const sent = withKevin({}); delete sent.find((p) => p.id === "4").adminPerms;
  await post(sent);
  ok("the stored permissions are kept", stored("4").adminPerms, ELEVEN);
}

console.log("\n3. AN EXPLICIT VALUE STILL WINS — the web writes the full set");
{
  seed();
  await post(withKevin({ adminPerms: { ...ELEVEN, manageTimeclock: false } }));
  ok("a toggle to false is stored", stored("4").adminPerms.manageTimeclock, false);
  ok("...and nothing else moved", stored("4").adminPerms.confirmTimesheet, true);
}

console.log("\n4. DEMOTION IS NOT PINNED");
{
  seed();
  const sent = withKevin({ userRole: "user" }); delete sent.find((p) => p.id === "4").adminPerms;
  await post(sent);
  ok("demoted", stored("4").userRole, "user");
  ok("...and the permissions go with it", stored("4").adminPerms, undefined);
}

console.log("\n5. A NON-ADMIN RECORD IS UNTOUCHED");
{
  seed();
  await post(base());
  ok("Wendy has no permissions object", stored("7").adminPerms, undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
