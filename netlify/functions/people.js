import { requireOrgMember } from "./_utils/auth.js";
import { can } from "./_utils/can.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { stampArray, nowIso, reconcileDeletions, softDelete, changedIds } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendSilentPush } from "./_utils/push.js";
import { encryptPin, decryptPin } from "./_utils/pin.js";
import { ruleMode, logRule } from "./_utils/rule-mode.js";
import { recordRuleEvents } from "./_utils/rule-log.js";

// Escalation-sensitive person fields a non-admin must never set on themselves
// or anyone: PTO must flow through timeoff.js approval, and pay/permissions/
// department are admin-managed. Enforced on both POST (full roster) and PATCH.
const PROTECTED_PERSON_FIELDS = [
  "timeOff", "payType", "cap", "adminPerms", "canClockInOut", "canSignOff",
  "noAutoSchedule", "autoSchedule", "teamNumber", "userRole", "role",
  "department", "isEngineer",
];

// Fields only the SERVER may set. A full-roster POST carries every person's
// whole record, so any client holding a stale roster writes back whatever it last
// saw — and for these fields "what it last saw" is routinely out of date by the
// time the POST lands. The desktop autosaves the entire array (doSave in
// TRAQS.jsx), so with a browser left open all day a stale value gets re-asserted
// every few seconds.
//
// Two live bugs came from exactly that, and both looked like the phone was broken:
//
//   * activeBreak — the worker ends a break (or clocks out, which closes it via
//     closeActiveBreak); timeclock.js clears the flag and logs the breakEnd row
//     to payhours. Then a stale POST puts the flag BACK. payhours stays correct,
//     so the timesheet reads right while every client shows "On break · 47m" and
//     iOS's OpenBreakCard tells them to end a break they already ended. No client
//     sets this through here — web and iOS both go through breakBegin/breakClear —
//     so pinning it costs nothing.
//
//   * pushToken — a roster fetched before a phone registered has no token, so the
//     POST wipes it, and _utils/push.js then drops that person from every native
//     push (desktop web push comes from its own store, so it keeps working and the
//     loss looks like an iOS problem). iOS re-registers on the next foreground and
//     the next stale POST wipes it again. PATCH is the writer for this field —
//     that is what it exists for — so a POST has no business carrying it.
//
// activeClockIn/activeJobClock were already pinned; these two belong with them.
// Not applied to PATCH as a whole: a PATCH names the one field it means to change,
// so it can't carry a stale value it never looked at, and pushToken is exactly
// what PATCH is for. The three session fields are pinned on PATCH separately
// (PATCH_PINNED_SESSION_FIELDS) — not because they go stale, but because nothing
// but a timeclock action may set them.
const PATCH_PINNED_SESSION_FIELDS = ["activeJobClock", "activeClockIn", "activeBreak"];

export function serverOwnedPersonFields(stored) {
  return {
    activeClockIn:  stored.activeClockIn  ?? null,
    activeJobClock: stored.activeJobClock ?? null,
    activeBreak:    stored.activeBreak    ?? null,
    pushToken:      stored.pushToken      ?? null,
  };
}

// Normalize a person's activeBreak so an active break always carries a startedAt.
// iOS may set the flag (even as a bare boolean) without persisting a start time;
// without this the admin "Live status" break timer has nothing to count from.
// An existing startedAt — from the incoming record or the stored one — is always
// preserved so an ongoing break's elapsed clock never resets.
function withBreakStart(p, stored) {
  const ab = p?.activeBreak;
  if (!ab) return p;
  const incomingStart = (typeof ab === "object" && ab.startedAt) || null;
  const storedStart = (stored?.activeBreak && typeof stored.activeBreak === "object" && stored.activeBreak.startedAt) || null;
  const dur = (typeof ab === "object" && ab.durationMinutes)
    || (stored?.activeBreak && typeof stored.activeBreak === "object" && stored.activeBreak.durationMinutes)
    || null;
  return {
    ...p,
    activeBreak: {
      ...(typeof ab === "object" ? ab : {}),
      startedAt: incomingStart || storedStart || new Date().toISOString(),
      ...(dur ? { durationMinutes: dur } : {}),
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "people.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET stays open so the kiosk team-select screen can load the roster BEFORE
  // the user signs in with Auth0. But the response is tiered:
  //   • Authenticated org member  → full record (minus PIN) — the app needs
  //     timeOff (scheduling) and other fields.
  //   • Unauthenticated kiosk      → reduced projection: PIN, pushToken and
  //     timeOff are dropped, so anyone who merely knows the org code can't
  //     harvest push tokens or employees' time-off PII. The kiosk only needs
  //     name/color/role/department/status/email, which remain.
  if (event.httpMethod === "GET") {
    let member = null;
    try { member = await requireOrgMember(event); } catch { /* unauthenticated kiosk */ }
    const isMember = !!member;
    const isAdmin = !!member?.isAdmin;
    try {
      const data = (await readJson(s3Key)) ?? [];
      // Hide soft-deleted (tombstoned) people from normal readers; /sync does
      // NOT filter these so delta-sync clients can evict the deleted row.
      // PIN tiering:
      //   • Admin       → the decrypted PIN (so the desktop eye can reveal it).
      //   • Non-admin    → only a `hasPin` boolean (drives the clock-in prompt /
      //                    settings set/unset indicator), never the value.
      //   • Kiosk        → no pin, pushToken or timeOff.
      // Legacy one-way-hashed PINs decrypt to null → surfaced as "" (re-enter to
      // make revealable), but hasPin still reflects that a PIN is set.
      const safe = filterLive(data)
        .map(({ pin, ...rest }) => {
          const withFlag = { ...rest, hasPin: !!pin };
          if (isAdmin) return { ...withFlag, pin: decryptPin(pin) ?? "" };
          if (isMember) return withFlag;
          const { pushToken: _pt, timeOff: _to, ...pub } = withFlag;
          return pub;
        });
      return json(200, safe);
    } catch (e) {
      console.error("people GET error:", e);
      return err(500, "Failed to read people");
    }
  }

  if (event.httpMethod === "POST") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      let incoming;
      try { incoming = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }
      if (!Array.isArray(incoming)) return err(400, "Invalid people data");
      if (incoming.length === 0) return err(400, "Refusing to overwrite people with empty array");

      // Check for userRole changes — only admins may change them.
      const existing = (await readJson(s3Key)) ?? [];
      const existingMap = new Map(existing.map(p => [p.id, p]));
      const callerId = member?.personId != null ? String(member.personId) : null;
      const hasRoleChange = incoming.some(p => {
        const old = existingMap.get(p.id);
        // New person being added as admin, or existing person's role changing.
        return old ? old.userRole !== p.userRole : p.userRole === "admin";
      });

      if (hasRoleChange && !can(member, "manageTeam")) {
        return err(403, "Only admins can change user roles");
      }

      // Preserve existing PINs for records that don't supply a new one, and
      // anchor a break-start time when a break is active but missing one (e.g.
      // iOS sets activeBreak without persisting startedAt) so admin timers stay
      // accurate. An existing startedAt is always preserved — never reset.
      const merged = incoming.map(p => {
        const stored = existingMap.get(p.id);
        // `hasPin` is a server-derived read flag — never persist it back.
        const { hasPin: _hp, ...pIn } = p;
        let np = (stored?.pin && !pIn.pin) ? { ...pIn, pin: stored.pin } : pIn;
        // Clock/break state and the push token are SERVER-AUTHORITATIVE — only the
        // timeclock functions (clockIn/clockOut/jobClockIn/jobClockOut/breakBegin/
        // breakClear/admin*) and the granular PATCH may set them. A general people
        // POST must never carry them back, or a client holding a stale roster
        // clobbers a clock-out, break-end or token registration that happened
        // elsewhere. Always keep whatever the server currently stores — see
        // serverOwnedPersonFields for what each one broke.
        if (stored) {
          np = { ...np, ...serverOwnedPersonFields(stored) };
        }
        // Anchor a startedAt on the break we just pinned. Runs AFTER the pin, so
        // it can only ever repair the stored break — never adopt an incoming one.
        np = withBreakStart(np, stored);
        // Non-admins may only edit SAFE fields (name/email/phone/color/image/
        // pushToken) on their OWN record. Other people's records are preserved
        // verbatim, and escalation-sensitive fields on their own record are
        // pinned to the stored value. Admins bypass this.
        if (!can(member, "manageTeam") && stored) {
          const isSelf = callerId != null && String(p.id) === callerId;
          if (!isSelf) {
            np = { ...stored };
          } else {
            for (const k of PROTECTED_PERSON_FIELDS) {
              if (k in stored) np[k] = stored[k];
              else delete np[k];
            }
          }
        }
        // Keep the desktop's canonical `department` in sync with `role` (the two
        // are one field; iOS only stores/encodes `role`). Fill it from role when
        // absent so an admin's role edit propagates and department isn't dropped.
        if (np.role != null && np.department == null) np.department = np.role;
        // Store PINs reversibly encrypted. encryptPin is idempotent (leaves an
        // already-encrypted value as-is), so a newly-typed plaintext PIN gets
        // encrypted and any legacy plaintext PIN preserved above is upgraded in
        // place on this write. Legacy one-way hashes are left untouched until
        // re-entered.
        if (np.pin) np = { ...np, pin: encryptPin(np.pin) };
        return np;
      });

      // Reconcile deletions: any existing person absent from the incoming roster
      // becomes a tombstone (kept in the array) so delta-sync clients evict them.
      // Runs only on a non-empty roster — the empty-array guard above already
      // refuses an empty POST, so this can never mass-tombstone the whole team.
      // Strip the PIN when tombstoning a person: a removed employee's PIN must
      // not linger at rest, and (belt-and-suspenders with timeclock's live-only
      // PIN identify) a pinless tombstone also can't authenticate a kiosk clock-in.
      const tombstoneWithoutPin = ({ pin: _pin, ...rest }) => softDelete(rest);
      // Non-admins can't create people — drop any incoming record with no stored
      // counterpart. (They still send the full roster, so existing rows aren't
      // tombstoned by this.)
      //
      // Removing someone is the same: it needs manageTeam. Every stored person
      // missing from the array used to be tombstoned whoever sent it, so any
      // member could delete a colleague — or, by POSTing just their own row,
      // the whole team. For anyone without manageTeam a missing row is kept.
      let safeMerged = merged;
      if (!can(member, "manageTeam")) {
        const incomingIds = new Set(merged.map(p => String(p.id)));
        safeMerged = [
          ...merged.filter(p => existingMap.has(p.id)),
          ...existing.filter(p => p && p.id != null && !incomingIds.has(String(p.id))),
        ];
      }
      const reconciled = reconcileDeletions(safeMerged, existing, tombstoneWithoutPin);
      const stamped = stampArray(reconciled, existing);
      await writeJson(s3Key, stamped);
      await publishChange(member.orgCode, "people", { ids: changedIds(reconciled, existing) });
      // Phase 5: silent background-sync push to org members (best-effort).
      await sendSilentPush(member.orgCode, { entity: "people" });
      // #337, same shape as /tasks. There is no conflict check on people today,
      // so a stale stamp here costs nothing yet — which is exactly why it would
      // be missed when one is added. Returned for symmetry, and so the client
      // has one rule ("adopt the stamps the save returns") rather than three.
      const stamps = {};
      for (const p of stamped) if (p && p.id != null && p.lastModifiedAt) stamps[String(p.id)] = p.lastModifiedAt;
      return json(200, { ok: true, stamps });
    } catch (e) {
      console.error("people POST error:", e);
      return err(500, "Failed to save people");
    }
  }

  // PATCH — granular per-person field merge. Use this for single-field
  // updates (push token, role toggle, etc.) so we don't write the whole
  // people array and clobber concurrent server-side mutations like
  // jobClockIn that touch one field of one person.
  if (event.httpMethod === "PATCH") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const body = JSON.parse(event.body);
      const { personId, fields } = body ?? {};
      if (!personId) return err(400, "Missing personId");
      if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        return err(400, "Missing or invalid fields object");
      }

      // Block id/pin from being changed via this endpoint. id is the
      // primary key; pin should only flow through dedicated admin paths.
      const { id: _id, pin: _pin, ...allowedFields } = fields;

      const existing = (await readJson(s3Key)) ?? [];
      const idx = existing.findIndex(p => String(p.id) === String(personId));
      if (idx === -1) return err(404, "Person not found");

      // Non-admins may only patch THEIR OWN row (push token, profile color,
      // etc.). Admins can patch anyone. Without this gate, any authenticated
      // org member could overwrite a colleague's pushToken or department.
      const targetIsSelf = member.personId && String(member.personId) === String(personId);
      if (!can(member, "manageTeam") && !targetIsSelf) {
        return err(403, "Can only modify your own profile");
      }

      // Role changes still require admin even via PATCH.
      if ("userRole" in allowedFields && allowedFields.userRole !== existing[idx].userRole) {
        if (!can(member, "manageTeam")) return err(403, "Your account does not have permission to add, edit & remove team members");
      }

      // Non-admins may only patch SAFE profile fields on their own row — strip
      // any escalation-sensitive fields (PTO/pay/permissions/department/…) so a
      // self-PATCH can't bypass the timeoff.js approval flow or grant permissions.
      if (!can(member, "manageTeam")) {
        for (const k of PROTECTED_PERSON_FIELDS) delete allowedFields[k];
      }

      // #198: the live session fields belong to the timeclock actions, which check
      // what they write. Through PATCH, any caller could set their own
      // activeJobClock/activeClockIn/activeBreak and forge a session. Pinned for
      // every caller, admins included — admin corrections have their own actions.
      // Stripped in enforce; recorded in log (see _utils/rule-mode.js).
      const sessionGuardMode = ruleMode("SCHEDULE_RULES_MODE");
      if (sessionGuardMode !== "off") {
        const guarded = [];
        for (const k of PATCH_PINNED_SESSION_FIELDS) {
          if (!(k in allowedFields)) continue;
          logRule("session-guard", { mode: sessionGuardMode, guard: "peoplePatch", field: k,
            personId: String(personId), by: member.personId != null ? String(member.personId) : null });
          // The bound is "this field is server-owned at all" — there is no numeric limit to
          // breach, so the value is what the client tried to write and that is the whole of
          // the decision (#327). Clipped: activeJobClock carries a sessionSnapshot.
          guarded.push({
            tag: "session-guard", mode: sessionGuardMode, refused: sessionGuardMode === "enforce",
            guard: "peoplePatch", field: k, why: "server-owned field sent by a client",
            value: JSON.stringify(allowedFields[k] ?? null).slice(0, 200), bound: "not writable through PATCH",
            personId: String(personId),
          });
          if (sessionGuardMode === "enforce") delete allowedFields[k];
        }
        if (guarded.length) await recordRuleEvents(orgCodeFromHeader(event), guarded,
          { personId: member.personId != null ? String(member.personId) : null, isAdmin: !!member.isAdmin, email: member.email });
      }

      existing[idx] = withBreakStart({ ...existing[idx], ...allowedFields }, existing[idx]);
      // A PATCH is an explicit modification of this one record, so advance its
      // stamp directly (no diff needed — the caller changed a field on purpose).
      existing[idx].lastModifiedAt = nowIso();
      await writeJson(s3Key, existing);
      await publishChange(member.orgCode, "people", { ids: [String(personId)] });
      await sendSilentPush(member.orgCode, { entity: "people" });

      // Strip PIN before returning, matching the GET behavior; surface hasPin.
      const { pin: _omit, ...safe } = existing[idx];
      return json(200, { ...safe, hasPin: !!existing[idx].pin });
    } catch (e) {
      console.error("people PATCH error:", e);
      return err(500, "Failed to patch person");
    }
  }

  // DELETE — self-service account removal ("Delete Account" on the iOS profile
  // page). Soft-deletes ONLY the caller's own row: the id comes from the
  // verified token via requireOrgMember, never from the request body, so this
  // can't be pointed at a colleague.
  //
  // Tombstoning IS the revocation — requireOrgMember reads people through
  // filterLive, so the next request from this person fails membership (an
  // already-warm instance can serve its cached membership for up to the
  // member-cache TTL, but the app signs itself out immediately).
  //
  // Same tombstone shape as the admin removal path in POST: strip the PIN so it
  // neither lingers at rest nor authenticates a kiosk clock-in, and clear the
  // push token so notifications stop reaching a phone that is no longer part of
  // the org. Timeclock and job-session history is deliberately left alone —
  // that's payroll data and it belongs to the organization.
  if (event.httpMethod === "DELETE") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    if (member.personId == null) return err(404, "Person not found");
    try {
      const existing = (await readJson(s3Key)) ?? [];
      const idx = existing.findIndex(p => String(p.id) === String(member.personId));
      if (idx === -1) return err(404, "Person not found");
      // Idempotent: a retry after the first call already landed must not
      // re-stamp the tombstone and re-broadcast it to every client.
      if (existing[idx].deletedAt) return json(200, { ok: true });

      const { pin: _pin, ...rest } = existing[idx];
      existing[idx] = softDelete({ ...rest, pushToken: null });
      await writeJson(s3Key, existing);
      await publishChange(member.orgCode, "people", { ids: [String(member.personId)] });
      await sendSilentPush(member.orgCode, { entity: "people" });
      return json(200, { ok: true });
    } catch (e) {
      console.error("people DELETE error:", e);
      return err(500, "Failed to delete account");
    }
  }

  return err(405, "Method not allowed");
}
