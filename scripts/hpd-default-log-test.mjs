// Old iOS builds writing 7.5 over "no estimate" — SCHEDULE_MAP #301.
//
//   node scripts/hpd-default-log-test.mjs
//
// iOS builds before 88e1ce6 decode an absent or null hpd as 7.5 and write it back
// on every whole-array save, turning every unestimated unit in the org into 7.5.
// The server can't tell that default from someone typing 7.5, and it can't tell
// an old build from a new one (every build so far reported the same build number),
// so refusing would lock old builds out of saving. It LOGS instead: a stored unit
// with no hpd that arrives as exactly 7.5 gets one "hpd-default-write" line with
// the unit, the caller and the User-Agent. The write itself is accepted as before.
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);

let tasksFn;
try { tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler; }
catch (e) { console.error("could not load tasks.js:", e); process.exit(2); }

const K = { tasks: "orgs/TESTORG/tasks.json", people: "orgs/TESTORG/people.json", settings: "orgs/TESTORG/settings.json" };
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
let logs = [];
const realWarn = console.warn;
console.warn = (...a) => {
  if (typeof a[0] === "string" && a[0].startsWith("{")) { try { const o = JSON.parse(a[0]); if (o.tag) { logs.push(o); return; } } catch {} }
  realWarn(...a);
};
const UA = "TRAQS%20Scheduling/1 CFNetwork/3826 Darwin/25.0.0";
const tree = () => [{ id: "J", title: "Job", subs: [{ id: "P", title: "Panel", hpd: null, subs: [
  { id: "ABSENT", title: "No estimate", team: [7] },
  { id: "NULL", title: "Null estimate", hpd: null, team: [7] },
  { id: "EST", title: "Estimated", hpd: 4, team: [7] },
] }] }];
const seed = () => {
  process.env.SCHEDULE_RULES_MODE = "off"; process.env.TASK_CONFLICT_MODE = "off"; delete process.env.PERMISSION_GATES_MODE;
  logs = [];
  globalThis.__WRITES = []; globalThis.__ETAGS = {}; globalThis.__BEFORE_WRITE = null;
  globalThis.__S3 = { [K.tasks]: tree(), [K.people]: [{ id: 1, userRole: "admin" }], [K.settings]: {} };
  globalThis.__AUTH = { personId: "1", isAdmin: true, adminPerms: null, email: "a@x" };
};
const post = (t) => tasksFn({ httpMethod: "POST", headers: { "user-agent": UA }, queryStringParameters: {}, body: JSON.stringify(t) });
const node = (t, id) => t[0].subs[0].id === id ? t[0].subs[0] : t[0].subs[0].subs.find(o => o.id === id);
const defaults = () => logs.filter(l => l.tag === "hpd-default-write").map(l => [l.id, l.personId, l.userAgent]).sort();

seed();
{
  // What an old iOS build sends: every unit it decoded without an estimate now carries 7.5.
  const t = tree(); node(t, "ABSENT").hpd = 7.5; node(t, "NULL").hpd = 7.5; node(t, "P").hpd = 7.5;
  const res = await post(t);
  ok("the write is accepted as before", [res.statusCode, node(globalThis.__S3[K.tasks], "ABSENT").hpd], [200, 7.5]);
  ok("each unestimated unit that arrives as 7.5 is logged once, with caller and User-Agent", defaults(),
     [["ABSENT", "1", UA], ["NULL", "1", UA], ["P", "1", UA]]);
}
seed();
{
  const t = tree(); node(t, "EST").hpd = 7.5;
  await post(t);
  ok("control: an estimated unit changed to 7.5 is not logged", defaults(), []);
}
seed();
{
  const t = tree(); node(t, "ABSENT").hpd = 6;
  await post(t);
  ok("control: an unestimated unit given another value is not logged", defaults(), []);
}
seed();
{
  const t = tree(); t[0].subs[0].subs.push({ id: "NEW", title: "New", hpd: 7.5, team: [7] });
  await post(t);
  ok("control: a new unit created at 7.5 is not logged", defaults(), []);
}
seed();
{
  await post(tree());
  ok("control: an unchanged save logs nothing", defaults(), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
