// RE-KEY AN ORG'S S3 PREFIX. Dry run by default.
//
//   node tools/rekey-org.mjs OLDCODE NEWCODE              show what would move
//   node tools/rekey-org.mjs OLDCODE NEWCODE --execute    do it
//
// It NEVER deletes the old prefix. That is a separate, later, human decision —
// and it is the moment the deferred failure this tool exists to prevent would
// otherwise surface.
//
// WHAT "DONE" MEANS HERE. Not "the copy succeeded". Attachment keys live inside
// messages.json and tasks.json as full `orgs/{code}/attachments/...` strings, so
// a copy moves the objects and leaves every reference pointing at the old
// prefix. While that prefix still exists the references resolve and nothing
// looks wrong; they break when it is deleted, a week later, disconnected from
// the cause. So this tool reports success only when every reference inside the
// MIGRATED data resolves against the NEW prefix — see scripts/rekey-test.mjs,
// where a fixture with the rewrite skipped is required to fail.

import {
  S3Client, ListObjectsV2Command, CopyObjectCommand,
  HeadObjectCommand, GetObjectCommand, PutObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import {
  collectOrgRefs, rewriteOrgRefs, verifyRefsResolve, REF_BEARING_FILES,
} from "../netlify/functions/_utils/rekey.js";
import { isValidOrgCode } from "../netlify/functions/_utils/orgcode.js";

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const BUCKET = env.S3_BUCKET;
const s3 = new S3Client({
  region: env.MY_AWS_REGION,
  credentials: { accessKeyId: env.MY_AWS_ACCESS_KEY_ID, secretAccessKey: env.MY_AWS_SECRET_ACCESS_KEY },
});

const [OLD, NEW, ...flags] = process.argv.slice(2);
const EXECUTE = flags.includes("--execute");

if (!OLD || !NEW) {
  console.error("usage: node tools/rekey-org.mjs OLDCODE NEWCODE [--execute]");
  process.exit(2);
}
for (const [label, code] of [["old", OLD], ["new", NEW]]) {
  if (!isValidOrgCode(code)) {
    console.error(`${label} code ${JSON.stringify(code)} is not a valid org code`);
    process.exit(2);
  }
}
if (OLD === NEW) { console.error("old and new codes are the same"); process.exit(2); }

const listAll = async (prefix) => {
  const keys = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents ?? []) keys.push({ key: o.Key, size: o.Size || 0 });
    token = r.IsTruncated ? r.NextContinuationToken : null;
  } while (token);
  return keys;
};
const getJson = async (key) =>
  JSON.parse(await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body.transformToString());
const exists = async (key) => {
  try { await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch { return false; }
};

const srcPrefix = `orgs/${OLD}/`;
const dstPrefix = `orgs/${NEW}/`;

console.log(`${EXECUTE ? "EXECUTING" : "DRY RUN"}   ${srcPrefix}  ->  ${dstPrefix}`);
console.log("");

// ── 1. what is there ──
const source = await listAll(srcPrefix);
if (!source.length) { console.error(`nothing under ${srcPrefix} — wrong code?`); process.exit(1); }

const existing = await listAll(dstPrefix);
if (existing.length) {
  console.error(`REFUSING: ${dstPrefix} already holds ${existing.length} object(s).`);
  console.error("Migrating into an occupied prefix would interleave two orgs' data.");
  process.exit(1);
}

const bytes = source.reduce((a, o) => a + o.size, 0);
const attachments = source.filter((o) => o.key.includes("/attachments/")).length;
console.log(`objects to copy     ${String(source.length).padStart(5)}   ${(bytes / 1048576).toFixed(1)} MB`);
console.log(`  of which attachments ${String(attachments).padStart(3)}`);
console.log("");

// ── 2. what references would be rewritten ──
console.log("embedded references (the part a plain copy misses):");
const plans = [];
let totalRefs = 0;
for (const file of REF_BEARING_FILES) {
  const key = srcPrefix + file;
  if (!source.some((o) => o.key === key)) { console.log(`  ${file.padEnd(16)} not present`); continue; }
  let data;
  try { data = await getJson(key); }
  catch (e) { console.error(`  ${file.padEnd(16)} UNREADABLE — ${e.message}`); process.exit(1); }
  const refs = collectOrgRefs(data, OLD);
  const { value, changed } = rewriteOrgRefs(data, OLD, NEW);
  totalRefs += changed;
  plans.push({ file, destKey: dstPrefix + file, value, changed });
  console.log(`  ${file.padEnd(16)} ${String(changed).padStart(4)} key(s) would be rewritten`);
  for (const r of refs.slice(0, 3)) console.log(`      ${r}`);
  if (refs.length > 3) console.log(`      … and ${refs.length - 3} more`);
}
console.log("");

if (!EXECUTE) {
  console.log(`DRY RUN — nothing was written.`);
  console.log(`Would copy ${source.length} objects and rewrite ${totalRefs} embedded reference(s).`);
  console.log(`Re-run with --execute to perform it. The old prefix is never deleted.`);
  process.exit(0);
}

// ── 3. copy ──
console.log("copying…");
let copied = 0;
for (const { key } of source) {
  const destKey = dstPrefix + key.slice(srcPrefix.length);
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET, Key: destKey, CopySource: encodeURIComponent(`${BUCKET}/${key}`),
  }));
  copied++;
}
console.log(`  ${copied} object(s) copied`);

// ── 4. rewrite ──
console.log("rewriting embedded references…");
for (const p of plans) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: p.destKey,
    Body: JSON.stringify(p.value), ContentType: "application/json",
  }));
  console.log(`  ${p.file.padEnd(16)} ${p.changed} rewritten`);
}

// ── 5. THE ACCEPTANCE CHECK ──
// Read back what was actually written, and resolve every reference in it
// against the NEW prefix only. Checking the in-memory plan instead would prove
// only that the plan was consistent, not that S3 holds it.
console.log("verifying every reference resolves under the new prefix…");
const allRefs = [];
for (const p of plans) {
  const written = await getJson(p.destKey);
  allRefs.push(...collectOrgRefs(written, NEW));
  const stale = collectOrgRefs(written, OLD);
  if (stale.length) {
    console.error(`FAILED: ${p.file} still holds ${stale.length} reference(s) to the old prefix`);
    console.error(`The new prefix is populated but NOT sound. Do not delete ${srcPrefix}.`);
    process.exit(1);
  }
}
const { checked, missing } = await verifyRefsResolve(allRefs, exists);

if (missing.length) {
  console.error("");
  console.error(`FAILED: ${missing.length} of ${checked} referenced object(s) do not exist under the new prefix:`);
  for (const m of missing.slice(0, 10)) console.error(`  ${m}`);
  console.error("");
  console.error(`The copy reported success and the data is still broken — this is exactly the`);
  console.error(`case this check exists for. Do not delete ${srcPrefix}.`);
  process.exit(1);
}

console.log("");
console.log(`DONE.  ${copied} objects copied, ${totalRefs} references rewritten,`);
console.log(`       ${checked} referenced object(s) verified present under ${dstPrefix}.`);
console.log("");
console.log(`${srcPrefix} is UNTOUCHED and must stay that way until the org has been`);
console.log(`used against the new code for a while. Rollback is: point the org back at`);
console.log(`${OLD} and delete ${dstPrefix}. That stays cheap only while nothing has been`);
console.log(`written to the new prefix.`);
