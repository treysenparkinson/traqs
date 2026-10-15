// Team members are strings once stored — #411.
//
// The id cluster (#205-#208, #324) was measured latent: all live ids are strings. Nothing
// asserted it on the WRITE side, so one client POSTing `team: [99]` would revive it. tasks.js
// now stringifies membership ids on the way in, as #411 asked. Membership ONLY: node and
// person ids are referenced from other stores, and converting them would half-migrate a
// legacy numeric org — which is also why this suite asserts they are left alone.
//
// The pure function, then the REAL tasks.js on an in-memory S3.
//
//   node scripts/id-normalise-test.mjs
import { register } from "module";
register("./timeclock-itest-loader.mjs", import.meta.url);
const { stringifyTeams } = await import("../netlify/functions/_utils/normalize-ids.js");

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

console.log("\nthe normaliser");
{
  const tree = [{ id: 5, title: "J", team: [99, "7"], deps: [4], subs: [{ id: 51, team: [99], subs: [{ id: 511, team: [8, 9], deps: [51] }] }] }];
  const out = stringifyTeams(tree);
  ok("#411 a job's team becomes strings", out[0].team, ["99", "7"]);
  ok("#411 ...a panel's", out[0].subs[0].team, ["99"]);
  ok("#411 ...an op's", out[0].subs[0].subs[0].team, ["8", "9"]);
  ok("node ids and deps are LEFT ALONE (other stores reference them)", [out[0].id, out[0].deps, out[0].subs[0].id, out[0].subs[0].subs[0].deps], [5, [4], 51, [51]]);
  ok("the input is not mutated", tree[0].team, [99, "7"]);
  const clean = [{ id: "a", team: ["1"], subs: [{ id: "b", team: [] }] }];
  ok("an all-string tree comes back as the SAME array (nothing to re-stamp)", stringifyTeams(clean) === clean, true);
  ok("...and the same node objects", stringifyTeams(clean)[0] === clean[0], true);
  ok("a null team passes through", stringifyTeams([{ id: "x", team: null }])[0].team, null);
}

console.log("\nPOST /tasks");
const tasksFn = (await import(new URL("../netlify/functions/tasks.js", import.meta.url).href)).handler;
const KEY = "orgs/TESTORG/tasks.json";
const reset = (stored) => {
  globalThis.__S3 = { [KEY]: JSON.parse(JSON.stringify(stored)) };
  globalThis.__WRITES = []; globalThis.__ETAGS = {};
  globalThis.__AUTH = { personId: "1", isAdmin: true, email: "a@x.com" };
};
const post = (body) => tasksFn({ httpMethod: "POST", headers: {}, queryStringParameters: {}, body: JSON.stringify(body) });
const stored = () => globalThis.__S3[KEY];
reset([{ id: "j1", title: "One", team: ["1"], subs: [] }]);
{
  const res = await post([{ id: "j1", title: "One", team: ["1"], subs: [] }, { id: "j2", title: "Two", team: [99], subs: [{ id: "p1", team: [99], subs: [] }] }]);
  const two = stored().find(j => j.id === "j2");
  ok("#411 a bare-array POST with numeric team members is stored with strings", [res.statusCode, two?.team, two?.subs?.[0]?.team], [200, ["99"], ["99"]]);
}
reset([{ id: "j1", title: "One", team: ["1"], subs: [] }]);
{
  const res = await post({ upsert: [{ id: "j1", title: "One", team: [7], subs: [] }], delete: [] });
  ok("#411 ...and so is a delta's upsert", [res.statusCode, stored().find(j => j.id === "j1").team], [200, ["7"]]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
