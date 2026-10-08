#!/usr/bin/env node
// #489. WHO CREATED THE 21 DEPENDENCY EDGES?
//
// #485 found that the two live panels holding every dep edge on the board carry
// NO `depsMode` key — and both current editors write one the moment a link
// exists. So neither of them made these. S3 keeps every version of tasks.json
// (43,170 of them), so the write is findable rather than guessable.
//
// Binary search on "does this panel have a linked op", which is monotonic: a dep
// once created stays. ~16 fetches instead of 43,170.
//
//   node scripts/bisect-deps-origin.mjs

import { S3Client, ListObjectVersionsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = "orgs/MTX2026TRAQS/tasks.json";

const TARGETS = [
  { job: "t53853q7c", jobTitle: "Brigham GCC #3", panel: "t3vezn4uq", panelTitle: "401992-01" },
  { job: "tjqj93vyc", jobTitle: "Brush Creek",    panel: "te3kncpz5", panelTitle: "402005-02" },
];

console.log("listing versions…");
let versions = [], kt, kv;
do {
  const r = await s3.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: KEY, KeyMarker: kt, VersionIdMarker: kv }));
  (r.Versions || []).filter(v => v.Key === KEY).forEach(v => versions.push({ id: v.VersionId, at: v.LastModified, size: v.Size }));
  kt = r.NextKeyMarker; kv = r.NextVersionIdMarker;
  if (!r.IsTruncated) break;
} while (true);
versions.sort((a, b) => new Date(a.at) - new Date(b.at));
console.log(`${versions.length} versions, ${versions[0].at.toISOString()} → ${versions[versions.length - 1].at.toISOString()}\n`);

let fetches = 0;
const cache = new Map();
const at = async (i) => {
  if (cache.has(i)) return cache.get(i);
  fetches++;
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, VersionId: versions[i].id }));
  const d = JSON.parse(await res.Body.transformToString());
  cache.set(i, d);
  return d;
};
const panelOf = (data, t) => {
  const j = (data || []).find(x => x && x.id === t.job);
  return (j?.subs || []).find(p => p && p.id === t.panel) || null;
};
const linked = (data, t) => {
  const p = panelOf(data, t);
  return !!p && (p.subs || []).some(o => o && (o.deps || []).filter(d => d !== "__pending__").length > 0);
};

for (const t of TARGETS) {
  console.log(`\n═══ ${t.jobTitle} / ${t.panelTitle} ═══`);
  // Confirm the predicate is true at the newest version before searching for it.
  if (!linked(await at(versions.length - 1), t)) { console.log("  not linked in the newest version — nothing to find"); continue; }

  let lo = 0, hi = versions.length - 1;          // lo: not linked (or absent), hi: linked
  if (linked(await at(0), t)) { console.log("  linked in the OLDEST version — it predates this history"); continue; }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (linked(await at(mid), t)) hi = mid; else lo = mid;
  }
  const before = await at(lo), after = await at(hi);
  const v = versions[hi];
  console.log(`  FIRST VERSION WITH A LINK: ${v.at.toISOString()}`);
  console.log(`    versionId ${v.id}`);
  console.log(`    the write before it: ${versions[lo].at.toISOString()}  (${((new Date(v.at) - new Date(versions[lo].at)) / 1000).toFixed(1)}s earlier)`);
  console.log(`    size ${versions[lo].size} → ${v.size} bytes`);

  const pb = panelOf(before, t), pa = panelOf(after, t);
  console.log(`\n  THE PANEL, BEFORE:`);
  console.log(`    exists: ${!!pb}${pb ? `, ops ${(pb.subs || []).length}, depsMode ${JSON.stringify(pb.depsMode)}` : ""}`);
  if (pb) (pb.subs || []).forEach(o => console.log(`      ${o.id} "${o.title}" deps=${JSON.stringify(o.deps ?? null)}`));
  console.log(`  THE PANEL, AFTER:`);
  console.log(`    exists: ${!!pa}${pa ? `, ops ${(pa.subs || []).length}, depsMode ${JSON.stringify(pa.depsMode)}  ("depsMode" in panel: ${pa ? ("depsMode" in pa) : "-"})` : ""}`);
  if (pa) (pa.subs || []).forEach(o => console.log(`      ${o.id} "${o.title}" deps=${JSON.stringify(o.deps ?? null)}`));

  // WHAT ELSE THE SAME WRITE DID. A whole-tree POST touches everything; a
  // targeted edit touches one node. The difference says which surface wrote it.
  const flat = (d) => { const m = new Map(); const w = (ns) => (ns || []).forEach(n => { if (!n) return; m.set(n.id, n); w(n.subs); }); w(d); return m; };
  const fb = flat(before), fa = flat(after);
  const changed = [], added = [], removed = [];
  for (const [id, n] of fa) {
    if (!fb.has(id)) { added.push(n); continue; }
    if (JSON.stringify(fb.get(id)) !== JSON.stringify(n)) changed.push(id);
  }
  for (const [id] of fb) if (!fa.has(id)) removed.push(id);
  console.log(`\n  THE WRITE ITSELF: ${changed.length} node(s) changed, ${added.length} added, ${removed.length} removed, of ${fa.size} total`);
  // Which FIELDS changed, across every changed node — the signature of the writer.
  const fields = new Map();
  for (const id of changed) {
    const a = fb.get(id), b = fa.get(id);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === "subs") continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) fields.set(k, (fields.get(k) || 0) + 1);
    }
  }
  console.log(`  fields touched: ${[...fields.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}×${n}`).join(", ") || "(none outside subs)"}`);
  // lastModifiedAt on the job says when the server stamped it; moveLog says who.
  const jb = (before || []).find(x => x && x.id === t.job), ja = (after || []).find(x => x && x.id === t.job);
  console.log(`  job lastModifiedAt: ${JSON.stringify(jb?.lastModifiedAt)} → ${JSON.stringify(ja?.lastModifiedAt)}`);
  const mv = (pa?.subs || []).flatMap(o => (o.moveLog || []).map(e => e.movedBy)).filter(Boolean);
  console.log(`  movedBy names on the panel's ops after the write: ${[...new Set(mv)].join(", ") || "(none)"}`);
}
console.log(`\n${fetches} version fetches.`);
