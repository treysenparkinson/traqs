import { validateToken } from "./_utils/auth.js";
import { writeBinary, readBinaryWithMeta } from "./_utils/s3.js";
import { CORS, preflight, json, err } from "./_utils/cors.js";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getOrgCode(event) {
  const code = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  return /^[a-zA-Z0-9]{3,20}$/.test(code) ? code : null;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  // ── POST — upload a new attachment (auth required) ──────────────────────
  if (event.httpMethod === "POST") {
    try {
      await validateToken(event);
    } catch (e) {
      return err(401, e.message);
    }

    const orgCode = getOrgCode(event);
    if (!orgCode) return err(400, "Missing or invalid X-Org-Code header");

    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return err(400, "Invalid JSON body");
    }

    const { filename, mimeType, data } = body ?? {};
    if (!filename || !mimeType || !data) return err(400, "Missing required fields: filename, mimeType, data");
    if (!ALLOWED_TYPES.has(mimeType)) return err(400, "File type not allowed");

    let buffer;
    try {
      // data may be a full data URL ("data:image/png;base64,...") or raw base64
      const base64 = data.includes(",") ? data.split(",")[1] : data;
      buffer = Buffer.from(base64, "base64");
    } catch {
      return err(400, "Invalid base64 data");
    }

    if (buffer.length > MAX_BYTES) return err(400, "File too large (max 8 MB)");

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
    const key = `orgs/${orgCode}/attachments/${makeId()}-${safeName}`;

    try {
      await writeBinary(key, buffer, mimeType);
      return json(200, { key, filename: safeName, mimeType, size: buffer.length });
    } catch (e) {
      console.error("attachment POST error:", e);
      return err(500, "Failed to upload attachment");
    }
  }

  // ── GET — retrieve an attachment (no auth required; key contains random uid) ──
  if (event.httpMethod === "GET") {
    const key = event.queryStringParameters?.key || "";
    if (!key || !/^orgs\/[a-zA-Z0-9]{3,20}\/attachments\//.test(key)) {
      return err(400, "Missing or invalid key");
    }

    try {
      const { data, contentType } = await readBinaryWithMeta(key);
      const filename = key.split("/").pop();
      const isInline = contentType.startsWith("image/") || contentType === "application/pdf";
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          "Content-Type": contentType,
          "Content-Disposition": isInline ? "inline" : `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=86400",
        },
        body: data.toString("base64"),
        isBase64Encoded: true,
      };
    } catch (e) {
      if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) return err(404, "Attachment not found");
      console.error("attachment GET error:", e);
      return err(500, "Failed to retrieve attachment");
    }
  }

  return err(405, "Method not allowed");
}
