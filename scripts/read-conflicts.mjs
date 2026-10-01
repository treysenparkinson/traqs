#!/usr/bin/env node
// Read orgs/{org}/conflicts.json and summarise it into the decision it exists to support:
// would turning TASK_CONFLICT_MODE to enforce refuse anything legitimate?
//
// The shape to look for:
//   - staleByMs NEGATIVE and large → the client's copy predates the stored version. It is
//     writing over somebody else's change. Enforce refusing that is the point.
//   - staleByMs small or positive → the client read, edited and saved while another write
//     landed in between. Refusing that costs a person their edit and shows them the
//     "changed on the server while you were editing" message.
//   - the FIELD mix → loggedHours/status/pendingFinish reverting is a clobber;
//     start/end/startHour reverting may be a person moving a bar.
//
//   node scripts/read-conflicts.mjs [--org MTX2026TRAQS] [--since 2026-10-01]

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ORG = val("--org", "MTX2026TRAQS");
const SINCE = val("--since", null);

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });

let doc;
try {
  doc = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: `orgs/${ORG}/conflicts.json` }))).Body.transformToString());
} catch (e) {
  if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
    console.log(`orgs/${ORG}/conflicts.json does not exist yet — no conflict has been recorded since the recorder was deployed.`);
    console.log("That is itself a reading: nothing has tripped the check in that window.");
    process.exit(0);
  }
  throw e;
}
let rows = Array.isArray(doc) ? doc : (doc.records || []);
const dropped = (doc && doc.dropped) || 0;
if (SINCE) rows = rows.filter(r => String(r.at) >= SINCE);
console.log(`${rows.length} records${SINCE ? ` since ${SINCE}` : ""}${dropped ? `, ${dropped} older ones dropped past the cap` : ""}`);
if (!rows.length) process.exit(0);
console.log(`window: ${rows[0].at} … ${rows.at(-1).at}\n`);

const byJob = new Map(), byField = new Map(), byCaller = new Map();
let refused = 0, staleNeg = 0;
for (const r of rows) {
  byJob.set(r.jobId, (byJob.get(r.jobId) || 0) + 1);
  byCaller.set(`${r.by}${r.email ? " <" + r.email + ">" : ""}`, (byCaller.get(`${r.by}${r.email ? " <" + r.email + ">" : ""}`) || 0) + 1);
  if (r.refused) refused++;
  if (Number(r.staleByMs) < 0) staleNeg++;
  for (const f of (r.fields || [])) {
    const k = `${f.level}.${f.field}`;
    const e = byField.get(k) || { n: 0, ex: f };
    e.n++; byField.set(k, e);
  }
}

console.log("fields that differed on a conflicting write");
console.log("  field                         times   example (incoming → stored)");
for (const [k, e] of [...byField].sort((a, b) => b[1].n - a[1].n).slice(0, 25))
  console.log(`  ${k.padEnd(28)} ${String(e.n).padStart(6)}   ${String(e.ex.incoming).slice(0, 28)} → ${String(e.ex.stored).slice(0, 28)}`);

const stales = rows.map(r => Number(r.staleByMs) || 0).sort((a, b) => a - b);
const p = (q) => stales[Math.floor((stales.length - 1) * q)];
console.log(`\nhow stale the client copy was (negative = the client is older than what is stored)`);
console.log(`  min ${(p(0) / 1000).toFixed(1)}s   p25 ${(p(0.25) / 1000).toFixed(1)}s   median ${(p(0.5) / 1000).toFixed(1)}s   p75 ${(p(0.75) / 1000).toFixed(1)}s   max ${(p(1) / 1000).toFixed(1)}s`);
console.log(`  ${staleNeg} of ${rows.length} were writing over a NEWER stored version.`);

console.log(`\ncallers`);
for (const [c, n] of [...byCaller].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(5)}  ${c}`);
console.log(`\njobs most affected`);
for (const [j, n] of [...byJob].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(n).padStart(5)}  ${j}`);
console.log(`\n${refused} of ${rows.length} were actually refused (mode was enforce at the time).`);
console.log(`\nREADING IT: a conflict whose fields are loggedHours, status, pendingFinish or`);
console.log(`finishRequests is a clobber and enforce should refuse it. One whose fields are`);
console.log(`start/end/startHour/endHour MAY be a person moving a bar from a slightly stale`);
console.log(`copy — refusing those is what would cost somebody an edit, so weigh that count.`);
