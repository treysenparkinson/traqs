// Repair overlapping ops on a row. DRY RUN BY DEFAULT — prints every move and writes nothing.
//
//   node tools/repair-overlaps.mjs            plan only, all rows
//   node tools/repair-overlaps.mjs Tyler      plan only, one row
//   node tools/repair-overlaps.mjs --apply    write it (asks nothing; review the plan first)
//
// Only ACTIVE HORIZON ops are touched. History sits where it is: a year of unfinished backlog
// packed forward would push a row months out and describe nothing real.
//
// Priority, matching packActiveRow: worked hours pin, then earliest planned start wins its
// position, then later unworked work slides to the first free slot.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { packActiveRow, rowOverlaps, opInterval } from "../src/statsMath.js";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const KEY = "orgs/MTX2026TRAQS/tasks.json";
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const who = (args.find((a) => !a.startsWith("--")) || "").toLowerCase();

const [tasks, people, prod] = await Promise.all([
  get(KEY), get("orgs/MTX2026TRAQS/people.json"),
  get("orgs/MTX2026TRAQS/productionhours.json").catch(() => []),
]);

const CFG = { workStartH: 8, workEndH: 16, workDays: [1, 2, 3, 4, 5], holidays: [] };
const d0 = new Date();
const TODAY = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
const dsOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const hourOf = (ms) => { const d = new Date(ms); const m = new Date(d); m.setHours(0, 0, 0, 0); return (d - m) / 3600000; };

const producedByOp = new Map();
for (const s of prod || []) if (s && !s.deletedAt && s.opId != null) producedByOp.set(String(s.opId), (producedByOp.get(String(s.opId)) || 0) + (Number(s.hours) || 0));

const opRef = new Map();      // id -> the live op object, for writing
for (const job of tasks) for (const panel of job.subs || []) for (const op of panel.subs || []) opRef.set(String(op.id), { op, panel, job });

let totalMoves = 0, rowsTouched = 0, before = 0, after = 0;
const plan = [];

for (const person of people) {
  if (who && !(person.name || "").toLowerCase().includes(who)) continue;
  const ops = [];
  for (const job of tasks) for (const panel of job.subs || []) for (const op of panel.subs || []) {
    if (!(op.team || []).some((x) => String(x) === String(person.id))) continue;
    if (!op.start || !op.end || op.status === "Finished") continue;
    ops.push({
      id: String(op.id), start: op.start, end: op.end,
      startHour: op.startHour ?? null, endHour: op.endHour ?? null,
      locked: !!op.locked,
      workedHoursShown: Math.max(producedByOp.get(String(op.id)) || 0, Number(op.loggedHours) || 0),
      title: `${panel.title} · ${op.title}`.slice(0, 40),
    });
  }
  if (ops.length < 2) continue;

  const activeBefore = ops.filter((o) => o.end >= TODAY);
  before += rowOverlaps(activeBefore, CFG).length;
  const moves = packActiveRow(ops, { nowDay: TODAY, cfg: CFG });
  if (!moves.length) { after += rowOverlaps(activeBefore, CFG).length; continue; }

  rowsTouched++;
  totalMoves += moves.length;
  console.log(`${person.name}`);
  for (const mv of moves) {
    const o = ops.find((x) => x.id === mv.id);
    const toDs = dsOf(mv.toMs), toH = hourOf(mv.toMs);
    const span = Math.max(0, Math.round((mv.dur / 3600000) * 10) / 10);
    console.log(`   ${o.title}`);
    console.log(`      ${o.start} ${o.startHour ?? "-"}h  ->  ${toDs} ${toH}h   (${span}h of work)`);
    plan.push({ id: mv.id, toDs, toH, dur: mv.dur });
  }
  console.log("");

  // What the row would look like afterwards, by the same predicate.
  const simulated = activeBefore.map((o) => {
    const mv = moves.find((m) => m.id === o.id);
    if (!mv) return o;
    const toDs = dsOf(mv.toMs);
    return { ...o, start: toDs, end: toDs, startHour: hourOf(mv.toMs), endHour: hourOf(mv.toMs + mv.dur) };
  });
  after += rowOverlaps(simulated, CFG).length;
}

console.log(`${totalMoves} move(s) across ${rowsTouched} row(s).`);
console.log(`active-horizon overlaps: ${before} before  ->  ${after} after`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply once the plan above is approved.");
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────────
// Single-day placement: an op that moves lands on one day at the hour it was given. A move
// that cannot be expressed that way is SKIPPED and reported rather than approximated, because
// a silently mangled date is worse than an overlap.
let written = 0, skipped = 0;
for (const mv of plan) {
  const ref = opRef.get(mv.id);
  if (!ref) { skipped++; continue; }
  const endH = mv.toH + mv.dur / 3600000;
  if (endH > CFG.workEndH + 1e-9) { console.log(`SKIP ${mv.id}: ${mv.dur / 3600000}h does not fit in one day from ${mv.toH}h`); skipped++; continue; }
  ref.op.start = mv.toDs;
  ref.op.end = mv.toDs;
  ref.op.startHour = mv.toH;
  ref.op.endHour = endH;
  written++;
}
await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: KEY, Body: JSON.stringify(tasks), ContentType: "application/json" }));
console.log(`\nAPPLIED: ${written} op(s) rewritten, ${skipped} skipped. S3 versioning is on for this bucket.`);
