// READ-ONLY. Recompute, for one op, the numbers the schedule derives for its bar — so a
// suspected geometry glitch can be checked against arithmetic rather than a screenshot.
//
//   node tools/diag-bar.mjs tmzn98fek

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { workedSpansByOp, mergeSpans, spansToPct, complementSpans, openSessionEnd, productiveHoursBetween } from "../src/statsMath.js";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const [tasks, people, prod] = await Promise.all([
  get("orgs/MTX2026TRAQS/tasks.json"), get("orgs/MTX2026TRAQS/people.json"),
  get("orgs/MTX2026TRAQS/productionhours.json").catch(() => []),
]);

const want = String(process.argv[2] || "");
let found = null;
for (const j of tasks) for (const pa of j.subs || []) for (const o of pa.subs || []) if (String(o.id) === want) found = { o, pa, j };
if (!found) { console.log(`no op ${want}`); process.exit(0); }
const op = found.o;

const WORK_START = 8, WORK_END = 16, PHPD = 7.5;
const CFG = { workStartH: WORK_START, workEndH: WORK_END, deadWindows: [{ start: 12, dur: 0.5 }], workDays: [1, 2, 3, 4, 5], holidays: [] };
const hourTs = (ds, h) => new Date(ds + "T00:00:00").getTime() + h * 3600000;
const iso = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 16);
const now = Date.now();

console.log(`${found.j.jobNumber || found.j.title} / ${found.pa.title} / ${op.title}   (${op.id})`);
console.log(`stored:  ${op.start} ${op.startHour ?? "(null)"}h .. ${op.end} ${op.endHour ?? "(null)"}h   hpd=${op.hpd}  status=${op.status}`);
console.log(`team:    ${(op.team || []).map(t => (people.find(p => String(p.id) === String(t)) || {}).name || t).join(", ")}`);
console.log(`now:     ${iso(now)}\n`);

// opHourRange, as the render computes it
const plannedS = hourTs(op.start, op.startHour ?? WORK_START);
const plannedE = op.start === op.end
  ? hourTs(op.end, op.endHour ?? Math.min((op.startHour ?? WORK_START) + (op.hpd || 0), WORK_END))
  : hourTs(op.end, WORK_END);
console.log(`PLANNED WINDOW (opHourRange):  ${iso(plannedS)}  ..  ${iso(plannedE)}`);
const cursorPct = plannedE > plannedS ? ((now - plannedS) / (plannedE - plannedS)) * 100 : 0;
console.log(`cursor across it:              ${cursorPct.toFixed(1)}%`);

// The RENDERED extent comes from the hours budget, not from op.end.
const teamSz = Math.max(1, (op.team || []).length);
const perPerson = ((op.hpd || 0) > 0 ? op.hpd / teamSz : PHPD);
console.log(`\nhours budget per person:       ${perPerson}h  (${(perPerson / PHPD).toFixed(2)} working days)`);
console.log(`productive hours planned->now: ${productiveHoursBetween(plannedS, now, CFG).toFixed(2)}h`);

// Worked spans, including the open clock
const stored = workedSpansByOp(prod);
const live = [];
for (const p of people) {
  const jc = p.activeJobClock;
  if (!jc?.clockIn || String(jc.opId) !== String(op.id)) continue;
  const a = Date.parse(jc.clockIn);
  const { endMs, frozen, paused } = openSessionEnd({ clockInMs: a, pausedAt: jc.pausedAt, frozenAtMs: jc.frozenAtMs, nowMs: now, cfg: CFG });
  console.log(`\nLIVE CLOCK: ${p.name}  ${iso(a)} -> ${iso(endMs)}${frozen ? "  FROZEN" : ""}${paused ? "  (paused)" : ""}`);
  if (endMs > a) live.push([a, endMs]);
}
const spansAbs = mergeSpans([...(stored.get(String(op.id)) || []), ...live]);
console.log(`worked spans (absolute):       ${spansAbs.length ? spansAbs.map(([a, b]) => `${iso(a)}..${iso(b)}`).join(", ") : "(none)"}`);

const spansPct = spansToPct(spansAbs, plannedS, plannedE);
console.log(`worked spans across the bar:   ${JSON.stringify(spansPct.map(([a, b]) => [+a.toFixed(1), +b.toFixed(1)]))}`);
const C = Math.max(0, Math.min(100, cursorPct));
console.log(`\nWHAT activeBarFill PAINTS at C=${C.toFixed(1)}%:`);
console.log(`   colour  ${C < 100 ? `${C.toFixed(1)}% -> 100%` : "(none — cursor at or past the end)"}`);
console.log(`   idle    ${JSON.stringify(complementSpans(spansPct, 0, 100).map(([a, b]) => [+a.toFixed(1), +b.toFixed(1)]))}`);
console.log(`   hatch   over the worked spans above`);
