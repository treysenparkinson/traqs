#!/usr/bin/env node
// #426. How much machinery is actually exercised, and what would the first
// person to use it see?
//
// `unitDepartments` returns the NEAREST level that states anything. So an op
// inherits only when it states nothing AND an ancestor does. Both halves have to
// be measured, because "89 ops say nothing" (from #427) is not the same claim.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { unitDepartments, normalizeDepartments } from "../src/scheduleRules.js";

const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
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
const roles = cfg.roles || cfg.orgSettings?.roles || [];

const own = (n) => (Array.isArray(n.requiredDepartments) && n.requiredDepartments.length)
  ? n.requiredDepartments
  : (n.requiredDepartment ? [n.requiredDepartment] : []);

let ops = 0, opsOwn = 0, opsInheritPanel = 0, opsInheritJob = 0, opsAnyone = 0;
let panels = 0, panelsOwn = 0, panelsInheritJob = 0;
let jobsOwn = 0;
const inheritors = [];
for (const j of tasks) {
  if (own(j).length) jobsOwn++;
  for (const p of j.subs || []) {
    panels++;
    if (own(p).length) panelsOwn++;
    else if (own(j).length) panelsInheritJob++;
    for (const o of p.subs || []) {
      ops++;
      if (own(o).length) { opsOwn++; continue; }
      if (own(p).length) { opsInheritPanel++; inheritors.push(`${j.title || j.id} / ${p.title || p.id} / ${o.title || o.id} -> ${own(p).join(", ")}`); }
      else if (own(j).length) { opsInheritJob++; inheritors.push(`${j.title || j.id} / ${o.title || o.id} -> job: ${own(j).join(", ")}`); }
      else opsAnyone++;
    }
  }
}

console.log(`ORG ${ORG}: ${tasks.length} jobs, ${panels} panels, ${ops} ops`);
console.log(`org departments (roles): ${roles.length ? JSON.stringify(roles) : "(none)"}\n`);

console.log("1. WHO STATES A DEPARTMENT, AND WHO INHERITS ONE");
console.log(`   jobs stating their own:        ${jobsOwn}`);
console.log(`   panels stating their own:      ${panelsOwn}`);
console.log(`   panels inheriting from a job:  ${panelsInheritJob}`);
console.log(`   ops stating their own:         ${opsOwn}`);
console.log(`   ops INHERITING from a panel:   ${opsInheritPanel}`);
console.log(`   ops INHERITING from a job:     ${opsInheritJob}`);
console.log(`   ops genuinely unconstrained:   ${opsAnyone}`);
for (const s of inheritors.slice(0, 10)) console.log(`     ${s}`);

console.log("\n2. THE ENCODING — can an op say ANYONE when its panel says something?");
const panelSays = { id: "p", requiredDepartments: ["Wire"], requiredDepartment: "Wire" };
const cleared = { id: "o", requiredDepartments: [], requiredDepartment: "" };
console.log(`   op with requiredDepartments: []  under a panel saying Wire`);
console.log(`     -> unitDepartments resolves to ${JSON.stringify(unitDepartments(cleared, panelSays, null))}`);
console.log(`     -> so [] means INHERIT, and "anyone" is UNREPRESENTABLE at op level`);

console.log("\n3. TICKING EVERY DEPARTMENT — what does the picker actually write?");
if (roles.length) {
  const all = normalizeDepartments(roles, roles);
  console.log(`   normalizeDepartments(all ${roles.length} roles, roles) = ${JSON.stringify(all)}`);
  const opAll = { id: "o", requiredDepartments: all, requiredDepartment: all[0] || "" };
  console.log(`   an op with every box ticked, under a panel saying Wire`);
  console.log(`     -> resolves to ${JSON.stringify(unitDepartments(opAll, panelSays, null))}`);
  console.log(`     -> ticking EVERYTHING narrows it back to the panel's value`);
} else {
  console.log("   (org has no roles configured, so the collapse cannot be demonstrated on live config)");
  const fake = ["Wire", "Cut", "Layout"];
  console.log(`   with roles ${JSON.stringify(fake)}: normalizeDepartments(all, all) = ${JSON.stringify(normalizeDepartments(fake, fake))}`);
}

console.log("\n4. WHAT THE PICKER SHOWS TODAY for an inheriting op");
console.log(`   button label  = node.requiredDepartment || "Dept"   -> "Dept" (placeholder, dimmed)`);
console.log(`   checkboxes    = unitDepartments(node, null, null)   -> none ticked`);
console.log(`   so an op CONSTRAINED to its panel's department is drawn exactly like`);
console.log(`   an op that anyone may do.`);

console.log("\n5. WHERE DEPARTMENTS ACTUALLY LIVE");
console.log(`   config.json top-level keys: ${JSON.stringify(Object.keys(cfg).slice(0, 25))}`);
const pd = await get(`orgs/${ORG}/people.json`).catch(() => []);
const people = (Array.isArray(pd) ? pd : pd.people || []).filter(p => p && !p.deletedAt);
const held = new Set();
for (const p of people) {
  for (const d of (Array.isArray(p.departments) ? p.departments : [p.department, p.secondaryDepartment])) {
    if (d) held.add(d);
  }
}
console.log(`   departments actually HELD by people: ${JSON.stringify([...held].sort())}`);
const stated = new Set();
for (const j of tasks) for (const p of j.subs || []) {
  for (const d of own(p)) stated.add(d);
  for (const o of p.subs || []) for (const d of own(o)) stated.add(d);
}
console.log(`   departments STATED on work:          ${JSON.stringify([...stated].sort())}`);

console.log("\n6. THE TWO PANELS THAT STATE A DEPARTMENT — do they have ops under them?");
for (const j of tasks) for (const p of j.subs || []) {
  if (!own(p).length) continue;
  const kids = (p.subs || []).filter(o => o && !o.deletedAt);
  console.log(`   ${j.title || j.id} / ${p.title || p.id} -> ${own(p).join(", ")}  (${kids.length} ops)`);
  for (const o of kids) console.log(`       op ${o.title || o.id}: own=${JSON.stringify(own(o))}`);
}
