import { requireOrgMember } from "./_utils/auth.js";
import { can, requirePerm, canApprove, canEngineer } from "./_utils/can.js";
import { classifyTaskChanges } from "./_utils/task-perms.js";
import { classifyTaskActions } from "../../src/taskActions.js";
import { readJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { stampArray, reconcileDeletions, changedIds } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { diffTaskEvents } from "./_utils/task-events.js";
import { updateJson } from "./_utils/update-json.js";
import { ruleMode, logRule } from "./_utils/rule-mode.js";
import { scheduleRuleViolations } from "../../src/scheduleRules.js";
import { localDay } from "../../src/localDay.js";
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
      let tasks;
      try { tasks = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }
      if (!Array.isArray(tasks)) return err(400, "Invalid tasks data");

      // Rule context, read once: who is clocked in (activeClock) and the org's work
      // week, holidays and timezone (businessDay, past). A read failure disables
      // those rules for this write rather than failing a save that used to work.
      const orgCode = orgCodeFromHeader(event);
      const rulesMode = ruleMode("SCHEDULE_RULES_MODE");
      const conflictMode = ruleMode("TASK_CONFLICT_MODE");
      const gateMode = ruleMode("PERMISSION_GATES_MODE");
      let rulePeople = [], ruleSettings = null;
      if (rulesMode !== "off") {
        try { rulePeople = filterLive((await readJson(`orgs/${orgCode}/people.json`)) || []); } catch { rulePeople = []; }
        try { ruleSettings = await readJson(`orgs/${orgCode}/settings.json`); } catch { ruleSettings = null; }
      }
      const force = event.queryStringParameters?.force === "1";

      // Everything that depends on what is stored runs inside updateJson: it reads
      // the file with its ETag, builds the write, and writes only if nobody wrote in
      // between — otherwise it re-reads and runs this again. tasks.json has two
      // writers (this and timeclock.js), and with a plain PUT a clock action landing
      // between our read and our write was silently undone (SCHEDULE_MAP #185).
      // `attempt` is per pass; nothing here may have side effects.
      let attempt;
      const result = await updateJson(s3Key, (stored) => {
        const existing = stored;
        attempt = { conflicts: [], violations: [], gateDiff: null };

        // Refuse to overwrite a non-empty tasks.json with an empty array.
        // Why: a client bug (failed initial fetch → React resets state → autosave fires)
        // wiped MTX2026TRAQS/tasks.json on 2026-06-03. This guard makes that race fatal
        // on the server instead of silently destroying data. To intentionally clear all
        // tasks, delete the S3 object directly or pass ?force=1.
        // Empty-array safeguard: run on the RAW incoming array, before deletion
        // reconciliation, or an empty POST would tombstone every live record. Only
        // NON-tombstoned records count — once all live records are deleted, the
        // leftover tombstones must not make a legitimately-empty roster get refused.
        if (tasks.length === 0 && !force) {
          if (Array.isArray(existing) && existing.some(r => r && !r.deletedAt)) {
            return { abort: err(409, "Refusing to overwrite non-empty tasks with empty array") };
          }
        }

        // ── Stale job copies ──────────────────────────────────────────────
        // Every job carries the server's lastModifiedAt. A POSTed job whose stamp is
        // not the stored one was copied before the stored version was written, so
        // writing it would undo that write — the clock-in status, clock-out hours or
        // finish request someone else just made. When its content differs too, it is
        // a conflict: in enforce the stored job is kept and the id is reported back;
        // in log the write goes through as before and the conflict is only recorded.
        let incoming = tasks;
        if (conflictMode !== "off" && Array.isArray(existing)) {
          const storedById = new Map(existing.filter(r => r && r.id != null).map(r => [String(r.id), r]));
          for (const job of tasks) {
            if (!job || job.id == null) continue;
            const was = storedById.get(String(job.id));
            if (!was || (job.lastModifiedAt ?? null) === (was.lastModifiedAt ?? null)) continue;
            if (changedIds([job], [was]).length === 0) continue;   // stale stamp, same content
            attempt.conflicts.push({ id: String(job.id), incomingStamp: job.lastModifiedAt ?? null, storedStamp: was.lastModifiedAt ?? null });
          }
          if (conflictMode === "enforce" && attempt.conflicts.length) {
            const stale = new Set(attempt.conflicts.map(c => c.id));
            incoming = tasks.map(job => (job && job.id != null && stale.has(String(job.id))) ? storedById.get(String(job.id)) : job);
          }
        }
        const prev = Array.isArray(existing) ? existing : [];

        // ── Permission check ────────────────────────────────────────────────
        // This endpoint takes a whole-array replace, so the only way to tell a
        // job creation from a bar drag is to diff against what is stored and
        // demand the permission that matches. Before this, membership alone was
        // enough: any worker could POST a replacement schedule, and the Jobs
        // page hiding its buttons was the only thing stopping them.
        //
        // An unchanged tree is always allowed — autosave re-POSTs constantly and
        // a no-op save must never 403.
        // Two classifiers during the rollout: the original field-by-field one, and
        // src/taskActions.js, which classifies side effects by the action they belong
        // to (root cause 4). PERMISSION_GATES_MODE picks which one decides; in log
        // the original still decides and any disagreement is recorded.
        const me = member.personId != null ? String(member.personId) : null;
        const legacyCls = classifyTaskChanges(incoming, prev);
        const actionCls = classifyTaskActions(incoming, prev);
        const legacyErr = legacyCls.changed ? permissionError(legacyCls, member, me) : null;
        const actionErr = actionCls.changed ? permissionError(actionCls, member, me) : null;
        if (gateMode !== "off" && !!legacyErr !== !!actionErr) {
          attempt.gateDiff = { legacy: legacyErr ? "refuse" : "allow", next: actionErr ? "refuse" : "allow",
            reason: (actionErr || legacyErr).message, perms: [...actionCls.perms] };
        }
        const decision = gateMode === "enforce" ? actionErr : legacyErr;
        if (decision) return { abort: err(decision.status, decision.message) };

        // ── Schedule rules (src/scheduleRules.js, shared with the web) ─────
        if (rulesMode !== "off") {
          attempt.violations = scheduleRuleViolations(incoming, prev, {
            people: rulePeople,
            workDays: ruleSettings?.workDays,
            holidays: ruleSettings?.holidays,
            today: localDay(new Date(), ruleSettings?.timeZone || null),
            isAdmin: !!member.isAdmin,
          });
          if (rulesMode === "enforce" && attempt.violations.length) {
            return { abort: json(422, {
              error: attempt.violations.map(v => v.detail).join("; "),
              violations: attempt.violations,
            }) };
          }
        }

        // Turn client-side deletions (ids in `existing` but absent from the
        // incoming array) into tombstones so delta-sync can propagate them.
        const reconciled = reconcileDeletions(incoming, existing);
        return { value: stampArray(reconciled, existing), reconciled, existing };
      });

      // Logged once, for the pass that decided the outcome (never per retry).
      const who = { personId: member.personId != null ? String(member.personId) : null, isAdmin: !!member.isAdmin };
      if (conflictMode !== "off") {
        for (const c of attempt.conflicts) logRule("task-conflict", { mode: conflictMode, jobId: c.id, incomingStamp: c.incomingStamp, storedStamp: c.storedStamp, ...who });
      }
      if (attempt.gateDiff) logRule("permission-gate", { mode: gateMode, gate: "taskPerms", ...attempt.gateDiff, ...who });
      if (rulesMode !== "off") {
        for (const v of attempt.violations) logRule("schedule-rule", { mode: rulesMode, rule: v.rule, id: v.id, jobId: v.jobId, detail: v.detail, ...who });
      }
      if ("abort" in result) return result.abort;

      const { reconciled, existing } = result;
      // Real-time: signal which jobs changed AFTER the write succeeds. Awaited
      // (serverless freezes post-response) but never throws, so it can't fail
      // the save.
      const changed = changedIds(reconciled, existing);
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
      // `conflicts` only in enforce: a client that sees it rolls those jobs back.
      return json(200, conflictMode === "enforce"
        ? { ok: true, conflicts: attempt.conflicts.map(c => c.id) }
        : { ok: true });
    } catch (e) {
      if (e?.statusCode === 503) return err(503, e.message);
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

// Whether `member` may make a write classified as `cls` (from either classifier).
// Returns { status, message } for a refusal, or null.
function permissionError(cls, member, me) {
  for (const key of cls.perms) {
    try { requirePerm(member, key); } catch (e) { return { status: e.statusCode || 403, message: e.message }; }
  }
  if (cls.needsApprove && !canApprove(member)) return { status: 403, message: "You do not have permission to sign off work" };
  if (cls.needsEngineer && !canEngineer(member)) return { status: 403, message: "Only engineers can change engineering steps" };
  // Raising a finish request needs no permission, but only for yourself:
  // a request on someone else's behalf is theirs to raise, or an approver's.
  if ([...(cls.raisedBy || [])].some(by => by !== me) && !can(member, "approveCompletions")) {
    return { status: 403, message: "You can only raise a finish request for yourself" };
  }
  // A chain step is signed by an approver, or by the person it is assigned to.
  for (const sign of cls.chainSigns || []) {
    if (!canApprove(member) && !(sign.assigneeId != null && String(sign.assigneeId) === me)) {
      return { status: 403, message: "This approval step is assigned to someone else" };
    }
  }
  return null;
}
