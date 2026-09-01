import { validateToken, emailForToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { sendWebPush } from "./_utils/webpush.js";
import { nowIso, softDelete } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendVisiblePush, sendSilentPush } from "./_utils/push.js";

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Resolve the authenticated viewer to their personId. Returns
// `{ error, message }` for token/auth failures, `{ viewerId: null }`
// when the auth succeeded but the email isn't tied to any Person in
// this org (the response then filters to an empty list rather than
// 500ing, and avoids leaking org membership to outsiders).
//
// Email resolution uses the shared `emailForToken` from _utils/auth.js. This
// file used to carry its own copy with an unbounded, never-expiring cache and
// no rate-limit handling — so message reads/writes kept hitting Auth0
// /userinfo and 401ing even after the shared path was hardened. One
// implementation, one place to fix.
async function resolveViewerId(event, people) {
  let payload;
  try {
    payload = await validateToken(event);
  } catch (e) {
    return { error: 401, message: e.message };
  }
  const { email, transient } = await emailForToken(event, payload);
  if (!email) {
    // Auth0 rate-limited or down — retryable, not an auth failure.
    if (transient) return { error: 503, message: "Identity provider temporarily unavailable — please retry" };
    return { error: 401, message: "Could not resolve user email" };
  }
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

// Human name for a thread, used as the push HEADING on everything that is not
// a DM.
//
// Every thread type used to push with `heading: authorName`, so a group
// message was indistinguishable from a direct message on the lock screen —
// "Trey" with no hint of which conversation it belonged to. Groups, job,
// panel and op threads now lead with the CONVERSATION and put the author in
// front of the text ("Shop Floor" / "Trey: heading out"), which is the
// convention every other group messenger uses. DMs are left alone: there the
// author IS the thread.
//
// Returns null when the thread has no name worth showing (an unknown id, a
// deleted group) — the caller then falls back to the old author heading rather
// than pushing something like "group:".
function threadDisplayName(threadKey, jobs, groups) {
  if (!threadKey) return null;

  const clean = v => {
    const s = (v == null ? "" : String(v)).trim();
    return s || null;
  };

  if (threadKey.startsWith("group:")) {
    const ref = threadKey.slice(6);
    const g = (groups || []).find(g => String(g.name) === ref || String(g.id) === ref);
    // The key often IS the group name, so fall back to the ref itself when the
    // group record has been renamed or removed.
    return clean(g?.name) || clean(ref);
  }

  // job / panel / op all resolve through the owning job, so the heading always
  // carries enough to locate the conversation: "#1042 · Wire" beats "Wire".
  const jobLabel = j => {
    const num = clean(j?.jobNumber);
    const title = clean(j?.title);
    if (num && title) return `#${num} ${title}`;
    return num ? `#${num}` : title;
  };

  if (threadKey.startsWith("job:")) {
    const j = (jobs || []).find(j => String(j.id) === threadKey.slice(4));
    return j ? jobLabel(j) : null;
  }

  if (threadKey.startsWith("panel:")) {
    const panelId = threadKey.slice(6);
    for (const j of (jobs || [])) {
      const p = (j.subs || []).find(p => String(p.id) === panelId);
      if (p) {
        const parts = [jobLabel(j), clean(p.title)].filter(Boolean);
        return parts.length ? parts.join(" · ") : null;
      }
    }
    return null;
  }

  if (threadKey.startsWith("op:")) {
    const opId = threadKey.slice(3);
    for (const j of (jobs || [])) {
      for (const p of (j.subs || [])) {
        const o = (p.subs || []).find(o => String(o.id) === opId);
        if (o) {
          const parts = [jobLabel(j), clean(o.title) || clean(p.title)].filter(Boolean);
          return parts.length ? parts.join(" · ") : null;
        }
      }
    }
    return null;
  }

  return null;   // dm: — the author is the thread
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
        readJson(orgKey(event, "people.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "tasks.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "groups.json")).then(v => filterLive(v ?? [])),
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
        readJson(orgKey(event, "people.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "tasks.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "groups.json")).then(v => filterLive(v ?? [])),
      ]);
      const r = await resolveViewerId(event, people);
      if (r.error) return err(r.error, r.message);
      const viewerId = r.viewerId;
      // Sender must be a participant in the thread they're posting to,
      // AND the authorId on the body must match the authenticated user
      // (prevents impersonation by sending arbitrary authorIds).
      if (!viewerId || viewerId !== String(authorId)) return err(403, "Author does not match authenticated user");
      if (!canViewThread(threadKey, viewerId, jobs, groups)) return err(403, "Not a participant in this thread");

      // Client-supplied id. The web client mints the id before it posts so its
      // optimistic bubble and this server copy share one identity — the bubble
      // then stays mounted and only its delivery status flips Sending→Sent,
      // instead of being torn down and re-added (which rendered as a momentary
      // duplicate). Honoured only when it's a sane token that isn't already
      // taken; anything else (older clients, collisions) gets a server id.
      const wantId = typeof body?.id === "string" ? body.id.trim() : "";
      const idOk = /^[A-Za-z0-9_-]{1,64}$/.test(wantId) && !existing.some(m => String(m.id) === wantId);

      const newMsg = {
        id: idOk ? wantId : makeId(),
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
      await publishChange(orgCodeFromHeader(event), "messages", { ids: [String(newMsg.id)] });

      // Push notification to participants (excluding sender). Derived
      // from canonical group/task membership instead of body.participantIds
      // because older iOS clients only stored [authorId] there — trusting
      // it meant nobody but the sender ever got pushed for group/job
      // threads.
      const targetIds = recipientsForThread(threadKey, jobs, groups)
        .filter(id => id !== String(authorId));

      // Notification wording. On a group / job / panel / op thread the heading
      // is the CONVERSATION and the author is prefixed to the body, so the
      // lock screen answers "who texted, and where" — the two of them used to
      // be indistinguishable from a DM. On a DM the author IS the thread, so
      // nothing changes there.
      const who = authorName || "New message";
      const said = text?.trim() || "Sent an attachment";
      const threadName = threadDisplayName(threadKey, jobs, groups);
      const pushHeading = threadName || who;
      const pushBody = threadName ? `${authorName || "Someone"}: ${said}` : said;

      // Web push → desktop browsers (works whether or not a tab is open).
      // Awaited so it completes before the serverless function freezes on return.
      await sendWebPush(orgCodeFromHeader(event), targetIds, {
        title: pushHeading,
        body: pushBody,
        data: { kind: "message", threadKey, scope },
      }).catch(() => {});

      // OneSignal → native. VISIBLE push to the thread's recipients (sender
      // already excluded above), plus a SILENT background-sync push to every
      // OTHER org member so their cached thread list refreshes even though
      // they're not a participant here. The silent push only triggers a
      // deltaSync — it carries no message text, and /sync still enforces
      // per-viewer thread ACLs, so a non-participant never sees the content.
      const orgCode = orgCodeFromHeader(event);
      const senderId = String(authorId);
      await sendVisiblePush(orgCode, people, targetIds, {
        heading: pushHeading,
        content: pushBody,
        data: { threadKey, scope },
        label: "message",
      });
      const recipientSet = new Set(targetIds.map(String));
      const silentTargets = people
        .map(p => p && p.id).filter(v => v != null).map(String)
        .filter(id => id !== senderId && !recipientSet.has(id));
      await sendSilentPush(orgCode, { entity: "messages", people, personIds: silentTargets });

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
        readJson(orgKey(event, "people.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "tasks.json")).then(v => filterLive(v ?? [])),
        readJson(orgKey(event, "groups.json")).then(v => filterLive(v ?? [])),
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
      const deletedIds = [];
      const next = existing.map(m => {
        if (m.threadKey !== threadKey || m.deletedAt) return m;
        deleted++;
        deletedIds.push(String(m.id));
        return softDelete(m);
      });
      await writeJson(messagesKey, next);
      await publishChange(orgCodeFromHeader(event), "messages", { ids: deletedIds });
      return json(200, { ok: true, deleted });
    } catch (e) {
      console.error("messages DELETE error:", e);
      return err(500, "Failed to delete messages");
    }
  }

  return err(405, "Method not allowed");
}
