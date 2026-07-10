// Scheduled cleanup: prune CANCELLED time-off requests older than 30 days from
// every org's timeoff.json. Cancelled requests are otherwise kept forever, so
// the dataset grows unbounded. Approved/denied/pending records are untouched.
//
// Scheduled via netlify.toml `[functions."timeoff-cleanup"] schedule = "0 5 * * *"`.
// To invoke manually for testing:  netlify functions:invoke timeoff-cleanup
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { readJson, writeJson } from "./_utils/s3.js";

const RETENTION_DAYS = 30;

const client = new S3Client({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET;

async function listAllKeys(prefix) {
  const keys = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) keys.push(obj.Key);
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

export async function handler() {
  const startedAt = Date.now();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffMs = cutoff.getTime();

  let orgsScanned = 0;
  let pruned = 0;
  let filesWritten = 0;
  try {
    const keys = (await listAllKeys("orgs/")).filter((k) => /^orgs\/[^/]+\/timeoff\.json$/.test(k));
    for (const key of keys) {
      orgsScanned++;
      let requests;
      try {
        requests = (await readJson(key)) ?? [];
      } catch {
        continue;
      }
      if (!Array.isArray(requests) || requests.length === 0) continue;

      const kept = requests.filter((r) => {
        if (r?.status !== "cancelled") return true;               // only cancelled expire
        const t = Date.parse(r.decidedAt || r.createdAt || "");
        if (isNaN(t)) return true;                                // keep if undatable
        return t >= cutoffMs;                                     // keep if newer than cutoff
      });

      if (kept.length !== requests.length) {
        pruned += requests.length - kept.length;
        try {
          await writeJson(key, kept);
          filesWritten++;
        } catch (e) {
          console.error("timeoff-cleanup write failed:", key, e);
        }
      }
    }

    const summary = { orgsScanned, pruned, filesWritten, retentionDays: RETENTION_DAYS, elapsedMs: Date.now() - startedAt };
    console.log("timeoff-cleanup complete:", summary);
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (e) {
    console.error("timeoff-cleanup failed:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "cleanup failed" }) };
  }
}
