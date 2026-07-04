import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { sendWebPush } from "./_utils/webpush.js";
import { filterLive } from "./_utils/entities.js";
import { sendSilentPush } from "./_utils/push.js";
import { publishChange } from "./_utils/ably-publish.js";

// ─── Time Off Requests ────────────────────────────────────────────────────────
//
// A lightweight approval workflow that sits ON TOP of the existing
// `person.timeOff` system the desktop already uses for the schedule + the
// accountant hours export. Requests live in their own dataset so a *pending*
// request never touches the schedule/export. Only on APPROVAL does the backend
// write a normal entry into `person.timeOff` (people.json), which the desktop
// already renders (PTO/UTO bars) and auto-highlights on the export — so the
// display side needs zero changes.
//
//   timeoff.json  →  [{ id, personId, personName, type, start, end, note,
//                       status, createdAt, decidedBy, decidedByName,
//                       decidedAt, denialReason }]
//
//   status:  "pending" → "approved" | "denied" | "cancelled"
//   type:    "PTO" (paid → yellow on export) | "UTO" (unpaid → blank)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(["PTO", "UTO"]);

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowIso() {
  return new Date().toISOString();
}

// Web push (desktop) + OneSignal (iOS/Android) to a set of personIds.
// Mirrors notify.js so time-off events ping the same way job events do.
async function pushTo(orgCode, people, targetIds, heading, content, data) {
  const ids = [...new Set(targetIds.map((id) => String(id)).filter(Boolean))];
  if (ids.length === 0) return;

  await sendWebPush(orgCode, ids, {
    title: heading,
    body: content,
    data: { kind: "timeoff", ...data },
  }).catch(() => {});

  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!appId || !apiKey) return;

  const registeredIds = people
    .filter((p) => p.pushToken && ids.includes(String(p.id)))
    .map((p) => String(p.id));
  if (registeredIds.length === 0) return;

  try {
    const osRes = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${apiKey}` },
      body: JSON.stringify({
        app_id: appId,
        // v5 user model: target by the external_id alias (set on iOS via
        // OneSignal.login(personId)). The legacy include_external_user_ids
        // field is deprecated and silently resolves 0 recipients on new apps.
        include_aliases: { external_id: registeredIds },
        target_channel: "push",
        headings: { en: heading },
        contents: { en: content },
        data: { type: "timeoff", ...data },
      }),
    });
    const osBody = await osRes.json().catch(() => ({}));
    if (!osRes.ok) {
      console.error("OneSignal error (timeoff):", osRes.status, osBody);
    }
  } catch (e) {
    console.error("OneSignal timeoff push error:", e);
  }
}

// filterLive: notifications must target only LIVE admins — a removed admin's
// tombstone (userRole still "admin") must not keep receiving time-off pushes/DMs.
const adminIdsOf = (people) =>
  filterLive(people).filter((p) => p.userRole === "admin").map((p) => String(p.id));

const fmtRange = (start, end) => (start === end ? start : `${start} – ${end}`);

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  let member;
  try {
    member = await requireOrgMember(event);
  } catch (e) {
    return err(e.statusCode || 401, e.message);
  }

  const { orgCode, personId: meId, isAdmin } = member;
  const reqKey = `orgs/${orgCode}/timeoff.json`;
  const peopleKey = `orgs/${orgCode}/people.json`;

  // ── GET: list requests (admins see all; members see only their own) ──────────
  if (event.httpMethod === "GET") {
    let requests;
    try {
      requests = (await readJson(reqKey)) ?? [];
    } catch {
      return err(500, "Failed to read time-off requests");
    }
    const visible = isAdmin ? requests : requests.filter((r) => String(r.personId) === String(meId));
    return json(200, { requests: visible });
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return err(400, "Invalid JSON");
    }

    const type = String(body.type || "").toUpperCase();
    const start = String(body.start || "");
    const end = String(body.end || "");
    const note = String(body.note || "").trim();

    if (!TYPES.has(type)) return err(400, "type must be PTO or UTO");
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return err(400, "start/end must be YYYY-MM-DD");
    if (end < start) return err(400, "end must be on or after start");
    if (note.length > 500) return err(400, "note too long");
    if (!meId) return err(403, "Could not resolve your person record");

    let people = [];
    try {
      people = (await readJson(peopleKey)) ?? [];
    } catch {
      people = [];
    }
    const me = people.find((p) => String(p.id) === String(meId));
    const personName = me?.name || member.email || "Someone";

    let requests;
    try {
      requests = (await readJson(reqKey)) ?? [];
    } catch {
      return err(500, "Failed to read time-off requests");
    }

    const record = {
      id: makeId(),
      personId: String(meId),
      personName,
      type,
      start,
      end,
      note,
      status: "pending",
      createdAt: nowIso(),
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
      denialReason: null,
    };
    requests.push(record);

    try {
      await writeJson(reqKey, requests);
    } catch {
      return err(500, "Failed to save request");
    }

    // Surface the request in chat (Messages): a DM from the requester to each
    // admin carrying the request, so admins approve/deny right in the bubble.
    // Written straight to messages.json server-side (bypasses the member auth
    // gate on /messages, which requires authorId === caller). Both DM
    // participants can read it; approval still flows through the PATCH handler
    // → person.timeOff, so the schedule/export are unaffected.
    try {
      const admins = filterLive(people).filter((p) => p.userRole === "admin" && String(p.id) !== String(meId));
      if (admins.length > 0) {
        const messagesKey = `orgs/${orgCode}/messages.json`;
        let messages = (await readJson(messagesKey)) ?? [];
        if (!Array.isArray(messages)) messages = [];
        const summary = `${personName} requested ${type} · ${fmtRange(start, end)}${note ? ` — "${note}"` : ""}`;
        const authorColor = me?.color || "#4169e1";
        for (const a of admins) {
          const threadKey = `dm:${[String(meId), String(a.id)].sort().join("_")}`;
          messages.push({
            id: makeId(),
            threadKey,
            scope: "dm",
            jobId: null, panelId: null, opId: null,
            text: summary,
            authorId: String(meId),
            authorName: personName,
            authorColor,
            participantIds: [String(meId), String(a.id)],
            attachments: [],
            timestamp: nowIso(),
            type: "timeoff_request",
            timeOffRequestId: record.id,
            toType: type, toStart: start, toEnd: end, toNote: note, toPersonName: personName,
          });
        }
        await writeJson(messagesKey, messages.slice(-2000));
      }
    } catch (e) {
      console.error("timeoff → chat post failed:", e);
    }

    await pushTo(
      orgCode,
      people,
      adminIdsOf(people),
      "Time Off Request",
      `${personName} requested ${type} for ${fmtRange(start, end)}. Tap to approve or deny.`,
      { event: "request", requestId: record.id }
    );

    // Real-time (Phase 2 followup): broadcast so other sessions update live,
    // matching the other write endpoints. Clients don't subscribe to a
    // "timeoff" channel yet (so the request LIST refresh is latent/future), but
    // "messages" IS subscribed — the admins' DM bubble appears live.
    await publishChange(orgCode, "timeoff", { ids: [record.id] });
    await publishChange(orgCode, "messages", { ids: [] });
    // Silent background-sync to everyone else. timeoff.json isn't a delta-sync
    // entity, so this mainly matters for the actions that also mutate
    // people.json (approve/cancel) — but firing it uniformly is cheap and the
    // client coalesces. Actor excluded: their device already has the change.
    await sendSilentPush(orgCode, { entity: "people", people, excludePersonId: meId });
    return json(200, { request: record });
  }

  // ── PATCH: approve / deny / cancel a request ─────────────────────────────────
  if (event.httpMethod === "PATCH") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return err(400, "Invalid JSON");
    }

    const id = String(body.id || "");
    const action = String(body.action || "").toLowerCase();
    const reason = String(body.reason || "").trim();
    if (!id) return err(400, "Missing request id");
    if (!["approve", "deny", "cancel"].includes(action)) return err(400, "Unknown action");
    if (reason.length > 500) return err(400, "reason too long");

    let requests;
    try {
      requests = (await readJson(reqKey)) ?? [];
    } catch {
      return err(500, "Failed to read time-off requests");
    }
    const idx = requests.findIndex((r) => String(r.id) === id);
    if (idx === -1) return err(404, "Request not found");
    const reqRec = requests[idx];

    let people = [];
    try {
      people = (await readJson(peopleKey)) ?? [];
    } catch {
      people = [];
    }

    // Authorization: approve/deny are admin-only; cancel is the owner or an admin.
    if (action === "approve" || action === "deny") {
      if (!isAdmin) return err(403, "Admin only");
    } else if (action === "cancel") {
      if (!isAdmin && String(reqRec.personId) !== String(meId)) return err(403, "Not your request");
    }

    const meRec = people.find((p) => String(p.id) === String(meId));
    const meName = meRec?.name || member.email || "An admin";

    if (action === "approve") {
      requests[idx] = {
        ...reqRec,
        status: "approved",
        decidedBy: String(meId),
        decidedByName: meName,
        decidedAt: nowIso(),
        denialReason: null,
      };

      // Write the approved entry into person.timeOff so the existing schedule
      // + accountant export pick it up automatically. `reqId` links it back so
      // a later cancel can remove exactly this entry.
      const pIdx = people.findIndex((p) => String(p.id) === String(reqRec.personId));
      if (pIdx !== -1) {
        const existing = Array.isArray(people[pIdx].timeOff) ? people[pIdx].timeOff : [];
        if (!existing.some((t) => t.reqId === reqRec.id)) {
          existing.push({
            start: reqRec.start,
            end: reqRec.end,
            reason: reqRec.note || "",
            type: reqRec.type,
            reqId: reqRec.id,
          });
        }
        people[pIdx] = { ...people[pIdx], timeOff: existing };
      }

      try {
        await writeJson(reqKey, requests);
        await writeJson(peopleKey, people);
      } catch {
        return err(500, "Failed to save approval");
      }

      await pushTo(
        orgCode,
        people,
        [reqRec.personId],
        "Time Off Approved",
        `Your ${reqRec.type} for ${fmtRange(reqRec.start, reqRec.end)} was approved.`,
        { event: "approved", requestId: reqRec.id }
      );
      // Approval wrote person.timeOff into people.json → broadcast "people" so
      // the schedule (PTO/UTO bars) updates live on other sessions.
      await publishChange(orgCode, "timeoff", { ids: [reqRec.id] });
      await publishChange(orgCode, "people", { ids: [String(reqRec.personId)] });
      await sendSilentPush(orgCode, { entity: "people", people, excludePersonId: meId });
      return json(200, { request: requests[idx] });
    }

    if (action === "deny") {
      requests[idx] = {
        ...reqRec,
        status: "denied",
        decidedBy: String(meId),
        decidedByName: meName,
        decidedAt: nowIso(),
        denialReason: reason || null,
      };
      try {
        await writeJson(reqKey, requests);
      } catch {
        return err(500, "Failed to save denial");
      }
      await pushTo(
        orgCode,
        people,
        [reqRec.personId],
        "Time Off Denied",
        `Your ${reqRec.type} for ${fmtRange(reqRec.start, reqRec.end)} was denied${reason ? `: ${reason}` : "."}`,
        { event: "denied", requestId: reqRec.id }
      );
      await publishChange(orgCode, "timeoff", { ids: [reqRec.id] });
      await sendSilentPush(orgCode, { entity: "people", people, excludePersonId: meId });
      return json(200, { request: requests[idx] });
    }

    // action === "cancel"
    const wasApproved = reqRec.status === "approved";
    requests[idx] = {
      ...reqRec,
      status: "cancelled",
      decidedBy: String(meId),
      decidedByName: meName,
      decidedAt: nowIso(),
    };

    // If it had already been approved, pull the matching entry back out of
    // person.timeOff so it disappears from the schedule + export.
    if (wasApproved) {
      const pIdx = people.findIndex((p) => String(p.id) === String(reqRec.personId));
      if (pIdx !== -1 && Array.isArray(people[pIdx].timeOff)) {
        people[pIdx] = {
          ...people[pIdx],
          timeOff: people[pIdx].timeOff.filter((t) => t.reqId !== reqRec.id),
        };
      }
    }

    try {
      await writeJson(reqKey, requests);
      if (wasApproved) await writeJson(peopleKey, people);
    } catch {
      return err(500, "Failed to cancel request");
    }

    // Let admins know a (possibly already-approved) request was withdrawn.
    await pushTo(
      orgCode,
      people,
      adminIdsOf(people),
      "Time Off Cancelled",
      `${reqRec.personName} cancelled their ${reqRec.type} for ${fmtRange(reqRec.start, reqRec.end)}.`,
      { event: "cancelled", requestId: reqRec.id }
    );
    // Cancelling an approved request pulled the entry back out of people.json.
    await publishChange(orgCode, "timeoff", { ids: [reqRec.id] });
    if (wasApproved) await publishChange(orgCode, "people", { ids: [String(reqRec.personId)] });
    await sendSilentPush(orgCode, { entity: "people", people, excludePersonId: meId });
    return json(200, { request: requests[idx] });
  }

  return err(405, "Method not allowed");
}
