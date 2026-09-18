// Repair an op whose scheduled block has been collapsed/inverted (endHour <= startHour).
// Rebuilds the block from the op's planned hpd. Writes ONLY that op's startHour/endHour;
// every other byte of tasks.json is preserved. Dry-run unless --apply is passed.
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ORG = "MTX2026TRAQS";
const KEY = `orgs/${ORG}/tasks.json`;
const OP_ID = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!OP_ID) { console.error("usage: node tools/repair-op-hours.mjs <opId> [--apply]"); process.exit(1); }

// Org defaults — settings.json carries no workStart/workEnd, so the app's own
// fallbacks apply. Mirrored here rather than guessed.
const WORK_START = 8, WORK_END = 17;
const DEFAULT_HPD = 4;   // only if the op has no usable hpd

const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});

const r = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY }));
const raw = await r.Body.transformToString();
const tasks = JSON.parse(raw);

let target = null;
for (const job of tasks)
  for (const panel of job.subs || [])
    for (const op of panel.subs || [])
      if (String(op.id) === OP_ID) target = { op, panel, job };

if (!target) { console.error(`op ${OP_ID} not found`); process.exit(1); }
const { op, panel, job } = target;

const before = { startHour: op.startHour, endHour: op.endHour, hpd: op.hpd, start: op.start, end: op.end };
const hpdRaw = Number(op.hpd);
const usableHpd = Number.isFinite(hpdRaw) && hpdRaw > 0 ? hpdRaw : null;
const span = WORK_END - WORK_START;
const duration = Math.max(0.25, Math.min(usableHpd ?? DEFAULT_HPD, span));

// Anchor the block so it ENDS at work end. That keeps the full planned duration and
// makes the block cover "now" for any current time inside the workday, which is the
// state that exercises the covering-now teleport branch: trim the left edge to
// clock-in, leave the planned end alone.
const newStartHour = Math.max(WORK_START, WORK_END - duration);
const newEndHour = WORK_END;

console.log(`OP ${OP_ID}  —  ${job.title} / ${panel.title} / ${op.title}`);
console.log(`  dates                ${op.start} → ${op.end}  (unchanged)`);
console.log(`  hpd                  ${before.hpd}  ${usableHpd ? "(used)" : `(unusable — defaulted to ${DEFAULT_HPD}h)`}`);
console.log(`  workday              ${WORK_START}:00 → ${WORK_END}:00`);
console.log(`\n  BEFORE   startHour ${before.startHour}   endHour ${before.endHour}   width ${(before.endHour - before.startHour).toFixed(4)}h  <- corrupt`);
console.log(`  AFTER    startHour ${newStartHour.toFixed(4)}   endHour ${newEndHour.toFixed(4)}   width ${duration.toFixed(4)}h`);
console.log(`           = ${Math.floor(newStartHour)}:${String(Math.round((newStartHour % 1) * 60)).padStart(2, "0")} → ${WORK_END}:00`);

if (!APPLY) { console.log(`\nDRY RUN — nothing written. Re-run with --apply to write.`); process.exit(0); }

op.startHour = newStartHour;
op.endHour = newEndHour;
op.moveLog = [...(op.moveLog || []), {
  fromStart: op.start, fromEnd: op.end, toStart: op.start, toEnd: op.end,
  fromStartHour: before.startHour, toStartHour: newStartHour,
  fromEndHour: before.endHour, toEndHour: newEndHour,
  date: op.start, movedBy: "repair script",
  reason: "Repaired collapsed block (endHour <= startHour); duration rebuilt from hpd",
}];

const body = JSON.stringify(tasks);
if (!Array.isArray(tasks) || tasks.length === 0) { console.error("REFUSING: tasks array empty"); process.exit(1); }
await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, Body: body, ContentType: "application/json" }));
console.log(`\nWRITTEN. ${tasks.length} jobs preserved, ${raw.length} -> ${body.length} bytes.`);
