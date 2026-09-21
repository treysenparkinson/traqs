// READ-ONLY. Why is an op not being pushed?
//
// Re-evaluates the exact exclusion chain the schedule runs (_pushIdleH in TRAQS.jsx) against
// live tasks.json, and prints which test each op fails. Reads nothing but S3 and writes
// nothing at all.
//
//   node tools/diag-push.mjs            all ops whose window has passed with hours unworked
//   node tools/diag-push.mjs 402015-02  narrow to ops whose title/number matches

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ORG = "MTX2026TRAQS";
const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const needle = (process.argv[2] || "").toLowerCase();
const [tasks, people, prod] = await Promise.all([
  get(`orgs/${ORG}/tasks.json`),
  get(`orgs/${ORG}/people.json`),
  get(`orgs/${ORG}/productionhours.json`).catch(() => []),
]);

const toDS = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = toDS(new Date());
const nameOf = (id) => (people.find((p) => String(p.id) === String(id)) || {}).name || `#${id}`;

// Hours actually recorded against an op, by the same rule producedHoursByScope uses.
const producedByOp = new Map();
for (const s of Array.isArray(prod) ? prod : []) {
  if (!s || s.deletedAt || s.opId == null) continue;
  producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));
}

console.log(`today = ${TODAY}   ops scanned from orgs/${ORG}/tasks.json\n`);

const rows = [];
for (const job of tasks) {
  for (const panel of job.subs || []) {
    for (const op of panel.subs || []) {
      const label = `${job.jobNumber || job.title} · ${panel.title} · ${op.title}`;
      if (needle && !label.toLowerCase().includes(needle)) continue;
      if (!op.start || !op.end) continue;
      const produced = producedByOp.get(String(op.id)) || 0;
      const logged = Number(op.loggedHours) || 0;
      const worked = Math.max(produced, logged);
      const teamSz = Math.max(1, (op.team || []).length);

      // The exclusion chain, in the order TRAQS.jsx runs it.
      let verdict;
      if (op.status === "Finished") verdict = "SKIP  status Finished";
      else if (op.end < TODAY) verdict = `BLOCKED  Q3 historical: end ${op.end} < today ${TODAY}`;
      else if (worked / teamSz >= (op.hpd || 0) / teamSz && (op.hpd || 0) > 0) verdict = "SKIP  nothing left to push";
      else verdict = "WOULD PUSH";

      const past = op.end < TODAY;
      if (!needle && !(past && worked === 0)) continue; // default view: untouched work in the past
      rows.push({ label, id: op.id, start: op.start, end: op.end,
        startHour: op.startHour ?? null, endHour: op.endHour ?? null,
        hpd: op.hpd ?? null, status: op.status || "(none)", locked: !!op.locked,
        team: (op.team || []).map(nameOf).join(", ") || "(none)",
        worked, verdict });
    }
  }
}

if (!rows.length) { console.log("no matching ops"); process.exit(0); }
for (const r of rows) {
  console.log(`${r.label}`);
  console.log(`   id=${r.id}  ${r.start}..${r.end}  hours ${r.startHour ?? "-"}..${r.endHour ?? "-"}  hpd=${r.hpd}  status=${r.status}${r.locked ? "  LOCKED" : ""}`);
  console.log(`   team: ${r.team}`);
  console.log(`   worked: ${r.worked}h   -> ${r.verdict}`);
  console.log("");
}
const blocked = rows.filter((r) => r.verdict.startsWith("BLOCKED")).length;
console.log(`${rows.length} op(s); ${blocked} blocked by the Q3 historical exclusion.`);
