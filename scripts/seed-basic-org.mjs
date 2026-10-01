#!/usr/bin/env node
// Seed a BASIC-tier org so the lane behaviour can actually be looked at.
//
// Matrix is on Business, so none of #119-#123 has live data behind it. The fixture suite
// (scripts/basic-lanes-test.mjs) proves the arithmetic; what it cannot prove is that the
// render looks right — lanes are a visual judgement and no assertion settles one.
//
// DO NOT FLIP MATRIX TO BASIC TO LOOK. The tier changes what the schedule WRITES, not only
// what it draws: enforceNoOverlap and reflowJob both branch on it, so a few minutes on the
// wrong tier with anyone editing could leave real data reshaped. A separate org costs one S3
// prefix.
//
//   node scripts/seed-basic-org.mjs              # dry run
//   node scripts/seed-basic-org.mjs --apply
//   node scripts/seed-basic-org.mjs --apply --org TRAQSBASIC
//
// The org is created with billing.json ABSENT, which is what makes it Basic — billing.js
// defaults to { tier: "basic" } and provisioning to Business is manual. Nothing here can
// grant Business, by design.
//
// The seed mirrors the fixture cases one-for-one, so what you see on screen can be compared
// against an assertion that already passed:
//
//   Row 1 (Ada)    two bars in the same range          → the row splits in two
//   Row 2 (Ben)    a 2h bar worked 6h, then a bar at 11:00
//                                                      → #121/#123: they must NOT overlap
//   Row 3 (Cal)    a bar with no stored startHour beside one at 08:00
//                                                      → #120: both laned from 08:00
//   Row 4 (Dee)    a 12h bar spanning two days, and a 2h bar on day two
//                                                      → #119: the TAIL shares day two
//   Row 5 (Eve)    three bars at 08:00 and one alone at 15:00
//                                                      → lanesTotal is local: the 15:00 bar
//                                                        is full height

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const APPLY = args.includes("--apply");
const ORG = val("--org", "TRAQSBASIC");

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const s3 = new S3Client({ region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });

// Monday of the coming week, so the bars land on working days whenever this is run.
const monday = (() => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
})();
const plus = (ds, n) => { const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const D1 = monday, D2 = plus(monday, 1);

const P = (id, name) => ({ id, name, userRole: "user", color: "#64748b", canClockInOut: true });
const people = [
  { id: "admin", name: "Basic Admin", userRole: "admin", color: "#0a84ff", canClockInOut: true },
  P("ada", "Ada"), P("ben", "Ben"), P("cal", "Cal"), P("dee", "Dee"), P("eve", "Eve"),
];

// One flat sub per job — the shape the Basic create path makes, and the only shape the simple
// editor can describe (#159).
let n = 0;
const job = (title, { who, start, end = start, startHour, hpd }) => {
  n++;
  return {
    id: `bj${n}`, title, jobType: "general", start, end, status: "Not Started", pri: "Medium",
    notes: "", deps: [], clientId: null, color: ["#0a84ff", "#30d158", "#ff9f0a", "#bf5af2", "#ff375f"][n % 5],
    subs: [{ id: `bs${n}`, title, start, end, ...(startHour == null ? {} : { startHour }), hpd, team: [who] }],
  };
};
const tasks = [
  job("Ada — morning A", { who: "ada", start: D1, startHour: 8, hpd: 2 }),
  job("Ada — morning B", { who: "ada", start: D1, startHour: 8, hpd: 2 }),
  job("Ben — 2h estimate, 6h worked", { who: "ben", start: D1, startHour: 8, hpd: 2 }),
  job("Ben — starts at 11:00", { who: "ben", start: D1, startHour: 11, hpd: 2 }),
  job("Cal — no stored start hour", { who: "cal", start: D1, startHour: null, hpd: 2 }),
  job("Cal — starts at 08:00", { who: "cal", start: D1, startHour: 8, hpd: 2 }),
  job("Dee — 12h across two days", { who: "dee", start: D1, end: D2, startHour: 8, hpd: 12 }),
  job("Dee — day two only", { who: "dee", start: D2, startHour: 8, hpd: 2 }),
  job("Eve — 08:00 one", { who: "eve", start: D1, startHour: 8, hpd: 2 }),
  job("Eve — 08:00 two", { who: "eve", start: D1, startHour: 8, hpd: 2 }),
  job("Eve — 08:00 three", { who: "eve", start: D1, startHour: 8, hpd: 2 }),
  job("Eve — alone at 15:00", { who: "eve", start: D1, startHour: 15, hpd: 1 }),
];

// Ben's overrun is the #121/#123 case, and it has to be real worked time rather than a field
// on the task — the bar grows because barLengthHours sees 6h against a 2h estimate.
const benOp = tasks[2].subs[0];
const productionhours = [{
  id: "bjs1", personId: "ben", jobId: tasks[2].id, panelId: null, opId: benOp.id,
  jobTitle: tasks[2].title, panelTitle: null, opTitle: benOp.title,
  clockIn: `${D1}T14:00:00.000Z`, clockOut: `${D1}T20:00:00.000Z`, hours: 6, date: D1, source: "manual",
}];

const settings = {
  workStart: "08:00", workEnd: "17:00", workDays: [1, 2, 3, 4, 5], holidays: [],
  lunch: { durationMinutes: 60, time: "12:00" }, breaks: [], timeZone: "America/Denver",
  hpd: 7.5, trackLunch: true, trackBreaks: true,
};

// config.json is what makes the CODE resolve on the login screen (org.js GET reads it), and
// adminEmail is what makes you a member once you are through Auth0: requireOrgMember decides
// membership by EMAIL against people.json and config.adminEmail(s), not by an Auth0 org
// binding — so no Auth0 organization has to be created for this to be usable.
const ADMIN_EMAIL = val("--admin", "treysen@matrixpci.com");
// The Auth0 connection the login screen offers. Without it the sign-in falls back to the
// default (Google) and the account that administers this org cannot reach it — org.js GET
// passes `connection` straight through to the welcome screen. Matched to Matrix so the same
// account signs into both. Carried here as well as on the live object so a re-seed does not
// silently drop it and send the login back to Google.
const CONNECTION = val("--connection", "matrixpci");
const config = {
  name: "TRAQS Basic (test)",
  adminEmail: ADMIN_EMAIL,
  connection: CONNECTION,
  // No domain restriction. Matrix has one (matrixpci.com); this org deliberately does not,
  // because a domain allowlist is a Business control and this org exists to be Basic.
  domain: null,
  createdAt: new Date().toISOString(),
  note: "Seeded by scripts/seed-basic-org.mjs to look at Basic-tier lane behaviour (#119-#123). Not a customer org.",
};

const files = {
  "config.json": config,
  "people.json": people, "tasks.json": tasks, "clients.json": [], "settings.json": settings,
  "payhours.json": [], "productionhours.json": productionhours, "groups.json": [], "messages.json": [],
};

console.log(`org ${ORG} — BASIC (billing.json is deliberately absent; billing.js defaults to basic)`);
console.log(`week of ${D1}\n`);
for (const [f, v] of Object.entries(files)) {
  console.log(`  ${f.padEnd(22)} ${Array.isArray(v) ? `${v.length} rows` : `${Object.keys(v).length} keys`}`);
}
console.log(`\n  ${tasks.length} jobs across ${people.length - 1} people, one flat sub each`);

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  console.log("Nothing is written to Matrix — this only ever touches orgs/" + ORG + "/.");
  process.exit(0);
}

// Refuse to overwrite an org that already has tasks, and refuse point-blank to touch a
// Business org — the whole point is that this never lands on real data.
try {
  const existing = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: `orgs/${ORG}/tasks.json` }))).Body.transformToString());
  if (Array.isArray(existing) && existing.some(t => t && !t.deletedAt && !String(t.id).startsWith("bj"))) {
    console.error(`\nREFUSED: orgs/${ORG}/tasks.json holds jobs this script did not create.`);
    process.exit(1);
  }
} catch { /* absent is the expected case */ }
try {
  const billing = JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: `orgs/${ORG}/billing.json` }))).Body.transformToString());
  if ((billing?.tier || "basic") === "business") {
    console.error(`\nREFUSED: orgs/${ORG} is on Business. This seed is for a Basic org only.`);
    process.exit(1);
  }
} catch { /* absent is the expected case, and absent means basic */ }

for (const [f, v] of Object.entries(files)) {
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: `orgs/${ORG}/${f}`, Body: JSON.stringify(v), ContentType: "application/json" }));
  console.log(`  wrote orgs/${ORG}/${f}`);
}
console.log(`\nSeeded. Sign in with org code ${ORG} and open the Schedule on the week of ${D1}.`);
console.log(`Membership is by email: ${ADMIN_EMAIL} is config.adminEmail, so no Auth0`);
console.log("organization needs creating — requireOrgMember matches the email on the token.");
