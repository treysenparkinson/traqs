// READ-ONLY diagnostic: dump the live activeJobClock sessions and decide, for each,
// whether the clocked-in person is on the team of the op they clocked into.
// Answers the reservoirOpId-null question without a blind re-test.
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";

// .env is gitignored; parse it rather than requiring a dotenv dep.
const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BUCKET = env.S3_BUCKET;
const ORG = process.argv[2] || "MTX2026TRAQS";
const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});

const get = async (key) => {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return JSON.parse(await r.Body.transformToString());
};

// The same comparison the app uses — the whole point is to reproduce its verdict,
// not to re-implement it more leniently.
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const onTeam = (team, pid) => (team || []).some((x) => sameId(x, pid));

const findOp = (tasks, opId) => {
  for (const job of tasks || [])
    for (const panel of job.subs || [])
      for (const op of panel.subs || [])
        if (sameId(op.id, opId)) return { op, panel, job };
  return null;
};

console.log(`bucket=${BUCKET}  org=${ORG}\n`);
const [people, tasks] = await Promise.all([
  get(`orgs/${ORG}/people.json`),
  get(`orgs/${ORG}/tasks.json`),
]);
console.log(`people: ${people.length}   jobs: ${tasks.length}\n`);

const active = people.filter((p) => p.activeJobClock && p.activeJobClock.clockIn);
if (!active.length) {
  console.log("NO ACTIVE JOB CLOCK on any person right now.");
  console.log("(The session may have been clocked out since the test; a clock-out nulls activeJobClock.)");
}

for (const p of active) {
  const jc = p.activeJobClock;
  const found = findOp(tasks, jc.opId);
  const team = found?.op?.team;
  const member = onTeam(team, p.id);
  console.log("─".repeat(64));
  // The KEY SET is the diagnosis, not the values, and absent is NOT the same as null.
  // The server writes sessionId and drainCheckpoint from one conditional spread
  // (timeclock.js jobClockIn), so drainCheckpoint's ABSENCE proves no sessionId arrived —
  // whereas a null would mean something ran and decided. Printing only values collapses
  // that signal and reports a real bug where there is none.
  //
  // A record with no session fields at all was long blamed on the kiosk. That was wrong:
  // iOS (APIService.swift) and Android (ApiService.kt) both post the seven job fields and
  // omit the session ones, and activeClockIn.source describes the PAY clock, not this one.
  // The server now derives the session when a client sends none, so the shape should not
  // recur; if it does, the derivation was skipped and the server log says so.
  const KEYS = Object.keys(jc);
  const SESSION_KEYS = ["sessionId", "reservoirOpId", "drainCheckpoint", "sessionSnapshot"];
  const missing = SESSION_KEYS.filter((k) => !(k in jc));
  console.log(`activeJobClock keys  ${JSON.stringify(KEYS)}`);
  console.log(`session fields       ${missing.length === 0 ? "all present" : "MISSING " + JSON.stringify(missing)}`);
  if (missing.length === SESSION_KEYS.length) {
    console.log(`  >> NO SESSION AT ALL. Not a team-gate failure.`);
    console.log(`  >> Since the server-side derivation landed, jobClockIn builds a session`);
    console.log(`  >> even when the client sends none, so a record in this state either`);
    console.log(`  >> predates that fix or hit the tasks-read fallback (logged server-side`);
    console.log(`  >> as "jobClockIn: session derivation skipped").`);
    console.log(`  >> NOTE activeClockIn.source below is the PAY clock's source, not the`);
    console.log(`  >> job clock's. It does not identify which client made this clock-in.`);
  }
  console.log(`activeClockIn.source ${p.activeClockIn?.source ?? "(none)"}`);
  console.log(`person            ${p.name}  (id ${JSON.stringify(p.id)}, type ${typeof p.id})`);
  console.log(`userRole          ${p.userRole}`);
  console.log(`clockIn           ${jc.clockIn}`);
  console.log(`opId clocked into ${JSON.stringify(jc.opId)}  (${jc.jobTitle || "?"} / ${jc.panelTitle || "?"} / ${jc.opTitle || "?"})`);
  console.log(`op found in tasks ${found ? "yes" : "NO — op not present"}`);
  console.log(`op.team           ${JSON.stringify(team)}`);
  console.log(`  entry types     ${JSON.stringify((team || []).map((x) => typeof x))}`);
  console.log(`ON TEAM?          ${member ? "YES" : "NO"}`);
  console.log(`reservoirOpId     ${jc.reservoirOpId === undefined ? "(absent)" : JSON.stringify(jc.reservoirOpId)}`);
  console.log(`drainCheckpoint   ${jc.drainCheckpoint || "(absent)"}`);
  console.log(`pausedAt          ${jc.pausedAt || "(none)"}`);
  console.log(`frozenAtMs        ${jc.frozenAtMs || "(none)"}`);
  console.log(`totalPausedMs     ${jc.totalPausedMs ?? "(absent)"}`);
  console.log(`pausedMsAtCheckpt ${jc.pausedMsAtCheckpoint ?? "(absent)"}`);

  // absent !== null, and the whole diagnosis turns on the difference:
  //   absent  the client sent no reservoirOpId and the server derived none (pre-fix record,
  //           or the derivation's tasks-read fallback fired)
  //   null    a team check RAN and said no — the client's, or since the derivation landed,
  //           the server's. Correct behaviour, not a bug.
  // Collapsing them with ?? reported a real bug on every record that simply had no session.
  const expected = found && member ? jc.opId : null;
  const hasReservoirKey = "reservoirOpId" in jc;
  const actual = hasReservoirKey ? jc.reservoirOpId : undefined;
  console.log(`
VERDICT`);
  if (missing.length === SESSION_KEYS.length) {
    console.log(`  NO SESSION — nothing was written to diagnose. Not a team-gate issue. See above.`);
  } else if (!hasReservoirKey) {
    console.log(`  NO RESERVOIR FIELD — a session exists but reservoirOpId was never written.`);
    console.log(`  Pre-derivation record, or the derivation was skipped. Re-clock to confirm.`);
  } else if (!member && actual === null) {
    console.log(`  EXPECTED — not on the team, so reservoirOpId is correctly null. Drain cannot render.`);
  } else if (member && actual === null) {
    console.log(`  REAL BUG — person IS on the team but reservoirOpId is null. A team check ran and failed.`);
  } else if (actual != null && !member) {
    console.log(`  ODD — reservoirOpId populated despite not being on the team.`);
  } else {
    console.log(`  OK — reservoirOpId populated and person is on the team; drain should render. Look at the mask.`);
  }
  console.log(`  (expected ${JSON.stringify(expected)}, actual ${hasReservoirKey ? JSON.stringify(actual) : "(absent)"})`);
}
console.log("─".repeat(64));
