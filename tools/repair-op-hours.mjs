// Repair an op whose scheduled block has been collapsed or inverted (endHour <= startHour).
// Rebuilds the block from the op's planned hpd. Writes ONLY that op's startHour/endHour;
// every other byte of tasks.json is preserved. Dry-run unless --apply is passed.
//
// Corruption is DETECTED, not asserted. An earlier version printed "<- corrupt" as a literal in
// the BEFORE line, so every dry run announced corruption whatever it found — and on an op with
// null hours `null - null` rendered as 0.0000h, which reads exactly like a collapsed block. A
// dry run was therefore worthless as evidence, and acting on one meant writing single-day hours
// onto an op that had never been damaged. The verdict below reproduces TRAQS's own opHourRange
// semantics instead. --apply refuses anything not diagnosed corrupt; --force overrides.
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
const FORCE = process.argv.includes("--force");
if (!OP_ID) { console.error("usage: node tools/repair-op-hours.mjs <opId> [--apply] [--force]"); process.exit(1); }

// Org defaults — settings.json carries no workStart/workEnd, so the app's own
// fallbacks apply. Mirrored here rather than guessed.
const WORK_START = 8, WORK_END = 17;
const DEFAULT_HPD = 4;   // only if the op has no usable hpd

// Reproduce opHourRange (src/TRAQS.jsx) rather than inventing a stricter rule:
//
//   const sH = op.startHour ?? workStartH;
//   if (op.start === op.end) { const eH = op.endHour ?? Math.min(sH + (op.hpd || pHPD), workEndH); … }
//   return [hourTs(op.start, workStartH), hourTs(op.end, workEndH)];
//
// Two consequences the hardcoded string hid:
//
//   * A MULTI-DAY op ignores startHour/endHour entirely — it always spans full working days.
//     Those hours cannot be corrupt because nothing reads them, and writing single-day hours
//     onto one is noise at best.
//
//   * ABSENT or NULL hours are a supported state, not damage: the app falls back to workStart
//     and derives the end from hpd. computeCascadePushes writes exactly this
//     (`sameDay ? workStartH : null`) every time a cascade pushes an op across a day boundary,
//     so it is a routine outcome of normal operation, not a sign anything went wrong.
//
// Corruption is the narrow case: a single-day op with BOTH hours present where the block has
// zero or negative width, or an hour present but not a finite number.
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function diagnose(o) {
  const sH = o.startHour, eH = o.endHour;
  if (o.start !== o.end)
    return { corrupt: false, label: "NOT CORRUPT — multi-day op",
             detail: `start (${o.start}) !== end (${o.end}); opHourRange spans full working days and never reads these hours.` };
  if (sH != null && !isNum(sH))
    return { corrupt: true, label: "CORRUPT — startHour is not a finite number", detail: `startHour = ${JSON.stringify(sH)}` };
  if (eH != null && !isNum(eH))
    return { corrupt: true, label: "CORRUPT — endHour is not a finite number", detail: `endHour = ${JSON.stringify(eH)}` };
  if (isNum(sH) && isNum(eH))
    return eH <= sH
      ? { corrupt: true,  label: "CORRUPT — collapsed or inverted block",
          detail: `endHour (${eH}) <= startHour (${sH}); width ${(eH - sH).toFixed(4)}h` }
      : { corrupt: false, label: "NOT CORRUPT — block is healthy", detail: `width ${(eH - sH).toFixed(4)}h` };
  return { corrupt: false, label: "NOT CORRUPT — hours absent/null",
           detail: "a supported state: opHourRange falls back to workStart and derives the end from hpd. A cross-day cascade push writes this routinely." };
}

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
const verdict = diagnose(op);
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

const beforeWidth = isNum(before.startHour) && isNum(before.endHour)
  ? `${(before.endHour - before.startHour).toFixed(4)}h`
  : "n/a (hours absent/null)";

console.log(`OP ${OP_ID}  —  ${job.title} / ${panel.title} / ${op.title}`);
console.log(`  dates                ${op.start} → ${op.end}  (unchanged)`);
console.log(`  hpd                  ${before.hpd}  ${usableHpd ? "(used)" : `(unusable — defaulted to ${DEFAULT_HPD}h)`}`);
console.log(`  workday              ${WORK_START}:00 → ${WORK_END}:00`);
console.log(`\n  BEFORE   startHour ${JSON.stringify(before.startHour)}   endHour ${JSON.stringify(before.endHour)}   width ${beforeWidth}`);
console.log(`  AFTER    startHour ${newStartHour.toFixed(4)}   endHour ${newEndHour.toFixed(4)}   width ${duration.toFixed(4)}h`);
console.log(`           = ${Math.floor(newStartHour)}:${String(Math.round((newStartHour % 1) * 60)).padStart(2, "0")} → ${WORK_END}:00`);
console.log(`\n  VERDICT  ${verdict.label}`);
console.log(`           ${verdict.detail}`);

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written.`);
  console.log(verdict.corrupt
    ? `Re-run with --apply to write the repair above.`
    : `This op does NOT need repairing. --apply will refuse it; --force would override.`);
  process.exit(0);
}

// Refuse to overwrite a healthy op. The detector exists because this script used to announce
// corruption unconditionally, so an operator reading a dry run could be talked into writing
// production data that was never damaged.
if (!verdict.corrupt && !FORCE) {
  console.error(`\nREFUSING TO WRITE — ${verdict.label}.`);
  console.error(`${verdict.detail}`);
  console.error(`Pass --force if you intend to rewrite this op's hours anyway.`);
  process.exit(2);
}
if (!verdict.corrupt && FORCE) console.log(`\n--force: writing over a non-corrupt op by explicit request.`);

op.startHour = newStartHour;
op.endHour = newEndHour;
op.moveLog = [...(op.moveLog || []), {
  fromStart: op.start, fromEnd: op.end, toStart: op.start, toEnd: op.end,
  fromStartHour: before.startHour, toStartHour: newStartHour,
  fromEndHour: before.endHour, toEndHour: newEndHour,
  date: op.start, movedBy: "repair script",
  reason: `Repaired by script: ${verdict.label}${verdict.corrupt ? "" : " (forced)"}; duration rebuilt from hpd`,
}];

const body = JSON.stringify(tasks);
if (!Array.isArray(tasks) || tasks.length === 0) { console.error("REFUSING: tasks array empty"); process.exit(1); }
await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, Body: body, ContentType: "application/json" }));
console.log(`\nWRITTEN. ${tasks.length} jobs preserved, ${raw.length} -> ${body.length} bytes.`);
