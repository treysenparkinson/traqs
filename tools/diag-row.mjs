// READ-ONLY. Every op on a person's row overlapping a date window, with the numbers the
// schedule derives its state from. Answers "what am I actually looking at on this row".
//
//   node tools/diag-row.mjs Howie 2026-09-14 2026-09-22

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

const who = (process.argv[2] || "").toLowerCase();
const winS = process.argv[3] || "2026-09-14";
const winE = process.argv[4] || "2026-09-22";

const [tasks, people, prod] = await Promise.all([
  get(`orgs/${ORG}/tasks.json`), get(`orgs/${ORG}/people.json`),
  get(`orgs/${ORG}/productionhours.json`).catch(() => []),
]);

const person = people.find((p) => (p.name || "").toLowerCase().includes(who));
if (!person) { console.log(`no person matching "${who}"`); process.exit(0); }
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const onTeam = (t) => (t || []).some((x) => sameId(x, person.id));

const producedByOp = new Map();
for (const s of Array.isArray(prod) ? prod : []) {
  if (!s || s.deletedAt || s.opId == null) continue;
  producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));
}

const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
console.log(`${person.name} (id ${person.id})   window ${winS}..${winE}   today ${TODAY}`);
console.log(`activeJobClock: ${person.activeJobClock ? `opId ${person.activeJobClock.opId} since ${person.activeJobClock.clockIn}${person.activeJobClock.frozenAtMs ? " FROZEN" : ""}` : "(none)"}\n`);

let n = 0;
for (const job of tasks) {
  for (const panel of job.subs || []) {
    for (const op of panel.subs || []) {
      if (!onTeam(op.team) || !op.start || !op.end) continue;
      if (op.end < winS || op.start > winE) continue;
      const worked = Math.max(producedByOp.get(String(op.id)) || 0, Number(op.loggedHours) || 0);
      const hpd = Number(op.hpd) || 0;
      const owed = hpd - worked;
      // The state the schedule would derive, by the same ladder as _barState.
      const state = op.status === "Finished" ? "done"
        : sameId(person.activeJobClock?.opId, op.id) ? (person.activeJobClock?.frozenAtMs ? "held" : "running")
        : worked > 0 ? "worked" : "scheduled";
      console.log(`${job.jobNumber || job.title} · ${panel.title} · ${op.title}`);
      console.log(`   id=${op.id}  ${op.start}..${op.end}  hours ${op.startHour ?? "-"}..${op.endHour ?? "-"}  hpd=${hpd}`);
      console.log(`   status=${op.status || "(none)"}${op.locked ? "  LOCKED" : ""}  team=${(op.team || []).length}  worked=${worked}h  owed=${owed > 1 / 60 ? owed.toFixed(2) + "h" : "none"}`);
      console.log(`   -> state "${state}"${op.end < TODAY ? "   (window wholly passed)" : ""}`);
      console.log("");
      n++;
    }
  }
}
console.log(`${n} op(s) on this row in the window.`);
