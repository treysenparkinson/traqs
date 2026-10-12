#!/usr/bin/env node
// #315. WHAT ARE THE NINE TEAM IDS THAT RESOLVE TO NOBODY?
//
// MEASURE ONLY, on Trey's instruction: whether they were ever real people
// decides what the fix is. A person who existed and was hard-deleted wants
// their assignments reattributed or tombstoned; an id that was never a person
// wants the import that minted it understood first.
//
//   node scripts/measure-phantom-team-ids.mjs
import { S3Client, GetObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
const ORG = "MTX2026TRAQS";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k, VersionId) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k, ...(VersionId ? { VersionId } : {}) }))).Body.transformToString());

const [tasks, people, prod, pay] = await Promise.all([
  get(`orgs/${ORG}/tasks.json`), get(`orgs/${ORG}/people.json`),
  get(`orgs/${ORG}/productionhours.json`), get(`orgs/${ORG}/payhours.json`),
]);
const live = new Set(people.map(p => String(p.id)));
const counts = {}; const nodesWith = {};
const walk = (n, job) => { if (!n) return;
  for (const m of n.team || []) { const k = String(m); if (!live.has(k)) { counts[k] = (counts[k] || 0) + 1; (nodesWith[k] ??= new Set()).add(String(job?.title || "?")); } }
  for (const c of n.subs || []) walk(c, job); };
for (const j of tasks || []) walk(j, j);
const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
console.log(`phantom ids: ${ids.length}\n`);

console.log("1. WHERE THEY APPEAR TODAY");
for (const id of ids) console.log(`   ${id}  ${String(counts[id]).padStart(3)} nodes   jobs: ${[...nodesWith[id]].slice(0, 4).join(", ")}`);

console.log("\n2. DO THEY APPEAR ANYWHERE A REAL PERSON WOULD?");
const inProd = new Set((prod || []).map(r => String(r?.personId)));
const inPay = new Set((pay || []).map(r => String(r?.personId)));
const moveLogNames = new Set();
const walkML = (n) => { if (!n) return; for (const e of n.moveLog || []) { if (e?.movedBy) moveLogNames.add(String(e.movedBy)); for (const t of [...(e.fromTeam || []), ...(e.toTeam || [])]) moveLogNames.add(String(t)); } for (const c of n.subs || []) walkML(c); };
for (const j of tasks || []) walkML(j);
console.log(`   ${"id".padEnd(12)} clocked production  clocked pay  named in a moveLog`);
for (const id of ids)
  console.log(`   ${id.padEnd(12)} ${inProd.has(id) ? "YES" : "no ".padEnd(3)}                 ${inPay.has(id) ? "YES" : "no "}           ${moveLogNames.has(id) ? "YES" : "no"}`);
console.log(`   (a real worker who was ever on the clock would appear in one of the first two)`);

console.log("\n3. WERE THEY EVER IN people.json? — walking its version history");
let versions = [];
try {
  let KeyMarker, VersionIdMarker;
  do {
    const r = await s3.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: `orgs/${ORG}/people.json`, KeyMarker, VersionIdMarker, MaxKeys: 1000 }));
    versions.push(...(r.Versions || []).filter(v => v.Key === `orgs/${ORG}/people.json`));
    KeyMarker = r.NextKeyMarker; VersionIdMarker = r.NextVersionIdMarker;
    if (!r.IsTruncated) break;
  } while (true);
} catch (e) { console.log(`   could not list versions: ${e.name}`); }
versions.sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified));
console.log(`   people.json versions: ${versions.length}  (${versions[0]?.LastModified?.toISOString?.().slice(0, 10)} → ${versions[versions.length - 1]?.LastModified?.toISOString?.().slice(0, 10)})`);
// Binary search is not available — presence is not monotonic — so sample.
const step = Math.max(1, Math.floor(versions.length / 40));
const found = {};
let checked = 0;
for (let i = 0; i < versions.length; i += step) {
  let arr; try { arr = await get(`orgs/${ORG}/people.json`, versions[i].VersionId); } catch { continue; }
  checked++;
  const s = new Set((arr || []).map(p => String(p?.id)));
  for (const id of ids) if (s.has(id)) (found[id] ??= []).push(versions[i].LastModified.toISOString().slice(0, 10));
}
console.log(`   sampled ${checked} of ${versions.length} versions`);
for (const id of ids) console.log(`   ${id.padEnd(12)} ${found[id] ? `PRESENT in ${found[id].length} sampled versions, e.g. ${found[id][0]}` : "never seen in any sampled version"}`);

console.log("\n4. WHAT THE ID LOOKS LIKE");
console.log(`   live person ids:  ${people.slice(0, 8).map(p => JSON.stringify(p.id)).join(", ")}`);
console.log(`   phantom ids:      ${ids.slice(0, 5).map(i => JSON.stringify(i)).join(", ")}`);
console.log(`   uid() mints ids of this shape; a numeric id is a hand-made row.`);
