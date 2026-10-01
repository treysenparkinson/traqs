#!/usr/bin/env node
// Read orgs/{org}/rule-events.json and summarise it into the decision each flag is waiting on.
//
// Four env flags default to `log` and were waiting on evidence that console.warn was never
// collecting (#327). This is that evidence. One file, one GET, grouped by tag.
//
//   node scripts/read-rule-events.mjs [--org MTX2026TRAQS] [--since 2026-10-02] [--tag task-conflict]
//
// Reading it:
//   task-conflict       → TASK_CONFLICT_MODE. A conflict whose fields are loggedHours,
//                         status, pendingFinish or finishRequests is a clobber and enforce
//                         should refuse it. One whose fields are start/end/startHour may be
//                         somebody moving a bar from a slightly stale copy — refusing those
//                         is what would cost a person an edit, so weigh that count, and look
//                         at staleByMs: a large negative gap is a stale copy, a small one is
//                         two people editing at once.
//   schedule-rule       → SCHEDULE_RULES_MODE, on /tasks.
//   session-guard       → SCHEDULE_RULES_MODE, on the session fields. `byMs` says how far
//                         past the bound: a couple of minutes is phone clock skew, hours is
//                         a bug.
//   overlap-rule        → OVERLAP_RULE_MODE. Business orgs only.
//   permission-gate     → PERMISSION_GATES_MODE. Written only when the two classifiers
//                         disagree, so every row here is a real difference of opinion.
//   hpd-default-write   → not a flag. Names the client build writing 7.5 into an
//                         unestimated hpd (#301); read the userAgent column.
//   server-owned-field  → not a flag. Counts how often the autosave race actually fires
//                         (#323). Every one of these was a clobber that was prevented.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ORG = val("--org", "MTX2026TRAQS");
const SINCE = val("--since", null);
const ONLY = val("--tag", null);

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });

let doc;
try {
  doc = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: `orgs/${ORG}/rule-events.json` }))).Body.transformToString());
} catch (e) {
  if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
    console.log(`orgs/${ORG}/rule-events.json does not exist yet — no rule has fired since the recorder was deployed.`);
    console.log("That is a reading, not an error: nothing has tripped any of the seven in that window.");
    process.exit(0);
  }
  throw e;
}
let rows = Array.isArray(doc) ? doc : (doc.records || []);
const dropped = (doc && doc.dropped) || {};
if (SINCE) rows = rows.filter(r => String(r.at) >= SINCE);
if (ONLY) rows = rows.filter(r => r.tag === ONLY);
console.log(`${rows.length} records${SINCE ? ` since ${SINCE}` : ""}${ONLY ? ` for ${ONLY}` : ""}`);
if (Object.keys(dropped).length) console.log(`dropped past the per-tag cap: ${Object.entries(dropped).map(([t, n]) => `${t} ${n}`).join(", ")}`);
if (!rows.length) process.exit(0);
console.log(`window: ${rows[0].at} … ${rows.at(-1).at}\n`);

const FLAG = {
  "task-conflict": "TASK_CONFLICT_MODE", "schedule-rule": "SCHEDULE_RULES_MODE",
  "session-guard": "SCHEDULE_RULES_MODE", "overlap-rule": "OVERLAP_RULE_MODE",
  "permission-gate": "PERMISSION_GATES_MODE", "hpd-default-write": "(no flag — #301)",
  "server-owned-field": "(no flag — #323, always prevented)",
};
const byTag = new Map();
for (const r of rows) { const e = byTag.get(r.tag) || { n: 0, refused: 0, modes: new Set(), rows: [] };
  e.n++; if (r.refused) e.refused++; if (r.mode) e.modes.add(r.mode); e.rows.push(r); byTag.set(r.tag, e); }

console.log("tag                   count  refused  mode(s)       flag");
for (const [tag, e] of [...byTag].sort((a, b) => b[1].n - a[1].n))
  console.log(`${tag.padEnd(21)} ${String(e.n).padStart(5)}  ${String(e.refused).padStart(7)}  ${[...e.modes].join("/").padEnd(12)}  ${FLAG[tag] || ""}`);

const top = (list, keyFn, n = 8) => {
  const m = new Map();
  for (const r of list) { const k = keyFn(r); if (k == null) continue; m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
};
const show = (title, pairs) => { if (!pairs.length) return; console.log(`  ${title}`); for (const [k, n] of pairs) console.log(`    ${String(n).padStart(5)}  ${String(k).slice(0, 80)}`); };

for (const [tag, e] of byTag) {
  console.log(`\n── ${tag} (${e.n}) ────────────────────────────────────`);
  show("callers", top(e.rows, r => `${r.by}${r.email ? " <" + r.email + ">" : ""}`));
  if (tag === "task-conflict") {
    show("fields that differed", top(e.rows.flatMap(r => r.fields || []), f => `${f.level}.${f.field}`, 15));
    const st = e.rows.map(r => Number(r.staleByMs) || 0).sort((a, b) => a - b);
    const p = (q) => st[Math.floor((st.length - 1) * q)];
    console.log(`  staleness (negative = the client is older than what is stored)`);
    console.log(`    min ${(p(0) / 1000).toFixed(1)}s  median ${(p(0.5) / 1000).toFixed(1)}s  max ${(p(1) / 1000).toFixed(1)}s   ${e.rows.filter(r => Number(r.staleByMs) < 0).length} of ${e.n} wrote over a NEWER stored version`);
  }
  if (tag === "schedule-rule" || tag === "overlap-rule") show("rule", top(e.rows, r => r.rule));
  if (tag === "session-guard") {
    show("guard · field · why", top(e.rows, r => `${r.guard} · ${r.field} · ${r.why || ""}`));
    const byMs = e.rows.map(r => Number(r.byMs)).filter(Number.isFinite);
    if (byMs.length) console.log(`  past the bound by: min ${(Math.min(...byMs) / 1000).toFixed(1)}s  max ${(Math.max(...byMs) / 1000).toFixed(1)}s`);
  }
  if (tag === "permission-gate") show("legacy → next (perms)", top(e.rows, r => `${r.legacy} → ${r.next}  [${(r.perms || []).join(",")}]`));
  if (tag === "hpd-default-write") show("client build", top(e.rows, r => r.userAgent));
  if (tag === "server-owned-field") show("field (incoming → stored)", top(e.rows, r => `${r.field}: ${r.incoming} → ${r.stored}`));
}
