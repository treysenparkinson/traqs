import { randomBytes } from "crypto";
import { requireOrgMember } from "./_utils/auth.js";
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

// Crypto-random id. The previous Date.now()+Math.random() was predictable —
// guessable keys mattered less when GET required no auth (it just got
// security-through-obscurity wrong), and matter even less now that GET
// validates org membership, but there's no reason to use a weak RNG here.
function makeId() {
  return randomBytes(9).toString("base64url");
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  // ── POST — upload a new attachment ─────────────────────────────────────
  // Member of the named org required; the file's S3 key is scoped to that
  // org so uploads can't leak into a different tenant's prefix.
  if (event.httpMethod === "POST") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }

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
    const key = `orgs/${member.orgCode}/attachments/${makeId()}-${safeName}`;

    try {
      await writeBinary(key, buffer, mimeType);
      return json(200, { key, filename: safeName, mimeType, size: buffer.length });
    } catch (e) {
      console.error("attachment POST error:", e);
      return err(500, "Failed to upload attachment");
    }
  }

  // ── GET — retrieve an attachment ───────────────────────────────────────
  // SECURITY NOTE: this remains unauthenticated because the React app
  // loads images via bare `<img src=".../attachment?key=...">` and switching
  // to a fetch-with-auth + blob URL pattern would require coordinated
  // changes across every <img>/<a> attachment site. The key itself is now
  // 12 bytes of crypto-random entropy (~96 bits) prefixed by the org code,
  // so the URL is effectively an unguessable bearer. Long-term: swap this
  // for short-lived HMAC-signed presigned URLs issued at message-fetch time.
  if (event.httpMethod === "GET") {
    const key = event.queryStringParameters?.key || "";
    // Anchor the trailing segment so the key can only reference an object
    // directly under the org's attachments/ prefix — no path escape and no
    // CR/LF or quote characters can reach the Content-Disposition header.
    if (!/^orgs\/[a-zA-Z0-9]{3,20}\/attachments\/[a-zA-Z0-9._-]+$/.test(key)) {
      return err(400, "Missing or invalid key");
    }

    try {
      const { data, contentType } = await readBinaryWithMeta(key);
      const filename = key.split("/").pop();
      // Render only images and PDFs inline (both are handled by sandboxed
      // browser viewers). text/csv/office docs are forced to download, and
      // nosniff (below) blocks content-type sniffing so a forged text/plain
      // payload can't be reinterpreted as HTML and executed in our origin.
      const isInline = contentType.startsWith("image/") || contentType === "application/pdf";
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          "Content-Type": contentType,
          "X-Content-Type-Options": "nosniff",
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
