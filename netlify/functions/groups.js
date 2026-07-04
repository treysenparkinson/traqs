import { requireOrgMember } from "./_utils/auth.js";
import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { orgKey, orgCodeFromHeader } from "./_utils/org.js";
import { stampArray, reconcileDeletions, changedIds } from "./_utils/timestamps.js";
import { filterLive } from "./_utils/entities.js";
import { publishChange } from "./_utils/ably-publish.js";
import { sendSilentPush } from "./_utils/push.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  const s3Key = orgKey(event, "groups.json");
  if (!s3Key) return err(400, "Missing or invalid X-Org-Code header");

  // GET — return groups for the named org (membership required, since
  // group names + member ids implicitly reveal the team structure).
  if (event.httpMethod === "GET") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    try {
      const data = (await readJson(s3Key)) ?? [];
      // Members-only visibility (mirrors the messages/thread ACL): return only
      // the groups the caller belongs to, so group names + rosters of groups
      // they aren't in aren't exposed. No admin override — an admin who isn't in
      // a group doesn't see it here, matching the message ACL.
      // Also hides soft-deleted (tombstoned) records from normal readers; /sync
      // does NOT filter tombstones so delta-sync clients can still evict them.
      const myId = member?.personId != null ? String(member.personId) : null;
      const mine = filterLive(data).filter(g => myId && (g?.memberIds || []).map(String).includes(myId));
      return json(200, mine);
    } catch (e) {
      console.error("groups GET error:", e);
      return err(500, "Failed to read groups");
    }
  }

  // POST — save full groups array (member of the named org required).
  if (event.httpMethod === "POST") {
    let member;
    try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
    let body;
    try { body = JSON.parse(event.body); } catch { return err(400, "Invalid JSON"); }
    if (!Array.isArray(body)) return err(400, "Body must be an array");
    try {
      // Read the current version once. It serves double duty: the empty-overwrite
      // guard's reference below, AND the `previous` that stampArray diffs against
      // so unchanged groups keep their existing lastModifiedAt (only genuinely
      // changed groups get a fresh timestamp, which is what delta-sync relies on).
      const existing = await readJson(s3Key);
      const prev = Array.isArray(existing) ? existing : [];
      const posterId = member?.personId != null ? String(member.personId) : null;
      const isMemberOf = (g) => posterId != null && (g?.memberIds || []).map(String).includes(posterId);

      // Members-only delivery (GET + /sync) means a client's POST array is a
      // PARTIAL view of groups.json — it only ever contains groups the poster
      // belongs to (plus any new one they're creating). A plain
      // reconcileDeletions(body, existing) would treat every group the poster
      // CAN'T see as a client-side deletion and tombstone it, wiping other
      // people's groups. So we scope reconciliation to the poster's OWN groups
      // and carry everything else forward verbatim.
      //
      // preserved:   existing groups the poster isn't a member of (incl. their
      //              tombstones) — never touched by someone else's POST.
      // visiblePrev: existing groups the poster IS a member of — the only ones a
      //              missing-from-body entry may legitimately tombstone.
      // safeBody:    incoming entries that are brand-new OR target a group the
      //              poster belongs to (drops attempts to edit groups they can't
      //              see, e.g. from a stale client).
      const preserved = prev.filter(g => g && !isMemberOf(g));
      const visiblePrev = prev.filter(g => g && isMemberOf(g));
      const prevById = new Map(prev.filter(g => g && g.id != null).map(g => [String(g.id), g]));
      const safeBody = body.filter(g => {
        if (!g || g.id == null) return true;            // new / id-less → allow (create)
        const ex = prevById.get(String(g.id));
        return !ex || isMemberOf(ex);                   // allow new, or groups the poster belongs to
      });

      // Empty-array safeguard, scoped to the POSTER's own groups: a client bug
      // (failed fetch → state reset to [] → autosave) must not tombstone every
      // group the poster belongs to. Only the poster's visible groups are at
      // risk now (non-member groups are preserved above), so guard on those.
      // `?force=1` bypasses it (e.g. deliberately deleting your last group).
      const force = event.queryStringParameters?.force === "1";
      if (body.length === 0 && !force && visiblePrev.some(r => r && !r.deletedAt)) {
        return err(409, "Refusing to overwrite your groups with an empty array");
      }

      const reconciled = [...preserved, ...reconcileDeletions(safeBody, visiblePrev)];
      await writeJson(s3Key, stampArray(reconciled, existing));
      await publishChange(orgCodeFromHeader(event), "groups", { ids: changedIds(reconciled, existing) });
      // Phase 5: silent background-sync push to org members (best-effort).
      await sendSilentPush(orgCodeFromHeader(event), { entity: "groups" });
      return json(200, { ok: true });
    } catch (e) {
      console.error("groups POST error:", e);
      return err(500, "Failed to save groups");
    }
  }

  return err(405, "Method not allowed");
}
