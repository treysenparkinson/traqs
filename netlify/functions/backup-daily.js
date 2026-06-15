// Daily S3 snapshot of every org's data → backups/{YYYY-MM-DD}/orgs/...
//
// Scheduled via netlify.toml `[functions."backup-daily"] schedule = "0 5 * * *"`
// (5am UTC = midnight EST = off-hours for US users).
//
// Idempotent: re-running on the same day skips files that already have a
// destination object for that date. Each run also prunes any backup whose
// date prefix is older than RETENTION_DAYS.
//
// To invoke manually for testing:  netlify functions:invoke backup-daily
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

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

async function copyIfMissing(srcKey, destKey) {
  // Check first so a same-day re-run is cheap (HeadObject is cheaper than Copy).
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: destKey }));
    return "skipped";
  } catch (e) {
    const code = e.$metadata?.httpStatusCode;
    if (code !== 404 && e.name !== "NotFound" && e.name !== "NoSuchKey") throw e;
  }
  await client.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: encodeURIComponent(`${BUCKET}/${srcKey}`),
    Key: destKey,
  }));
  return "copied";
}

async function pruneOldBackups(cutoffDateStr) {
  const allBackupKeys = await listAllKeys("backups/");
  let pruned = 0;
  for (const key of allBackupKeys) {
    const m = key.match(/^backups\/(\d{4}-\d{2}-\d{2})\//);
    if (!m) continue;
    if (m[1] < cutoffDateStr) {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      pruned++;
    }
  }
  return pruned;
}

export async function handler() {
  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  try {
    const sourceKeys = await listAllKeys("orgs/");
    let copied = 0;
    let skipped = 0;
    for (const key of sourceKeys) {
      const result = await copyIfMissing(key, `backups/${today}/${key}`);
      if (result === "copied") copied++;
      else skipped++;
    }

    const pruned = await pruneOldBackups(cutoffStr);

    const summary = {
      date: today,
      copied,
      skipped,
      pruned,
      cutoffStr,
      retentionDays: RETENTION_DAYS,
      elapsedMs: Date.now() - startedAt,
    };
    console.log("backup-daily complete:", summary);
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (e) {
    console.error("backup-daily failed:", e);
    return { statusCode: 500, body: JSON.stringify({ error: "Backup failed" }) };
  }
}
