import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

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
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    })
  );
}

// List all org codes by scanning orgs/{code}/config.json keys in S3.
export async function listOrgCodes() {
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
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const data = await streamToBuffer(res.Body);
  return { data, contentType: res.ContentType || "application/octet-stream" };
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
