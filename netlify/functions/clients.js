import { requireOrgMember } from "./_utils/auth.js";
import { can, requirePerm } from "./_utils/can.js";
import { logRule } from "./_utils/rule-mode.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { stampArray, reconcileDeletions, changedIds } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendSilentPush } from "./_utils/push.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "clients.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  if (event.httpMethod === "GET") {
    try { await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = await readJson(s3Key);
      // Hide soft-deleted (tombstoned) records from normal readers; /sync does
      // NOT filter these so delta-sync clients can evict the deleted row.
      return json(200, filterLive(data ?? []));
    } catch (e) {
      console.error("clients GET error:", e);
      return err(500, "Failed to read clients");
    }
  }

  if (event.httpMethod === "POST") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    // Was membership-only: any worker could rewrite the client list. The Clients
    // page hides its buttons behind can("manageClients"), and now so does the API.
    // Checked below, once the body is known: an UNCHANGED list is not an edit.
    const mayManage = can(member, "manageClients");
    try {
      let clients;
      try { clients = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }
      if (!Array.isArray(clients)) return err(400, "Body must be an array");

      // Read the current version once. It serves double duty: the empty-overwrite
      // guard's reference below, AND the `previous` that stampArray diffs against
      // so unchanged clients keep their existing lastModifiedAt (only genuinely
      // changed clients get a fresh timestamp, which is what delta-sync relies on).
      const existing = await readJson(s3Key);

      // Refuse to overwrite a non-empty clients.json with an empty array.
      // See tasks.js for the incident this guards against.
      // Empty-array safeguard on the RAW incoming array (before reconciliation),
      // counting only NON-tombstoned records so leftover tombstones don't make a
      // legitimately-empty list get refused.
      const force = event.queryStringParameters?.force === "1";
      if (clients.length === 0 && !force) {
        if (Array.isArray(existing) && existing.some(r => r && !r.deletedAt)) {
          return err(409, "Refusing to overwrite non-empty clients with empty array");
        }
      }

      // Tombstone client-side deletions (ids in `existing` missing from incoming)
      // so delta-sync propagates them instead of the record silently vanishing.
      const reconciled = reconcileDeletions(clients, existing);

      // Without manageClients, only a no-op is allowed — the same rule /tasks has.
      // Every autosave sent the whole list, so refusing it outright 403'd every
      // save by a worker or restricted admin.
      //
      // UNCONDITIONAL SINCE 2026-10-08. This sat behind PERMISSION_GATES_MODE,
      // which ran on `enforce` in production for several days of real use with no
      // 403s reported; the flag is now deleted and this is the only behaviour.
      // The condition that remains is `!isNoop`, NOT nothing: `requirePerm` still
      // runs whenever the list actually changed. Removing the condition outright
      // would 403 every worker's client autosave — a path an open browser takes
      // several times a minute — which is the regression the flag existed to
      // avoid in the first place.
      if (!mayManage) {
        const isNoop = changedIds(reconciled, existing).length === 0;
        // Console only, deliberately NOT written to rule-events.json (#327).
        //
        // Every field of this record is fixed: the gate, the permission, the action and the
        // reason are the same on every occurrence, and the decision is the same too — a
        // no-op save from a caller without manageClients. It carries no information that
        // changes with the outcome, which is the test for whether a record is worth keeping.
        // All it could tell you is a count, and buying that count costs an S3 read-modify-
        // write on a path every worker's client-list autosave takes, several times a minute
        // with a browser left open. The tasks.js permission-gate record is the one that
        // decided PERMISSION_GATES_MODE, and it was written only when the two
        // classifiers actually disagreed. Both are retired; this one carries no
        // `mode` any more because there is no longer a mode to carry.
        if (isNoop) logRule("permission-gate", { gate: "clientsNoop", personId: member.personId != null ? String(member.personId) : null });
        if (!isNoop) {
          try { requirePerm(member, "manageClients"); } catch (e) { return err(e.statusCode, e.message); }
        }
        return json(200, { ok: true });
      }
      const stamped = stampArray(reconciled, existing);
      await writeJson(s3Key, stamped);
      await publishChange(orgCodeFromHeader(event), "clients", { ids: changedIds(reconciled, existing) });
      // Phase 5: silent background-sync push to org members (best-effort).
      await sendSilentPush(orgCodeFromHeader(event), { entity: "clients" });
      // #337, same shape as /tasks and /people. Returned for symmetry so the
      // client has one rule rather than three. Note the early `{ ok: true }`
      // above is the NO-OP path — nothing was written, so there is no new stamp
      // to report and the client keeps what it has.
      const stamps = {};
      for (const c of stamped) if (c && c.id != null && c.lastModifiedAt) stamps[String(c.id)] = c.lastModifiedAt;
      return json(200, { ok: true, stamps });
    } catch (e) {
      console.error("clients POST error:", e);
      return err(500, "Failed to save clients");
    }
  }

  return err(405, "Method not allowed");
}
