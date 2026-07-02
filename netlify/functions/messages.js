import { validateToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { sendWebPush } from "./_utils/webpush.js";
import { nowIso, softDelete } from "./_utils/timestamps.js";

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Cache /userinfo results by the JWT `sub` so warm function containers
// don't re-fetch on every request. Auth0 access tokens for custom APIs
// don't include the email claim by default — only `sub`, `iss`, `aud`,
// `exp`, `iat` — so we have to hit /userinfo (which is bound to the
// token itself, no spoofing risk) to get the user's email.
const userinfoCache = new Map();

async function emailForToken(event, payload) {
  if (payload?.email) return String(payload.email).toLowerCase().trim();
  const sub = payload?.sub;
  if (sub && userinfoCache.has(sub)) return userinfoCache.get(sub);

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) return null;

  try {
    const res = await fetch(`https://${domain}/userinfo`, {
      headers: { Authorization: authHeader },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const email = String(body?.email || "").toLowerCase().trim();
    if (sub && email) userinfoCache.set(sub, email);
    return email || null;
  } catch {
    return null;
  }
}

// Resolve the authenticated viewer to their personId. Returns
// `{ error, message }` for token/auth failures, `{ viewerId: null }`
// when the auth succeeded but the email isn't tied to any Person in
// this org (the response then filters to an empty list rather than
// 500ing, and avoids leaking org membership to outsiders).
async function resolveViewerId(event, people) {
  let payload;
  try {
    payload = await validateToken(event);
  } catch (e) {
    return { error: 401, message: e.message };
  }
  const email = await emailForToken(event, payload);
  if (!email) return { error: 401, message: "Could not resolve user email" };
  const me = (people || []).find(p => String(p.email || "").toLowerCase().trim() === email);
  if (!me?.id) return { viewerId: null };
  return { viewerId: String(me.id) };
}

// True if `viewerId` participates in the thread identified by `threadKey`.
// Rules:
//   dm:a_b        → viewer is one of the two ids
//   group:<name>  → viewer is in that group's memberIds
//   job:<id>      → viewer is assigned to the job at any level (job.team,
//                   any panel.team, or any operation.team within that job)
//   panel:<id>    → same rule as the parent job
//   op:<id>       → same rule as the parent job
// Anything else is rejected. Closed-by-default keeps mistakes safe.
// Exported so /sync can enforce the SAME per-viewer thread access control —
// otherwise sync would hand every member the whole org's conversations,
// reintroducing exactly the leak the GET handler below was written to close.
export function canViewThread(threadKey, viewerId, jobs, groups) {
  if (!viewerId || !threadKey) return false;
  if (threadKey.startsWith("dm:")) {
    return threadKey.slice(3).split("_").map(String).includes(viewerId);
  }
  if (threadKey.startsWith("group:")) {
    const ref = threadKey.slice(6);
    const g = (groups || []).find(g => String(g.name) === ref || String(g.id) === ref);
    return !!g && (g.memberIds || []).map(String).includes(viewerId);
  }
  if (threadKey.startsWith("job:")) {
    const j = (jobs || []).find(j => String(j.id) === threadKey.slice(4));
    return j ? userInJob(viewerId, j) : false;
  }
  if (threadKey.startsWith("panel:")) {
    const panelId = threadKey.slice(6);
    const j = (jobs || []).find(j => (j.subs || []).some(p => String(p.id) === panelId));
    return j ? userInJob(viewerId, j) : false;
  }
  if (threadKey.startsWith("op:")) {
    const opId = threadKey.slice(3);
    for (const j of (jobs || [])) {
      for (const p of (j.subs || [])) {
        if ((p.subs || []).some(o => String(o.id) === opId)) return userInJob(viewerId, j);
      }
    }
    return false;
  }
  return false;
}

export function userInJob(viewerId, j) {
  const has = arr => Array.isArray(arr) && arr.map(String).includes(viewerId);
  if (has(j.team)) return true;
  for (const p of (j.subs || [])) {
    if (has(p.team)) return true;
    for (const o of (p.subs || [])) if (has(o.team)) return true;
  }
  return false;
}

// Canonical set of person ids who should be notified for a message
// posted to `threadKey`. Computed from groups/tasks rather than trusting
// the body's participantIds — older iOS clients store only the sender
// there, so trusting it silently drops every other recipient's push.
function recipientsForThread(threadKey, jobs, groups) {
  if (!threadKey) return [];
  if (threadKey.startsWith("dm:")) {
    return threadKey.slice(3).split("_").map(String);
  }
  if (threadKey.startsWith("group:")) {
    const ref = threadKey.slice(6);
    const g = (groups || []).find(g => String(g.name) === ref || String(g.id) === ref);
    return g ? (g.memberIds || []).map(String) : [];
  }
  let job = null;
  if (threadKey.startsWith("job:")) {
    job = (jobs || []).find(j => String(j.id) === threadKey.slice(4));
  } else if (threadKey.startsWith("panel:")) {
    const panelId = threadKey.slice(6);
    job = (jobs || []).find(j => (j.subs || []).some(p => String(p.id) === panelId));
  } else if (threadKey.startsWith("op:")) {
    const opId = threadKey.slice(3);
    for (const j of (jobs || [])) {
      for (const p of (j.subs || [])) {
        if ((p.subs || []).some(o => String(o.id) === opId)) { job = j; break; }
      }
      if (job) break;
    }
  }
  if (!job) return [];
  const ids = new Set();
  for (const id of (job.team || [])) ids.add(String(id));
  for (const p of (job.subs || [])) {
    for (const id of (p.team || [])) ids.add(String(id));
    for (const o of (p.subs || [])) for (const id of (o.team || [])) ids.add(String(id));
  }
  return Array.from(ids);
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const messagesKey = orgKey(event, "messages.json");
  if (!messagesKey) return err(400, "Missing or invalid X-Org-Code header");

  // GET — return only the threads the authenticated viewer participates
  // in. Previously this returned the entire org's messages.json to
  // anyone with the org code, which exposed every conversation to
  // every teammate.
  if (event.httpMethod === "GET") {
    try {
      const [messages, people, jobs, groups] = await Promise.all([
        readJson(messagesKey).then(v => v ?? []),
        readJson(orgKey(event, "people.json")).then(v => v ?? []),
        readJson(orgKey(event, "tasks.json")).then(v => v ?? []),
        readJson(orgKey(event, "groups.json")).then(v => v ?? []),
      ]);
      const r = await resolveViewerId(event, people);
      if (r.error) return err(r.error, r.message);
      const viewerId = r.viewerId;
      if (!viewerId) return json(200, []);   // unknown viewer → nothing
      // Cache thread-level decisions so we don't re-evaluate per message.
      const decision = new Map();
      const filtered = messages.filter(m => {
        // Hide tombstoned messages. Thread deletes are now soft (see DELETE
        // below) so /sync can propagate them; this filter keeps the GET's
        // observable behavior identical — a deleted thread stays gone here.
        if (m.deletedAt) return false;
        if (!decision.has(m.threadKey)) {
          decision.set(m.threadKey, canViewThread(m.threadKey, viewerId, jobs, groups));
        }
        return decision.get(m.threadKey);
      });
      return json(200, filtered);
    } catch (e) {
      console.error("messages GET error:", e);
      return err(500, "Failed to read messages");
    }
  }

  if (event.httpMethod === "POST") {
    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON body"); }

    const { threadKey, scope, jobId, panelId, opId, text, authorId, authorName, authorColor, participantIds, attachments, type, finishRequestId } = body ?? {};
    if (!threadKey || (!text?.trim() && !attachments?.length) || !authorId) return err(400, "Missing required fields");
    // Bound user-supplied sizes so a member can't bloat the org's messages.json.
    if (typeof text === "string" && text.length > 10000) return err(400, "Message too long");
    if (Array.isArray(participantIds) && participantIds.length > 500) return err(400, "Too many participants");

    try {
      const [existing, people, jobs, groups] = await Promise.all([
        readJson(messagesKey).then(v => v ?? []),
        readJson(orgKey(event, "people.json")).then(v => v ?? []),
        readJson(orgKey(event, "tasks.json")).then(v => v ?? []),
        readJson(orgKey(event, "groups.json")).then(v => v ?? []),
      ]);
      const r = await resolveViewerId(event, people);
      if (r.error) return err(r.error, r.message);
      const viewerId = r.viewerId;
      // Sender must be a participant in the thread they're posting to,
      // AND the authorId on the body must match the authenticated user
      // (prevents impersonation by sending arbitrary authorIds).
      if (!viewerId || viewerId !== String(authorId)) return err(403, "Author does not match authenticated user");
      if (!canViewThread(threadKey, viewerId, jobs, groups)) return err(403, "Not a participant in this thread");

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
        // A brand-new message is modified "now" by definition — stamp it so it
        // shows up in the next /sync delta without diffing the whole log.
        lastModifiedAt: nowIso(),
        ...(type ? { type, finishRequestId: finishRequestId || null } : {}),
      };
      existing.push(newMsg);
      await writeJson(messagesKey, existing.slice(-2000));

      // Push notification to participants (excluding sender). Derived
      // from canonical group/task membership instead of body.participantIds
      // because older iOS clients only stored [authorId] there — trusting
      // it meant nobody but the sender ever got pushed for group/job
      // threads.
      const targetIds = recipientsForThread(threadKey, jobs, groups)
        .filter(id => id !== String(authorId));

      // Web push → desktop browsers (works whether or not a tab is open).
      // Awaited so it completes before the serverless function freezes on return.
      await sendWebPush(orgCodeFromHeader(event), targetIds, {
        title: authorName || "New message",
        body: text?.trim() || "Sent an attachment",
        data: { kind: "message", threadKey, scope },
      }).catch(() => {});

      // OneSignal → native iOS/Android.
      const appId  = process.env.ONESIGNAL_APP_ID;
      const apiKey = process.env.ONESIGNAL_API_KEY;
      if (appId && apiKey) {
        const registered = people
          .filter(p => p.pushToken && targetIds.includes(String(p.id)))
          .map(p => String(p.id));
        if (registered.length > 0) {
          await fetch("https://onesignal.com/api/v1/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Basic ${apiKey}` },
            body: JSON.stringify({
              app_id: appId,
              include_external_user_ids: registered,
              channel_for_external_user_ids: "push",
              headings: { en: `${authorName}` },
              contents: { en: text?.trim() || "Sent an attachment" },
              data: { threadKey, scope },
            }),
          }).catch(() => {});
        }
      }

      return json(200, newMsg);
    } catch (e) {
      console.error("messages POST error:", e);
      return err(500, "Failed to save message");
    }
  }

  if (event.httpMethod === "DELETE") {
    const threadKey = event.queryStringParameters?.threadKey;
    if (!threadKey) return err(400, "threadKey query param required");
    try {
      const [existing, people, jobs, groups] = await Promise.all([
        readJson(messagesKey).then(v => v ?? []),
        readJson(orgKey(event, "people.json")).then(v => v ?? []),
        readJson(orgKey(event, "tasks.json")).then(v => v ?? []),
        readJson(orgKey(event, "groups.json")).then(v => v ?? []),
      ]);
      const r = await resolveViewerId(event, people);
      if (r.error) return err(r.error, r.message);
      // Only participants can delete a thread. Without this, any
      // authenticated user with the org code could erase any
      // conversation in the org.
      if (!r.viewerId || !canViewThread(threadKey, r.viewerId, jobs, groups)) {
        return err(403, "Not a participant in this thread");
      }
      // Soft-delete: tombstone the thread's messages (deletedAt + lastModifiedAt)
      // but keep them in the array so /sync can tell clients to drop them from
      // their local cache. A hard filter would make the deletion invisible to
      // delta-sync. The GET handler filters out `deletedAt` so existing clients
      // see the thread vanish exactly as before.
      let deleted = 0;
      const next = existing.map(m => {
        if (m.threadKey !== threadKey || m.deletedAt) return m;
        deleted++;
        return softDelete(m);
      });
      await writeJson(messagesKey, next);
      return json(200, { ok: true, deleted });
    } catch (e) {
      console.error("messages DELETE error:", e);
      return err(500, "Failed to delete messages");
    }
  }

  return err(405, "Method not allowed");
}
