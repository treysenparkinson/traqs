// READ-ONLY: describe an op the way it appears on screen, so a human can find it.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ORG = "MTX2026TRAQS";
const ME = "99";
const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});
const get = async (k) => JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: k }))).Body.transformToString());
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const onTeam = (t, p) => (t || []).some((x) => sameId(x, p));

const [people, clients, tasks] = await Promise.all([
  get(`orgs/${ORG}/people.json`),
  get(`orgs/${ORG}/clients.json`).catch(() => []),
  get(`orgs/${ORG}/tasks.json`),
]);
const me = people.find((p) => sameId(p.id, ME));
const TODAY = new Date().toISOString().slice(0, 10);
const nameOf = (id) => people.find((p) => sameId(p.id, id))?.name || `?${id}`;

const targets = (process.argv.slice(2).length ? process.argv.slice(2) : ["tu0kgimua", "td9my8ilu", "tplhu0bky"]);

for (const job of tasks)
  for (const panel of job.subs || [])
    for (const op of panel.subs || []) {
      if (!targets.includes(String(op.id))) continue;
      const cl = clients.find?.((c) => sameId(c.id, job.clientId));
      console.log("═".repeat(70));
      console.log(`OP ${op.id}`);
      console.log(`  Job    (top level)   "${job.title}"`);
      console.log(`  Panel  (phase)       "${panel.title}"`);
      console.log(`  Op     (task)        "${op.title}"`);
      console.log(`  Client               ${cl ? `"${cl.name}"` : job.clientId ? `(id ${job.clientId}, not in clients.json)` : "(none)"}`);
      console.log(`  Job number           ${job.jobNumber || "(none)"}`);
      console.log(`  Dates                ${op.start}${op.end && op.end !== op.start ? " → " + op.end : ""}   (today is ${TODAY})`);
      console.log(`  Hours                ${op.startHour ?? "-"} → ${op.endHour ?? "-"}    hpd ${op.hpd ?? "-"}`);
      console.log(`  Status               ${op.status || "(none)"}`);
      console.log(`  Colour              op:${op.color || "(inherit)"}  panel:${panel.color || "(none)"}  job:${job.color || "(none)"}`);
      console.log(`  Team                 ${JSON.stringify(op.team)}  ->  ${(op.team || []).map(nameOf).join(", ") || "(empty)"}`);
      console.log(`  "99" on team?        ${onTeam(op.team, ME) ? "YES" : "NO"}`);
      console.log(`\n  BAR LABEL in the team timeline is built as`);
      console.log(`      \`\${panel.title} · \${op.title}\` + assignee`);
      console.log(`   => "${panel.title} · ${op.title}"`);
      console.log(`  ROW it appears on:   ${me?.name} (because "99" is on op.team)`);
    }
console.log("═".repeat(70));
console.log(`\nYour row is "${me?.name}" — colour swatch ${me?.color || "(none)"}.`);
