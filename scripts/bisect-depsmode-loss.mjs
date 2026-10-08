#!/usr/bin/env node
// #489, part two. The deps were created WITH `depsMode: "unlocked"` — the
// bisect in part one found both creating writes doing exactly that. So the
// field was stripped afterwards, and THAT write is the thing worth finding.
//
// Predicate: the panel has linked ops AND carries no `depsMode` key. Monotonic
// from the removal onward, assuming it was not toggled back and forth — which
// the search itself checks by reporting the state either side.
//
//   node scripts/bisect-depsmode-loss.mjs

import { S3Client, ListObjectVersionsCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = "orgs/MTX2026TRAQS/tasks.json";

const TARGETS = [
  { job: "t53853q7c", jobTitle: "Brigham GCC #3", panel: "t3vezn4uq", panelTitle: "401992-01", from: "2026-06-25T20:55:07.000Z" },
  { job: "tjqj93vyc", jobTitle: "Brush Creek",    panel: "te3kncpz5", panelTitle: "402005-02", from: "2026-07-28T15:31:49.000Z" },
];

let versions = [], kt, kv;
do {
  const r = await s3.send(new ListObjectVersionsCommand({ Bucket: env.S3_BUCKET, Prefix: KEY, KeyMarker: kt, VersionIdMarker: kv }));
  (r.Versions || []).filter(v => v.Key === KEY).forEach(v => versions.push({ id: v.VersionId, at: v.LastModified, size: v.Size }));
  kt = r.NextKeyMarker; kv = r.NextVersionIdMarker;
  if (!r.IsTruncated) break;
} while (true);
versions.sort((a, b) => new Date(a.at) - new Date(b.at));

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
const panelOf = (d, t) => ((d || []).find(x => x && x.id === t.job)?.subs || []).find(p => p && p.id === t.panel) || null;
const lost = (d, t) => { const p = panelOf(d, t); return !!p && !("depsMode" in p); };

for (const t of TARGETS) {
  console.log(`\n═══ ${t.jobTitle} / ${t.panelTitle} ═══`);
  let lo = versions.findIndex(v => new Date(v.at) >= new Date(t.from));
  let hi = versions.length - 1;
  if (!lost(await at(hi), t)) { console.log("  depsMode is still present in the newest version"); continue; }
  if (lost(await at(lo), t)) { console.log("  already absent at the creating write — part one's reading was wrong"); continue; }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lost(await at(mid), t)) hi = mid; else lo = mid;
  }
  const before = await at(lo), after = await at(hi);
  const v = versions[hi];
  console.log(`  LOST AT: ${v.at.toISOString()}   versionId ${v.id}`);
  console.log(`    previous write ${versions[lo].at.toISOString()}  (${((new Date(v.at) - new Date(versions[lo].at)) / 1000).toFixed(1)}s earlier)`);
  console.log(`    size ${versions[lo].size} → ${v.size} bytes   (${v.size - versions[lo].size >= 0 ? "+" : ""}${v.size - versions[lo].size})`);

  const pb = panelOf(before, t), pa = panelOf(after, t);
  console.log(`    depsMode: ${JSON.stringify(pb?.depsMode)} → ${pa && "depsMode" in pa ? JSON.stringify(pa.depsMode) : "(key absent)"}`);
  console.log(`    the panel's ops still linked after: ${(pa?.subs || []).filter(o => (o.deps || []).length).length} of ${(pa?.subs || []).length}`);

  // THE SHAPE OF THE WRITE. A whole-tree POST rewrites everything; a targeted
  // edit touches a handful. That difference is what names the writer.
  const flat = (d) => { const m = new Map(); const w = (ns) => (ns || []).forEach(n => { if (!n) return; m.set(n.id, n); w(n.subs); }); w(d); return m; };
  const fb = flat(before), fa = flat(after);
  let changed = [], added = 0, removed = 0;
  for (const [id, n] of fa) { if (!fb.has(id)) { added++; continue; } if (JSON.stringify(fb.get(id)) !== JSON.stringify(n)) changed.push(id); }
  for (const [id] of fb) if (!fa.has(id)) removed++;
  console.log(`\n    THE WRITE: ${changed.length} changed, ${added} added, ${removed} removed, of ${fa.size} nodes`);
  const fields = new Map();
  for (const id of changed) {
    const a = fb.get(id), b = fa.get(id);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === "subs") continue;
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) fields.set(k, (fields.get(k) || 0) + 1);
    }
  }
  console.log(`    fields touched: ${[...fields.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, n]) => `${k}×${n}`).join(", ") || "(none outside subs)"}`);

  // DID IT STRIP depsMode EVERYWHERE, or only here? That separates a targeted
  // edit from a client that does not model the field at all.
  const modes = (d) => { let keys = 0, vals = 0; for (const [, n] of flat(d)) { if ("depsMode" in n) keys++; if (n.depsMode) vals++; } return { keys, vals }; };
  const mb = modes(before), ma = modes(after);
  console.log(`    depsMode ACROSS THE WHOLE TREE: ${mb.keys} keys / ${mb.vals} values  →  ${ma.keys} keys / ${ma.vals} values`);
  console.log(`    deps edges across the whole tree: ${[...fb.values()].reduce((s, n) => s + (n.deps || []).length, 0)} → ${[...fa.values()].reduce((s, n) => s + (n.deps || []).length, 0)}`);
}
console.log(`\n${fetches} version fetches.`);
