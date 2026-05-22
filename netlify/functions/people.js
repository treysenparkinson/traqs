import { validateToken } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";

function getOrgKey(event, file) {
  const orgCode = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  if (!orgCode || !/^[a-zA-Z0-9]{3,20}$/.test(orgCode)) return null;
  return `orgs/${orgCode}/${file}`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = getOrgKey(event, "people.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  if (event.httpMethod === "GET") {
    try {
      const data = await readJson(s3Key);
      const safe = (data ?? []).map(({ pin: _pin, ...rest }) => rest);
      return json(200, safe);
    } catch (e) {
      console.error("people GET error:", e);
      return err(500, "Failed to read people");
    }
  }

  if (event.httpMethod === "POST") {
    let tokenPayload;
    try {
      tokenPayload = await validateToken(event);
    } catch (e) {
      return err(401, e.message);
    }
    try {
      const incoming = JSON.parse(event.body);
      if (!Array.isArray(incoming)) return err(400, "Invalid people data");
      if (incoming.length === 0) return err(400, "Refusing to overwrite people with empty array");

      // Check for userRole changes — only admins may change them
      const existing = (await readJson(s3Key)) ?? [];
      const existingMap = new Map(existing.map(p => [p.id, p]));
      const hasRoleChange = incoming.some(p => {
        const old = existingMap.get(p.id);
        // New person being added as admin, or existing person's role changing
        return old ? old.userRole !== p.userRole : p.userRole === "admin";
      });

      if (hasRoleChange) {
        // Identify the requester by email claim (Auth0 may include this as a standard or custom claim)
        const requesterEmail = (
          tokenPayload.email ||
          tokenPayload["https://traqs.matrixsystems.com/email"] ||
          ""
        ).toLowerCase();
        if (!requesterEmail) return err(403, "Cannot verify requester identity — role change denied");
        const requesterIsAdmin = existing.some(
          p => p.userRole === "admin" && p.email?.toLowerCase() === requesterEmail
        );
        if (!requesterIsAdmin) return err(403, "Only admins can change user roles");
      }

      // Preserve existing PINs for records that don't supply a new one
      const merged = incoming.map(p => {
        const stored = existingMap.get(p.id);
        if (stored?.pin && !p.pin) return { ...p, pin: stored.pin };
        return p;
      });

      await writeJson(s3Key, merged);
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
    let tokenPayload;
    try {
      tokenPayload = await validateToken(event);
    } catch (e) {
      return err(401, e.message);
    }
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

      // userRole changes still require admin even via PATCH.
      if ("userRole" in allowedFields && allowedFields.userRole !== existing[idx].userRole) {
        const requesterEmail = (
          tokenPayload.email ||
          tokenPayload["https://traqs.matrixsystems.com/email"] ||
          ""
        ).toLowerCase();
        if (!requesterEmail) return err(403, "Cannot verify requester identity — role change denied");
        const requesterIsAdmin = existing.some(
          p => p.userRole === "admin" && p.email?.toLowerCase() === requesterEmail
        );
        if (!requesterIsAdmin) return err(403, "Only admins can change user roles");
      }

      existing[idx] = { ...existing[idx], ...allowedFields };
      await writeJson(s3Key, existing);

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
