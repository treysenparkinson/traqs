/**
 * One-time patch: assigns proper string UIDs to any person with id: null in S3.
 * Also patches task team arrays to replace null with the new UID.
 *
 * Usage:
 *   node scripts/fix-null-person-ids.mjs
 *
 * Requires env vars (reads from .env at project root):
 *   S3_BUCKET, MY_AWS_REGION, MY_AWS_ACCESS_KEY_ID, MY_AWS_SECRET_ACCESS_KEY
 */

import { readFileSync } from "fs";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ─── Load .env ───────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env");
try {
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* .env not found, use process.env */ }

const ORG = process.argv[2] || "MATRIX";
const uid = () => "t" + Math.random().toString(36).substr(2, 8);

const client = new S3Client({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET;

async function readJson(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function writeJson(key, value) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: JSON.stringify(value),
    ContentType: "application/json",
  }));
}

async function run() {
  const peopleKey = `orgs/${ORG}/people.json`;
  const tasksKey  = `orgs/${ORG}/tasks.json`;

  const people = await readJson(peopleKey);
  const tasks  = await readJson(tasksKey);

  const nullPeople = people.filter(p => p.id === null || p.id === undefined);
  if (!nullPeople.length) { console.log("No null-ID people found. Nothing to patch."); return; }

  // Build a map: null → newUid (per person by index)
  const idMap = new Map();
  const patchedPeople = people.map(p => {
    if (p.id !== null && p.id !== undefined) return p;
    const newId = uid();
    idMap.set(p, newId); // keyed by object ref
    console.log(`  Patching person "${p.name}": null → ${newId}`);
    return { ...p, id: newId };
  });

  // Patch tasks: replace null in team arrays with the new IDs.
  // Since all null-ID people map to different new IDs we can't distinguish them
  // if there are multiple null entries, but we'll replace the first null → first new id, etc.
  const nullIds = [...idMap.values()];

  function patchTeam(team) {
    if (!Array.isArray(team)) return team;
    let nullIdx = 0;
    return team.map(id => {
      if (id === null) {
        const replacement = nullIds[nullIdx % nullIds.length];
        nullIdx++;
        return replacement;
      }
      return id;
    });
  }

  const patchedTasks = (tasks || []).map(t => ({
    ...t,
    team: patchTeam(t.team),
    subs: (t.subs || []).map(s => ({
      ...s,
      team: patchTeam(s.team),
      subs: (s.subs || []).map(op => ({ ...op, team: patchTeam(op.team) })),
    })),
  }));

  console.log(`\nWriting ${peopleKey}...`);
  await writeJson(peopleKey, patchedPeople);
  console.log(`Writing ${tasksKey}...`);
  await writeJson(tasksKey, patchedTasks);
  console.log("Done.");
}

run().catch(e => { console.error(e); process.exit(1); });
