import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey } from "./_utils/org.js";
import { stampArray, nowIso, reconcileDeletions, softDelete, changedIds } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendSilentPush } from "./_utils/push.js";

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
    let isMember = false;
    try { await requireOrgMember(event); isMember = true; } catch { /* unauthenticated kiosk */ }
    try {
      const data = (await readJson(s3Key)) ?? [];
      // Hide soft-deleted (tombstoned) people from normal readers; /sync does
      // NOT filter these so delta-sync clients can evict the deleted row.
      const safe = filterLive(data)
        .map(({ pin: _pin, ...rest }) => {
          if (isMember) return rest;
          const { pushToken: _pt, timeOff: _to, ...pub } = rest;
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
      const incoming = JSON.parse(event.body);
      if (!Array.isArray(incoming)) return err(400, "Invalid people data");
      if (incoming.length === 0) return err(400, "Refusing to overwrite people with empty array");

      // Check for userRole changes — only admins may change them.
      const existing = (await readJson(s3Key)) ?? [];
      const existingMap = new Map(existing.map(p => [p.id, p]));
      const hasRoleChange = incoming.some(p => {
        const old = existingMap.get(p.id);
        // New person being added as admin, or existing person's role changing.
        return old ? old.userRole !== p.userRole : p.userRole === "admin";
      });

      if (hasRoleChange && !member.isAdmin) {
        return err(403, "Only admins can change user roles");
      }

      // Preserve existing PINs for records that don't supply a new one, and
      // anchor a break-start time when a break is active but missing one (e.g.
      // iOS sets activeBreak without persisting startedAt) so admin timers stay
      // accurate. An existing startedAt is always preserved — never reset.
      const merged = incoming.map(p => {
        const stored = existingMap.get(p.id);
        let np = (stored?.pin && !p.pin) ? { ...p, pin: stored.pin } : p;
        np = withBreakStart(np, stored);
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
      const reconciled = reconcileDeletions(merged, existing, tombstoneWithoutPin);
      await writeJson(s3Key, stampArray(reconciled, existing));
      await publishChange(member.orgCode, "people", { ids: changedIds(reconciled, existing) });
      // Phase 5: silent background-sync push to org members (best-effort).
      await sendSilentPush(member.orgCode, { entity: "people" });
      return json(200, { ok: true });
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
      if (!member.isAdmin && !targetIsSelf) {
        return err(403, "Can only modify your own profile");
      }

      // Role changes still require admin even via PATCH.
      if ("userRole" in allowedFields && allowedFields.userRole !== existing[idx].userRole) {
        if (!member.isAdmin) return err(403, "Only admins can change user roles");
      }

      existing[idx] = withBreakStart({ ...existing[idx], ...allowedFields }, existing[idx]);
      // A PATCH is an explicit modification of this one record, so advance its
      // stamp directly (no diff needed — the caller changed a field on purpose).
      existing[idx].lastModifiedAt = nowIso();
      await writeJson(s3Key, existing);
      await publishChange(member.orgCode, "people", { ids: [String(personId)] });
      await sendSilentPush(member.orgCode, { entity: "people" });

      // Strip PIN before returning, matching the GET behavior.
      const { pin: _omit, ...safe } = existing[idx];
      return json(200, safe);
    } catch (e) {
      console.error("people PATCH error:", e);
      return err(500, "Failed to patch person");
    }
  }

  return err(405, "Method not allowed");
}
