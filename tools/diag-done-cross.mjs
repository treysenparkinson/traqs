// READ-ONLY. Which DONE bars extend to the right of the cursor, and what do their records say?
//
// §1: nothing DONE may sit right of the cursor. A Finished op whose end date is in the future
// renders its spent fill across today, which breaks that.
//
//   node tools/diag-done-cross.mjs

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const [tasks, prod] = await Promise.all([
  get("orgs/MTX2026TRAQS/tasks.json"),
  get("orgs/MTX2026TRAQS/productionhours.json").catch(() => []),
]);

const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
const producedByOp = new Map();
for (const s of prod || []) if (s && !s.deletedAt && s.opId != null) producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));
// Last session against an op — the closest thing to "when the work actually stopped".
const lastSessionEnd = new Map();
for (const s of prod || []) {
  if (!s || s.deletedAt || s.opId == null || !s.clockOut) continue;
  const k = String(s.opId), t = Date.parse(s.clockOut);
  if (Number.isFinite(t) && (!lastSessionEnd.has(k) || t > lastSessionEnd.get(k))) lastSessionEnd.set(k, t);
}

console.log(`today ${TODAY}\n`);
let n = 0;
// Which fields exist on a Finished op at all — the fix depends on whether an approval stamp
// is already recorded or would have to be added.
const fieldTally = new Map();
for (const job of tasks) for (const panel of job.subs || []) for (const op of panel.subs || []) {
  if (op.status !== "Finished") continue;
  for (const k of Object.keys(op)) fieldTally.set(k, (fieldTally.get(k) || 0) + 1);
  if (!op.end || op.end < TODAY) continue;   // sits entirely behind the cursor: fine
  n++;
  if (n > 12) continue;
  const worked = producedByOp.get(String(op.id)) || 0;
  const lse = lastSessionEnd.get(String(op.id));
  console.log(`${job.jobNumber || job.title} · ${panel.title} · ${op.title}`);
  console.log(`   id=${op.id}   planned ${op.start} ${op.startHour ?? "-"}h .. ${op.end} ${op.endHour ?? "-"}h   hpd=${op.hpd}`);
  console.log(`   worked=${worked}h  loggedHours=${op.loggedHours ?? "-"}  actualHours=${op.actualHours ?? "-"}  actualEnd=${op.actualEnd ?? "-"}`);
  console.log(`   finishedAt=${op.finishedAt ?? "-"}  approvedAt=${op.approvedAt ?? "-"}  completedAt=${op.completedAt ?? "-"}`);
  console.log(`   last session clockOut: ${lse ? new Date(lse).toISOString() : "(none)"}`);
  console.log("");
}
console.log(`${n} Finished op(s) whose end is today or later — these paint DONE across the cursor.\n`);
console.log("fields present on Finished ops (count):");
console.log([...fieldTally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `   ${k}: ${v}`).join("\n"));
