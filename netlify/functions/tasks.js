import { requireOrgMember } from "./_utils/auth.js";
import { can, requirePerm, canApprove, canEngineer } from "./_utils/can.js";
import { classifyTaskChanges } from "./_utils/task-perms.js";
import { recordRuleEvents, diffFields } from "./_utils/rule-log.js";
import { pendingFinishOf } from "../../src/finishRequests.js";
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
import { overlapContext, overlapViolations } from "../../src/overlapRules.js";
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
      // One overlap rule (src/overlapRules.js), Business only — Basic allows a double-booked
      // shift by design. Its own switch, so it can be enforced independently of the rest.
      let overlapMode = ruleMode("OVERLAP_RULE_MODE");
      if (overlapMode !== "off") {
        let billing = null;
        try { billing = await readJson(`orgs/${orgCode}/billing.json`); } catch { billing = null; }
        if ((billing?.tier || "basic") !== "business") overlapMode = "off";
      }
      let rulePeople = [], ruleSettings = null;
      if (rulesMode !== "off" || overlapMode !== "off") {
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
        attempt = { conflicts: [], violations: [], gateDiff: null, hpdDefaults: [], overlaps: [], counterKeeps: [] };

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
        // ── Server-owned counters (#323) ──────────────────────────────────
        // loggedHours is written by the clock paths and by nothing else. This
        // endpoint takes a whole copy of the tree, so a client that read before a
        // clock-out credit landed puts the pre-credit value straight back — and
        // because a client that has never seen the field omits the KEY, the write
        // deletes the counter rather than lowering it. Measured on Matrix: the
        // 401944 Thacker II credit landed at 17:30:52 and all three counters (job,
        // panel, op) were gone two seconds later, and 30 of 434 panels store less
        // than their own session rows — 789h of credited work that no longer has a
        // counter behind it.
        //
        // Deliberately NOT behind a ruleMode. The per-job stale-copy check (#185)
        // already covers this case and would have refused that write in `enforce`;
        // it defaults to `log`, so for months it recorded the clobber and allowed
        // it. A second switch left in its off position is how the first one failed.
        //
        // Only nodes that already exist are protected. A new node keeps whatever it
        // arrived with, which is what lets a split write `loggedHours: 0` on the op
        // it creates. The one legitimate client write of an existing counter — "Set
        // Worked Hours" — goes through setOpWorkedHours in timeclock.js instead.
        if (Array.isArray(existing)) {
          const idx = indexNodesById(existing);
          const kept = [];
          incoming = keepServerOwned(incoming, idx, kept);
          attempt.counterKeeps = kept;
        }
        if (conflictMode !== "off" && Array.isArray(existing)) {
          const storedById = new Map(existing.filter(r => r && r.id != null).map(r => [String(r.id), r]));
          for (const job of tasks) {
            if (!job || job.id == null) continue;
            const was = storedById.get(String(job.id));
            if (!was || (job.lastModifiedAt ?? null) === (was.lastModifiedAt ?? null)) continue;
            if (changedIds([job], [was]).length === 0) continue;   // stale stamp, same content
            // WHICH fields differ, not just that the job does. Diffed against the RAW
            // incoming job rather than the normalised one, so a loggedHours clobber still
            // shows up here — keepServerOwned has already quietly repaired it above, and a
            // record that hid the repair would hide the very thing #323 was about.
            const fields = diffFields(job, was);
            attempt.conflicts.push({
              id: String(job.id),
              incomingStamp: job.lastModifiedAt ?? null,
              storedStamp: was.lastModifiedAt ?? null,
              // Negative means the client's copy is OLDER than what is stored, which is the
              // true stale-copy signature; a positive gap is a client that read, edited and
              // saved while someone else wrote in between.
              staleByMs: (Date.parse(job.lastModifiedAt ?? "") || 0) - (Date.parse(was.lastModifiedAt ?? "") || 0),
              fieldCount: fields.length,
              fields: fields.slice(0, 40),
            });
          }
          if (conflictMode === "enforce" && attempt.conflicts.length) {
            const stale = new Set(attempt.conflicts.map(c => c.id));
            incoming = tasks.map(job => (job && job.id != null && stale.has(String(job.id))) ? storedById.get(String(job.id)) : job);
          }
        }
        const prev = Array.isArray(existing) ? existing : [];

        // #301: an iOS build before 88e1ce6 decodes a unit with no hpd as 7.5 and writes it
        // back on every save. The server can't tell that default from a typed 7.5, nor an
        // old build from a new one, so this only records it — the write goes through.
        attempt.hpdDefaults = unestimatedNowSevenPointFive(incoming, prev);

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

        // ── Overlap: a person doing two things at once, on units this write changed ──
        if (overlapMode !== "off") {
          const octx = overlapContext(ruleSettings || {}, localDay(new Date(), ruleSettings?.timeZone || null));
          attempt.overlaps = overlapViolations(incoming, prev, octx);
          if (overlapMode === "enforce" && attempt.overlaps.length) {
            return { abort: json(422, { error: attempt.overlaps.map(v => v.detail).join("; "), violations: attempt.overlaps }) };
          }
        }

        // Turn client-side deletions (ids in `existing` but absent from the
        // incoming array) into tombstones so delta-sync can propagate them.
        const reconciled = reconcileDeletions(incoming, existing);
        // The stamped array is kept on `attempt` so the RESPONSE can carry the
        // new `lastModifiedAt` per job. Without that the client has no way to
        // learn its own write's stamp until the next 30s poll, so every save it
        // makes in between carries the stamp it loaded with — and the conflict
        // check sees each write as stale against the write before it. See #337.
        const stamped = stampArray(reconciled, existing);
        attempt.stamped = stamped;
        return { value: stamped, reconciled, existing };
      });

      // Logged once, for the pass that decided the outcome (never per retry).
      const who = { personId: member.personId != null ? String(member.personId) : null, isAdmin: !!member.isAdmin };
      // Every rule event is written twice: to the function log, which is immediate and
      // useless a day later, and to orgs/{org}/rule-events.json, which is the one that can
      // be read back (#327). Collected into a single list so the whole request costs one
      // append rather than one per rule. Awaited — serverless freezes after the response —
      // but recordRuleEvents can never throw, so it cannot fail the save it describes.
      const durable = [];
      const ua = event.headers?.["user-agent"] || event.headers?.["User-Agent"] || null;

      if (conflictMode !== "off") {
        for (const c of attempt.conflicts) logRule("task-conflict", { mode: conflictMode, jobId: c.id, incomingStamp: c.incomingStamp, storedStamp: c.storedStamp, fieldCount: c.fieldCount, ...who });
        // The field list is what decides whether TASK_CONFLICT_MODE can go to enforce: it
        // says whether a refusal would have landed on a clobber or on somebody legitimately
        // moving a bar.
        for (const c of attempt.conflicts) durable.push({
          tag: "task-conflict", mode: conflictMode, refused: conflictMode === "enforce",
          jobId: c.id, incomingStamp: c.incomingStamp, storedStamp: c.storedStamp,
          staleByMs: c.staleByMs, fieldCount: c.fieldCount, fields: c.fields,
        });
      }
      // Not a mode, so this is never a "would have refused" line — it is a record of a
      // clobber that WAS prevented, and the volume is the measure of how often the race
      // actually fires. A `stored: null` means the incoming copy had dropped the key.
      for (const k of (attempt.counterKeeps || [])) {
        logRule("server-owned-field", { ...k, ...who });
        durable.push({ tag: "server-owned-field", mode: null, refused: true, ...k });
      }
      for (const id of attempt.hpdDefaults) {
        logRule("hpd-default-write", { id, ...who, userAgent: ua });
        // No decision to record — the write always goes through. What makes it worth
        // keeping is WHICH client is doing it: the point of #301 is to find the build that
        // decodes a missing hpd as 7.5, and the User-Agent is the only thing that names it.
        durable.push({ tag: "hpd-default-write", mode: null, refused: false, id, userAgent: ua });
      }
      for (const v of attempt.overlaps) {
        logRule("schedule-rule", { mode: overlapMode, rule: v.rule, id: v.id, jobId: v.jobId, withId: v.withId, personId: v.personId, day: v.day, detail: v.detail, by: who.personId, isAdmin: who.isAdmin });
        // Its own tag, though it shares one in the function log. The overlap rule has its own
        // switch and its own tier gate, so a reader counting "schedule-rule" was adding two
        // different decisions together and could not tell which flag the number belonged to.
        durable.push({ tag: "overlap-rule", mode: overlapMode, refused: overlapMode === "enforce",
          rule: v.rule, opId: v.id, withOpId: v.withId, jobId: v.jobId, personId: v.personId, day: v.day, detail: v.detail });
      }
      if (attempt.gateDiff) {
        logRule("permission-gate", { mode: gateMode, gate: "taskPerms", ...attempt.gateDiff, ...who });
        // Only written when the two classifiers DISAGREE, so the record is the disagreement:
        // which way each went, the permission at stake, and the reason given.
        durable.push({ tag: "permission-gate", mode: gateMode, refused: gateMode === "enforce" && attempt.gateDiff.next === "refuse",
          gate: "taskPerms", legacy: attempt.gateDiff.legacy, next: attempt.gateDiff.next,
          perms: attempt.gateDiff.perms, reason: attempt.gateDiff.reason });
      }
      if (rulesMode !== "off") {
        for (const v of attempt.violations) logRule("schedule-rule", { mode: rulesMode, rule: v.rule, id: v.id, jobId: v.jobId, detail: v.detail, ...who });
        for (const v of attempt.violations) durable.push({
          tag: "schedule-rule", mode: rulesMode, refused: rulesMode === "enforce",
          rule: v.rule, opId: v.id, jobId: v.jobId, detail: v.detail, value: v.value ?? null, bound: v.bound ?? null,
        });
      }
      await recordRuleEvents(orgCode, durable, who);
      if ("abort" in result) return result.abort;

      const { reconciled, existing } = result;
      // Real-time: signal which jobs changed AFTER the write succeeds. Awaited
      // (serverless freezes post-response) but never throws, so it can't fail
      // the save.
      const changed = changedIds(reconciled, existing);
      await publishChange(orgCode, "tasks", { ids: changed });

      // ── Session reactions to this write (#189/#190/#192/#193) ──────────────
      // Two things used to happen in a useEffect in EVERY open browser, reacting to polled
      // data: freeze a session when a finish request appears on its op, and rebaseline the
      // drain anchor when somebody moves the op being worked. Both wrote server-owned session
      // state, so each browser POSTed its own Date.now() for every clocked-in person and the
      // stored value was whichever clock landed last — while a non-admin's browser 403'd for
      // everyone but itself, silently, on every tick.
      //
      // They belong here, on the write that causes them: it happens once, it has one clock,
      // and it already knows exactly which ops changed and how. The merges in
      // updateJobSession are idempotent as well (frozenAtMs write-once, drainCheckpoint
      // forward-only), so an old client still doing it can no longer do harm.
      //
      // Best-effort: the tasks write has already succeeded and a failure here must not turn
      // a saved schedule into an error.
      try { await applySessionReactions(orgCode, reconciled, existing); } catch { /* non-fatal */ }

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
      // #337. The response carries the stamp the server just wrote for every
      // job, keyed by id. The client adopts them, so its NEXT save compares
      // against what is actually stored instead of against the stamp it loaded
      // with. Before this the body was `{ ok: true }` and doSave dropped it
      // entirely, which is why five sequential drags produced five
      // task-conflict records whose incomingStamp never moved.
      //
      // Only the stamp is returned, not the jobs: the client already holds the
      // content it just sent, and echoing the tree back would make every save
      // pay for a second copy of it.
      const stamps = {};
      for (const j of (attempt.stamped || [])) {
        if (j && j.id != null && j.lastModifiedAt) stamps[String(j.id)] = j.lastModifiedAt;
      }
      // `conflicts` only in enforce: a client that sees it rolls those jobs back.
      return json(200, conflictMode === "enforce"
        ? { ok: true, stamps, conflicts: attempt.conflicts.map(c => c.id) }
        : { ok: true, stamps });
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

  const { teamAdded, teamRemoved, finishResolved, statusChanges, dayMoves } = diffTaskEvents(next, prev);
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

  // #222. A move that crossed a DAY, to the people on that unit. Within-day
  // nudges are excluded in diffTaskEvents, deliberately — see the note there.
  //
  // Placed AFTER the loops above so the `notified` set already holds anyone who
  // got a more specific push this write: someone newly assigned to a job is
  // told they were assigned, not that it moved, and someone whose unit just
  // went Finished gets the status push instead. A move is the LEAST specific
  // thing that can happen to a unit, so it yields to everything else rather
  // than stacking a second notification on the same person for one write.
  for (const m of dayMoves) {
    const recips = m.teamIds.filter((id) => id && id !== writerId && !notified.has(String(id)));
    if (recips.length === 0) continue;
    await sendVisiblePush(orgCode, people, recips, {
      heading: "Schedule change",
      content: `${m.unitTitle} moved from ${m.fromStart} to ${m.toStart}`,
      data: { type: "moved", ...(m.jobNumber ? { jobNumber: m.jobNumber } : {}) }, label: "moved",
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
/**
 * React to a tasks write on behalf of any live job session it affects.
 *
 *   FREEZE      an op that has just acquired a pending finish request holds every session
 *               on it, at this write's instant. Write-once, so the first wins.
 *   REBASELINE  an op whose moveLog grew by an entry that does NOT belong to the session
 *               working it was moved by somebody else, and the shrink anchor has to restart
 *               from where the bar landed — otherwise the already-worked hours reapply to
 *               the new plannedStart and the bar jumps.
 *
 * One people.json write for both, under a conditional update, so this cannot clobber a clock
 * action landing at the same moment.
 */
async function applySessionReactions(orgCode, next, prev) {
  if (!Array.isArray(next)) return;
  const index = (arr) => {
    const m = new Map();
    for (const j of (arr || [])) for (const p of (j?.subs || [])) for (const o of (p?.subs || [])) if (o?.id != null) m.set(String(o.id), o);
    return m;
  };
  const after = index(next), before = index(prev);

  const freezeOps = new Set();
  const movedOps = new Map();                // opId -> the sessionId that owns the last entry
  for (const [id, op] of after) {
    const was = before.get(id);
    if (pendingFinishOf(op) && !(was && pendingFinishOf(was))) freezeOps.add(id);
    const lenNow = (op.moveLog || []).length, lenWas = (was?.moveLog || []).length;
    if (lenNow > lenWas) movedOps.set(id, (op.moveLog || [])[lenNow - 1]?.sessionId ?? null);
  }
  if (!freezeOps.size && !movedOps.size) return;

  const nowMs = Date.now(), nowIso = new Date(nowMs).toISOString();
  await updateJson(orgKeyFor(orgCode, "people.json"), (stored) => {
    const arr = [...(stored ?? [])];
    let touched = false;
    for (let i = 0; i < arr.length; i++) {
      const jc = arr[i]?.activeJobClock;
      if (!jc) continue;
      let nextJc = jc;
      if (jc.opId != null && freezeOps.has(String(jc.opId)) && jc.frozenAtMs == null) {
        nextJc = { ...nextJc, frozenAtMs: nowMs };                       // write-once
      }
      if (jc.reservoirOpId != null && jc.sessionId && jc.drainCheckpoint && movedOps.has(String(jc.reservoirOpId))) {
        // Not our own persistShrink write — that one carries this session's id, and
        // rebaselining on it would erase the edge it just banked.
        if (movedOps.get(String(jc.reservoirOpId)) !== jc.sessionId
          && Date.parse(nowIso) > Date.parse(jc.drainCheckpoint)) {      // forward only
          const pausedNow = (jc.totalPausedMs || 0) + (jc.pausedAt ? Math.max(0, nowMs - Date.parse(jc.pausedAt)) : 0);
          nextJc = { ...nextJc, drainCheckpoint: nowIso, pausedMsAtCheckpoint: pausedNow };
        }
      }
      if (nextJc !== jc) { arr[i] = { ...arr[i], activeJobClock: nextJc }; touched = true; }
    }
    return touched ? { value: stampArray(arr, stored) } : { abort: null };
  });
}

// ── Server-owned counters ───────────────────────────────────────────────────
// Fields the clock paths own outright. A whole-tree POST carries them because it
// carries everything, but it is never the authority on them: the only copy that
// counts is the one in S3, which jobClockOut and adminJobHours increment.
const SERVER_OWNED_FIELDS = ["loggedHours"];

/** Every node in the tree by string id, at all three levels. */
function indexNodesById(nodes, into = new Map()) {
  for (const n of (nodes || [])) {
    if (!n || typeof n !== "object") continue;
    if (n.id != null) into.set(String(n.id), n);
    if (Array.isArray(n.subs)) indexNodesById(n.subs, into);
  }
  return into;
}

/**
 * Replace every server-owned field on an EXISTING node with the stored value,
 * including restoring one the incoming copy dropped entirely. Nodes the stored
 * tree has never seen are returned untouched.
 *
 * Identity is preserved where nothing changed: the conflict check and
 * stampArray both compare content, and handing them fresh objects for untouched
 * nodes would turn every save into a change.
 */
function keepServerOwned(nodes, storedIdx, kept) {
  if (!Array.isArray(nodes)) return nodes;
  let moved = false;
  const out = nodes.map((n) => {
    if (!n || typeof n !== "object") return n;
    const was = n.id != null ? storedIdx.get(String(n.id)) : null;
    let next = n;
    if (was) {
      for (const f of SERVER_OWNED_FIELDS) {
        const mine = n[f], theirs = was[f];
        if (mine === theirs) continue;
        if (next === n) next = { ...n };
        if (theirs === undefined) delete next[f]; else next[f] = theirs;
        kept.push({ id: String(n.id), field: f, incoming: mine ?? null, stored: theirs ?? null });
      }
    }
    if (Array.isArray(n.subs)) {
      const subs = keepServerOwned(n.subs, storedIdx, kept);
      if (subs !== n.subs) { if (next === n) next = { ...n }; next.subs = subs; }
    }
    if (next !== n) moved = true;
    return next;
  });
  return moved ? out : nodes;
}

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

// Ids of stored units with no estimate (hpd absent or null) that this write sets to
// exactly 7.5 — the old iOS decode default (SCHEDULE_MAP #301).
function unestimatedNowSevenPointFive(nextTasks, prevTasks) {
  const index = (tasks) => {
    const m = new Map();
    for (const j of tasks || []) {
      if (!j || j.id == null) continue;
      m.set(String(j.id), j);
      for (const p of j.subs || []) {
        if (!p || p.id == null) continue;
        m.set(String(p.id), p);
        for (const o of p.subs || []) if (o && o.id != null) m.set(String(o.id), o);
      }
    }
    return m;
  };
  const before = index(prevTasks);
  const out = [];
  for (const [id, n] of index(nextTasks)) {
    const was = before.get(id);
    if (was && (was.hpd === undefined || was.hpd === null) && n.hpd === 7.5) out.push(id);
  }
  return out;
}

// people.json lives beside tasks.json under the same org prefix. orgKey() reads the header
// off an event, which this helper does not have, so the key is built from the code the
// handler already resolved.
function orgKeyFor(orgCode, file) { return `orgs/${orgCode}/${file}`; }
