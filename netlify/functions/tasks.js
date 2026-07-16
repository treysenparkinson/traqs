import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { stampArray, reconcileDeletions, changedIds } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { diffTaskEvents } from "./_utils/task-events.js";
import { sendVisiblePush, sendSilentPush } from "./_utils/push.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "tasks.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — read tasks from S3. Requires the caller to be a member of the
  // org named in X-Org-Code; otherwise tasks (job titles, client refs,
  // notes) would be readable by anyone who guessed the org code.
  if (event.httpMethod === "GET") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = await readJson(s3Key);
      // Hide soft-deleted (tombstoned) records from normal readers so existing
      // clients see the array as if the record was hard-deleted. /sync does NOT
      // filter these — delta-sync clients need the tombstone to evict the row.
      return json(200, filterLive(data ?? []));
    } catch (e) {
      console.error("tasks GET error:", e);
      return err(500, "Failed to read tasks");
    }
  }

  // POST — write tasks to S3. Requires org membership: without this, an
  // authenticated user from org A could overwrite org B's tasks.json by
  // sending X-Org-Code: ORGB along with their valid (but unrelated) JWT.
  if (event.httpMethod === "POST") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const tasks = JSON.parse(event.body);
      if (!Array.isArray(tasks)) return err(400, "Invalid tasks data");

      // Read the current version once. It serves double duty: the empty-overwrite
      // guard's reference below, AND the `previous` that stampArray diffs against
      // so unchanged jobs keep their existing lastModifiedAt (only genuinely
      // changed jobs get a fresh timestamp, which is what delta-sync relies on).
      const existing = await readJson(s3Key);

      // Refuse to overwrite a non-empty tasks.json with an empty array.
      // Why: a client bug (failed initial fetch → React resets state → autosave fires)
      // wiped MTX2026TRAQS/tasks.json on 2026-06-03. This guard makes that race fatal
      // on the server instead of silently destroying data. To intentionally clear all
      // tasks, delete the S3 object directly or pass ?force=1.
      // Empty-array safeguard: run on the RAW incoming array, before deletion
      // reconciliation, or an empty POST would tombstone every live record. Only
      // NON-tombstoned records count — once all live records are deleted, the
      // leftover tombstones must not make a legitimately-empty roster get refused.
      const force = event.queryStringParameters?.force === "1";
      if (tasks.length === 0 && !force) {
        if (Array.isArray(existing) && existing.some(r => r && !r.deletedAt)) {
          return err(409, "Refusing to overwrite non-empty tasks with empty array");
        }
      }

      // Turn client-side deletions (ids in `existing` but absent from the
      // incoming array) into tombstones so delta-sync can propagate them.
      const reconciled = reconcileDeletions(tasks, existing);
      await writeJson(s3Key, stampArray(reconciled, existing));
      // Real-time: signal which jobs changed AFTER the write succeeds. Awaited
      // (serverless freezes post-response) but never throws, so it can't fail
      // the save.
      const changed = changedIds(reconciled, existing);
      const orgCode = orgCodeFromHeader(event);
      await publishChange(orgCode, "tasks", { ids: changed });

      // Phase 5 push. Only when something actually changed — a no-op autosave
      // preserves every stamp, so `changed` is empty and there's nothing to
      // notify or sync. Fires the event-specific VISIBLE pushes (assigned /
      // unassigned / finish-request resolved / status change) plus a SILENT
      // background-sync push to everyone else. All best-effort: the push
      // helpers never throw, so a OneSignal failure can't fail the save
      // (adversarial check #2).
      if (changed.length > 0) {
        // Isolated so a push-path error can never turn a SUCCESSFUL save into a
        // 500 — the write above already committed (adversarial check #2). The
        // helpers are best-effort internally too; this is belt-and-suspenders.
        try {
          await notifyTaskChanges({ orgCode, member, next: reconciled, prev: existing });
        } catch (e) {
          console.error("tasks push notify failed (save still succeeded):", e);
        }
      }
      return json(200, { ok: true });
    } catch (e) {
      console.error("tasks POST error:", e);
      return err(500, "Failed to save tasks");
    }
  }

  return err(405, "Method not allowed");
}

// Fire Phase-5 pushes for a tasks write. VISIBLE pushes go to the specific
// people an event concerns; a SILENT push then goes to every OTHER org member so
// their app background-syncs. A person who got a visible push is skipped from the
// silent one (visible pushes also carry content_available, so they already
// wake the app) — each device gets at most one push per write.
//
// The write's author (member.personId) is excluded from every push: their own
// client made the change and already has it (adversarial check #3). The lone
// exception is a finish-request resolution, which is self-directed — it's sent
// to the request's author (who is the worker, not the admin doing the write).
async function notifyTaskChanges({ orgCode, member, next, prev }) {
  const writerId = member?.personId != null ? String(member.personId) : null;
  let people = [];
  try { people = filterLive((await readJson(`orgs/${orgCode}/people.json`)) || []); } catch { people = []; }
  const allIds = people.map((p) => p && p.id).filter((v) => v != null).map(String);
  // Admins only receive approval-queue notifications (finish/completion requests +
  // eng steps, handled in notify.js). A job STATUS change is not an approval item,
  // so admins are excluded from status pushes below even if they're on the team.
  const adminIds = new Set(people.filter((p) => p && p.userRole === "admin").map((p) => String(p.id)));

  const { teamAdded, teamRemoved, finishResolved, statusChanges } = diffTaskEvents(next, prev);
  const serverTime = new Date().toISOString();
  const notified = new Set(); // person ids that already got a VISIBLE push

  const sendVisible = async (personId, opts) => {
    if (!personId || personId === writerId) return;
    await sendVisiblePush(orgCode, people, [personId], opts);
    notified.add(String(personId));
  };

  for (const [personId, jobs] of teamAdded) {
    const list = [...jobs.values()];
    const content = list.length === 1
      ? `You've been assigned to ${list[0].title}`
      : `You've been assigned to ${list.length} jobs`;
    const jobNumber = list.length === 1 ? list[0].jobNumber : null;
    await sendVisible(personId, {
      heading: "New assignment", content,
      data: { type: "assigned", ...(jobNumber ? { jobNumber } : {}) }, label: "assigned",
    });
  }

  for (const [personId, jobs] of teamRemoved) {
    const list = [...jobs.values()];
    const content = list.length === 1
      ? `You've been unassigned from ${list[0].title}`
      : `You've been unassigned from ${list.length} jobs`;
    const jobNumber = list.length === 1 ? list[0].jobNumber : null;
    await sendVisible(personId, {
      heading: "Unassigned", content,
      data: { type: "unassigned", ...(jobNumber ? { jobNumber } : {}) }, label: "unassigned",
    });
  }

  // Self-directed: goes to the requester even though they "submitted" it.
  for (const f of finishResolved) {
    if (!f.authorId) continue;
    await sendVisiblePush(orgCode, people, [f.authorId], {
      heading: f.resolution === "approved" ? "Finish request approved" : "Finish request rejected",
      content: `Your finish request on ${f.unitTitle} was ${f.resolution}.`,
      data: { type: "finish", ...(f.jobNumber ? { jobNumber: f.jobNumber } : {}) }, label: "finish",
    });
    notified.add(String(f.authorId));
  }

  for (const s of statusChanges) {
    const recips = s.teamIds.filter((id) => id && id !== writerId && !s.excludeIds.includes(id) && !adminIds.has(String(id)));
    if (recips.length === 0) continue;
    await sendVisiblePush(orgCode, people, recips, {
      heading: "Status update",
      content: `${s.unitTitle} is now ${s.newStatus}`,
      data: { type: "status", ...(s.jobNumber ? { jobNumber: s.jobNumber } : {}) }, label: "status",
    });
    recips.forEach((id) => notified.add(String(id)));
  }

  // Silent background-sync to everyone who didn't get a visible push (which
  // already wakes the app via content_available), minus the author.
  const silentIds = allIds.filter((id) => id !== writerId && !notified.has(id));
  await sendSilentPush(orgCode, { entity: "tasks", serverTime, people, personIds: silentIds });
}
