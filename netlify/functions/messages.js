import { validateToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

function getOrgKey(event) {
  const orgCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!orgCode || !/^[a-zA-Z0-9]{3,20}$/.test(orgCode)) return null;
  return `orgs/${orgCode}/messages.json`;
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = getOrgKey(event);
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — read all messages (no auth required)
  if (event.httpMethod === "GET") {
    try {
      const data = await readJson(s3Key);
      return json(200, data ?? []);
    } catch (e) {
      console.error("messages GET error:", e);
      return err(500, "Failed to read messages");
    }
  }

  // POST — append a new message (requires auth)
  if (event.httpMethod === "POST") {
    try {
      await validateToken(event);
    } catch (e) {
      return err(401, e.message);
    }
    let body;
    try {
      body = JSON.parse(event.body);
    } catch {
      return err(400, "Invalid JSON body");
    }

    const { threadKey, scope, jobId, panelId, opId, text, authorId, authorName, authorColor, participantIds, attachments } = body ?? {};
    if (!threadKey || (!text?.trim() && !attachments?.length) || !authorId) return err(400, "Missing required fields");

    try {
      const messages = await readJson(s3Key) ?? [];
      const newMsg = {
        id: makeId(),
        threadKey,
        scope: scope || "job",
        jobId: jobId || null,
        panelId: panelId || null,
        opId: opId || null,
        text: text?.trim() || "",
        authorId,
        authorName,
        authorColor: authorColor || "#4169e1",
        participantIds: participantIds || [],
        attachments: Array.isArray(attachments) ? attachments.slice(0, 10) : [],
        timestamp: new Date().toISOString(),
      };
      messages.push(newMsg);
      // Keep last 2000 messages to prevent unbounded growth
      await writeJson(s3Key, messages.slice(-2000));
      return json(200, newMsg);
    } catch (e) {
      console.error("messages POST error:", e);
      return err(500, "Failed to save message");
    }
  }

  // DELETE — remove all messages for a threadKey (auth required)
  if (event.httpMethod === "DELETE") {
    try {
      await validateToken(event);
    } catch (e) {
      return err(401, e.message);
    }
    const threadKey = event.queryStringParameters?.threadKey;
    if (!threadKey) return err(400, "threadKey query param required");
    try {
      const messages = await readJson(s3Key) ?? [];
      const filtered = messages.filter(m => m.threadKey !== threadKey);
      await writeJson(s3Key, filtered);
      return json(200, { ok: true, deleted: messages.length - filtered.length });
    } catch (e) {
      console.error("messages DELETE error:", e);
      return err(500, "Failed to delete messages");
    }
  }

  return err(405, "Method not allowed");
}
