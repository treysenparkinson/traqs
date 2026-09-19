// READ-ONLY: find ops that would actually exercise the reservoir drain.
// An op qualifies only if the clocking-in person is on op.team AND the op has a
// scheduled block to drain — a teamless or unscheduled op gives no reservoir.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ORG = process.argv[3] || "MTX2026TRAQS";
const ME = process.argv[2] || "99";
const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const onTeam = (team, pid) => (team || []).some((x) => sameId(x, pid));

const [people, tasks] = await Promise.all([get(`orgs/${ORG}/people.json`), get(`orgs/${ORG}/tasks.json`)]);
const byId = new Map(people.map((p) => [String(p.id), p]));
const TODAY = new Date().toISOString().slice(0, 10);

const rows = [];
for (const job of tasks)
  for (const panel of job.subs || [])
    for (const op of panel.subs || [])
      rows.push({ op, panel, job });

const mine = rows.filter((r) => onTeam(r.op.team, ME) && r.op.status !== "Finished");
console.log(`=== ops where id "${ME}" is ON op.team, not Finished: ${mine.length} ===\n`);
for (const { op, panel, job } of mine.slice(0, 25)) {
  const sched = op.start ? `${op.start}${op.end && op.end !== op.start ? "→" + op.end : ""}` : "UNSCHEDULED";
  const when = !op.start ? "no block" : op.start === TODAY ? "TODAY" : op.start > TODAY ? "future" : "past";
  console.log(`  ${op.id}  [${when}] ${sched}  hours ${op.startHour ?? "-"}→${op.endHour ?? "-"}  hpd ${op.hpd ?? "-"}  status ${op.status || "-"}`);
  console.log(`      ${job.title} / ${panel.title} / ${op.title}`);
}
if (!mine.length) console.log("  NONE — you are not on any unfinished op's team.");

// Best candidates: on my team, scheduled today or later, so a reservoir exists to drain.
const best = mine.filter((r) => r.op.start && r.op.start >= TODAY);
console.log(`\n=== BEST for a drain test (on team + scheduled today//future): ${best.length} ===`);
for (const { op, panel, job } of best.slice(0, 10))
  console.log(`  ${op.id}  ${op.start}  ${job.title} / ${panel.title} / ${op.title}`);
if (!best.length) console.log("  none — add yourself to a scheduled op's team in the admin UI.");

// Fallback: who else is on a scheduled op's team, in case signing in as them is easier.
const others = new Map();
for (const { op, panel, job } of rows) {
  if (op.status === "Finished" || !op.start || op.start < TODAY) continue;
  for (const t of op.team || []) {
    const k = String(t);
    if (k === String(ME)) continue;
    if (!others.has(k)) others.set(k, []);
    others.get(k).push(`${op.id} ${op.start} ${job.title}/${op.title}`);
  }
}
console.log(`\n=== other people on a today/future scheduled op's team: ${others.size} ===`);
for (const [pid, list] of [...others.entries()].slice(0, 12)) {
  const p = byId.get(pid);
  console.log(`  id ${JSON.stringify(pid)}  ${p ? p.name : "(NOT IN people.json)"}  role ${p?.userRole ?? "?"}  email ${p?.email ? "yes" : "no"}  ops ${list.length}`);
  console.log(`      e.g. ${list[0]}`);
}
