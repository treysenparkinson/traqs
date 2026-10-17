import { S3Client, GetObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { refuseWriteInLocalDev } from "./dev-guard.js";
// STORAGE_BACKEND=postgres routes every function below to the Postgres store, same contract
// (docs/plans/2026-10-16-postgres-migration.md). Unset, nothing here changes.
import { usePostgres, binariesOnPostgres, pgStore } from "./store/select.js";

const client = new S3Client({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET;

/**
 * Read a JSON file from S3.
 * Returns the parsed value, or null if the key does not exist.
 */
export async function readJson(key) {
  if (usePostgres()) return pgStore().readJson(key);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await streamToString(res.Body);
    return JSON.parse(body);
  } catch (e) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw e;
  }
}

/**
 * Write a value as JSON to S3.
 */
export async function writeJson(key, value) {
  if (usePostgres()) return pgStore().writeJson(key, value);
  refuseWriteInLocalDev(`writeJson ${key}`);   // #454
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    })
  );
}

/**
 * Read a JSON file with its ETag, for a conditional write back.
 * Returns { data, etag }; both null when the key does not exist.
 */
export async function readJsonVersioned(key) {
  if (usePostgres()) return pgStore().readJsonVersioned(key);
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await streamToString(res.Body);
    return { data: JSON.parse(body), etag: res.ETag ?? null };
  } catch (e) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      return { data: null, etag: null };
    }
    throw e;
  }
}

/** Thrown by writeJsonIfMatch when the object changed since it was read. */
export class PreconditionFailed extends Error {
  constructor(key) {
    super(`Precondition failed: ${key}`);
    this.name = "PreconditionFailed";
    this.preconditionFailed = true;
  }
}

/**
 * Write JSON only if the object is still the version that was read: If-Match on
 * `etag`, or If-None-Match: * when it did not exist (etag null). S3 answers 412
 * when someone wrote in between, and 409 when a conflicting conditional write is
 * in flight; both become PreconditionFailed so the caller re-reads and retries.
 */
export async function writeJsonIfMatch(key, value, etag) {
  if (usePostgres()) {
    // The Postgres store throws its own PreconditionFailed; callers check `.preconditionFailed`
    // (update-json.js), and this keeps `instanceof` true for this module's class as well.
    try { return await pgStore().writeJsonIfMatch(key, value, etag); }
    catch (e) { if (e?.preconditionFailed) throw new PreconditionFailed(key); throw e; }
  }
  refuseWriteInLocalDev(`writeJsonIfMatch ${key}`);   // #454
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      })
    );
  } catch (e) {
    const status = e.$metadata?.httpStatusCode;
    if (e.name === "PreconditionFailed" || e.name === "ConditionalRequestConflict" || status === 412 || status === 409) {
      throw new PreconditionFailed(key);
    }
    throw e;
  }
}

// List all org codes by scanning orgs/{code}/config.json keys in S3.
export async function listOrgCodes() {
  if (usePostgres()) return pgStore().listOrgCodes();
  const codes = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: "orgs/",
      Delimiter: "/",
      ContinuationToken: token,
    }));
    for (const p of res.CommonPrefixes ?? []) {
      // p.Prefix looks like "orgs/MATRIX/"
      const code = p.Prefix.split("/")[1];
      if (code) codes.push(code);
    }
    token = res.NextContinuationToken;
  } while (token);
  return codes;
}

/**
 * Upload raw binary data to S3.
 */
export async function writeBinary(key, buffer, contentType) {
  if (binariesOnPostgres()) return pgStore().writeBinary(key, buffer, contentType);
  refuseWriteInLocalDev(`writeBinary ${key}`);   // #454
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

/**
 * Read a binary file from S3, returning the raw Buffer and ContentType.
 * Throws if the key does not exist.
 */
export async function readBinaryWithMeta(key) {
  if (binariesOnPostgres()) {
    try { return await pgStore().readBinaryWithMeta(key); }
    catch (e) {
      // Local dev on Postgres starts from a JSON-only snapshot, so files uploaded before it
      // live in S3: read them from there (reads are allowed under the dev guard, writes aren't).
      if (!(process.env.NETLIFY_DEV === "true" && e?.name === "NoSuchKey")) throw e;
    }
  }
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const data = await streamToBuffer(res.Body);
  return { data, contentType: res.ContentType || "application/octet-stream" };
}

/**
 * Copy all objects under sourcePrefix to destPrefix, then delete the originals.
 * Used for renaming an org code.
 */
export async function copyPrefix(sourcePrefix, destPrefix) {
  if (usePostgres()) return pgStore().copyPrefix(sourcePrefix, destPrefix);
  refuseWriteInLocalDev(`copyPrefix ${sourcePrefix}`);   // #454
  const keys = [];
  let token;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: sourcePrefix,
      ContinuationToken: token,
    }));
    for (const obj of res.Contents ?? []) keys.push(obj.Key);
    token = res.NextContinuationToken;
  } while (token);

  for (const key of keys) {
    const destKey = destPrefix + key.slice(sourcePrefix.length);
    await client.send(new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: encodeURIComponent(`${BUCKET}/${key}`),
      Key: destKey,
    }));
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }
}

/**
 * Copy a single S3 object from srcKey to destKey (server-side copy).
 */
export async function copyObject(srcKey, destKey) {
  if (usePostgres()) return pgStore().copyObject(srcKey, destKey);
  refuseWriteInLocalDev(`copyObject ${srcKey}`);   // #454
  await client.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: encodeURIComponent(`${BUCKET}/${srcKey}`),
    Key: destKey,
  }));
}

/**
 * Delete a single S3 object. No-op semantics on a missing key (S3 delete is
 * idempotent and does not error on absent keys).
 */
export async function deleteObject(key) {
  if (usePostgres()) return pgStore().deleteObject(key);
  refuseWriteInLocalDev(`deleteObject ${key}`);   // #454
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
