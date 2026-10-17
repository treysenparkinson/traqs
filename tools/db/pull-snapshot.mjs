#!/usr/bin/env node
// Read-only copy of production's JSON data to this machine (Postgres migration plan, D2).
//
//   node tools/db/pull-snapshot.mjs            -> db/snapshots/<today>/orgs/...
//
// ONLY ListObjectsV2 and GetObject: nothing in this file can write, copy or delete in S3.
// Pulls every *.json under orgs/ (including user-settings/ and _index/), never attachments
// (binaries stay in S3 and are not part of the migration) and never backups/. The folder is
// git-ignored; it holds emails, encrypted PINs and pay hours and must not leave this machine.
// Credentials come from the repo's .env (MY_AWS_*, S3_BUCKET), the same ones `netlify dev` reads.

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const env = Object.fromEntries(readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
  .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const need = ["S3_BUCKET", "MY_AWS_REGION", "MY_AWS_ACCESS_KEY_ID", "MY_AWS_SECRET_ACCESS_KEY"];
for (const k of need) if (!env[k]) { console.error(`missing ${k} in .env`); process.exit(2); }

const s3 = new S3Client({ region: env.MY_AWS_REGION, credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY } });
const day = new Date().toISOString().slice(0, 10);
const out = path.join(ROOT, "db", "snapshots", day);

const keys = [];
let token;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: "orgs/", ContinuationToken: token }));
  for (const o of page.Contents || []) if (o.Key.endsWith(".json") && !o.Key.includes("/attachments/")) keys.push({ key: o.Key, size: o.Size });
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

let bytes = 0;
const perOrg = {};
for (const { key } of keys) {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  const body = Buffer.from(await res.Body.transformToByteArray());
  const file = path.join(out, ...key.split("/"));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  bytes += body.length;
  const org = key.split("/")[1];
  perOrg[org] = (perOrg[org] || 0) + 1;
}
writeFileSync(path.join(out, "MANIFEST.json"), JSON.stringify({ pulledAt: new Date().toISOString(), bucketKeys: keys.length, bytes, perOrg }, null, 1));
console.log(`pulled ${keys.length} JSON objects (${(bytes / 1024).toFixed(0)} KB) into db/snapshots/${day}/`);
for (const [org, n] of Object.entries(perOrg).sort()) console.log(`  ${org}: ${n} files`);
