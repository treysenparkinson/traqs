#!/usr/bin/env node
// #414. What does add-vs-replace actually cost at Matrix?
//
// The tray holds ops/panels CREATED IN THE EDIT SESSION THAT JUST ENDED, and a
// card leaves the tray on its first drop. So the population to measure is not
// "all ops" — it is "ops as they look at the moment they are dropped", which is
// the moment they were created.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync("C:/Users/treysen/traqs-func/.env", "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(
  new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const td = await get(`orgs/${ORG}/tasks.json`);
const tasks = (Array.isArray(td) ? td : td.tasks || []).filter(j => j && !j.deletedAt);
// settings.json, NOT config.json: config holds the org identity (name,
// domain, admin emails) and has never held roles or statusOpts. Read from the
// wrong object these come back undefined and every question about them answers
// "not set", which is a false negative that looks like a finding.
const cfg = await get(`orgs/${ORG}/settings.json`).catch(() => ({}));

// Every panel and every op, flat, with its level.
const nodes = [];
for (const j of tasks) for (const p of j.subs || []) {
  nodes.push({ lvl: "panel", n: p, job: j });
  for (const o of p.subs || []) nodes.push({ lvl: "op", n: o, job: j });
}
const team = (n) => Array.isArray(n.team) ? n.team : [];

console.log(`ORG ${ORG}: ${tasks.length} live jobs, ${nodes.filter(x => x.lvl === "panel").length} panels, ${nodes.filter(x => x.lvl === "op").length} ops\n`);

// ── 1. THE PREMISE: do several people pile onto one item? ────────────────
const byCount = {};
for (const { n } of nodes) { const c = team(n).length; byCount[c] = (byCount[c] || 0) + 1; }
console.log("1. TEAM SIZE across every panel and op");
for (const k of Object.keys(byCount).sort((a, b) => a - b)) {
  console.log(`   ${k} ${k === "1" ? "person " : "people"}: ${byCount[k]}`);
}
const multi = nodes.filter(x => team(x.n).length > 1);
console.log(`   -> ${multi.length} of ${nodes.length} have MORE THAN ONE person `
  + `(${(100 * multi.length / nodes.length).toFixed(1)}%)`);

// ── 2. ID TYPE DRIFT inside a single team array ──────────────────────────
// `new Set([...team, personId])` dedupes by ===, so 7 and "7" both survive.
let mixedArr = 0, dupAcross = 0;
const dupExamples = [];
for (const { n, lvl, job } of nodes) {
  const t = team(n);
  const types = new Set(t.map(x => typeof x));
  if (types.size > 1) mixedArr++;
  const seen = new Map();
  for (const x of t) {
    const k = String(x);
    if (seen.has(k) && seen.get(k) !== x) {
      dupAcross++;
      if (dupExamples.length < 5) dupExamples.push(`${job.title || job.id} / ${lvl} ${n.title || n.id}: ${JSON.stringify(t)}`);
      break;
    }
    seen.set(k, x);
  }
}
console.log(`\n2. ID TYPE inside team arrays`);
console.log(`   arrays mixing string and number ids: ${mixedArr}`);
console.log(`   arrays ALREADY holding the same person twice under both types: ${dupAcross}`);
for (const e of dupExamples) console.log(`     ${e}`);

// What type are the ids on each side?
const pd = await get(`orgs/${ORG}/people.json`);
const people = (Array.isArray(pd) ? pd : pd.people || []).filter(p => p && !p.deletedAt);
const peopleTypes = {};
for (const p of people) peopleTypes[typeof p.id] = (peopleTypes[typeof p.id] || 0) + 1;
const memberTypes = {};
for (const { n } of nodes) for (const x of team(n)) memberTypes[typeof x] = (memberTypes[typeof x] || 0) + 1;
console.log(`   people.id types:      ${JSON.stringify(peopleTypes)}`);
console.log(`   team[] member types:  ${JSON.stringify(memberTypes)}`);

// ── 3. TEMPLATES — the one tray source that can carry a team ─────────────
const tpls = cfg.exportTemplates || cfg.templates || [];
let tplOps = 0, tplWithTeam = 0;
for (const t of tpls) for (const o of t.ops || []) {
  tplOps++;
  if (Array.isArray(o.team) && o.team.length) tplWithTeam++;
  for (const s of o.subs || []) { tplOps++; if (Array.isArray(s.team) && s.team.length) tplWithTeam++; }
}
console.log(`\n3. TEMPLATES (loadTemplate is the only tray source that can carry a team)`);
console.log(`   templates: ${tpls.length}, nodes in them: ${tplOps}, nodes carrying a team: ${tplWithTeam}`);

// ── 4. HOW MANY DROPS WOULD DIFFER ───────────────────────────────────────
// A drop differs between add and replace ONLY IF the node already has someone
// on it who is not the person dropped on. The tray's cards are nodes created in
// the edit session, so the realistic population is nodes with NO dates yet.
const undated = nodes.filter(x => !x.n.start || !x.n.end);
const undatedWithTeam = undated.filter(x => team(x.n).length > 0);
console.log(`\n4. WHAT A DROP WOULD ACTUALLY HIT`);
console.log(`   undated panels/ops (what a tray card still looks like): ${undated.length}`);
console.log(`   ...of those, already carrying a team: ${undatedWithTeam.length}`);
console.log(`   -> drops that would behave DIFFERENTLY under replace: ${undatedWithTeam.length}`);
for (const x of undatedWithTeam.slice(0, 8)) {
  console.log(`     ${x.job.title || x.job.id} / ${x.lvl} ${x.n.title || x.n.id}: team ${JSON.stringify(team(x.n))}`);
}

// ── 5. STATUS: does the org even have "Pending", and who is in it? ───────
const statusOpts = cfg.statusOpts || cfg.orgSettings?.statusOpts || null;
console.log(`\n5. STATUS`);
console.log(`   org statusOpts: ${statusOpts ? JSON.stringify(statusOpts) : "(not set -> defaults)"}`);
const byStatus = {};
for (const { n } of nodes) { const s = n.status || "(none)"; byStatus[s] = (byStatus[s] || 0) + 1; }
console.log(`   live node statuses: ${JSON.stringify(byStatus)}`);
const dated = nodes.filter(x => x.n.start && x.n.end);
const datedNotStarted = dated.filter(x => (x.n.status || "Not Started") === "Not Started");
console.log(`   dated nodes still "Not Started": ${datedNotStarted.length} of ${dated.length}`);
console.log(`   -> if placement implied Pending, these would all be Pending instead`);
