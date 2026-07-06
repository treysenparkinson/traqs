import { requireOrgMember } from "./_utils/auth.js";
import { readJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { nowIso } from "./_utils/timestamps.js";
import { canViewThread } from "./messages.js";

// Delta-sync endpoint — the foundation for IndexedDB / SwiftData caching and
// live updates. Clients pass `?since=<ISO>` (the `serverTime` from their last
// pull) and get back only records whose `lastModifiedAt` is newer, INCLUDING
// tombstones (records with `deletedAt`) so clients can evict deleted rows from
// their local cache. The `serverTime` in the response is the cursor for the
// next call. A missing/epoch `since` returns everything — a cold client's first
// load. GET only, org-membership required (same PII gate as every entity read).
//
// Access control is NOT uniform across entities, and sync must mirror the
// per-entity read rules or it becomes a data-leak:
//   • messages  — scoped per viewer to threads they participate in (canViewThread)
//   • payhours / productionhours — payroll PII; non-admins see only their own entries
//   • people    — the `pin` is stripped for everyone (as in the people GET)

// "Give me everything": no cursor, or the Unix epoch sentinel.
function isFullSync(since) {
  if (!since || since === "0") return true;
  return since.startsWith("1970-01-01");
}

// A record is in the delta if it changed after `since`. Records missing
// `lastModifiedAt` (legacy data not yet backfilled) are always included so we
// never silently withhold data; run backfill-timestamps to give them a stamp.
function changedSince(rec, sinceMs) {
  if (!rec || rec.lastModifiedAt == null) return true;
  return new Date(rec.lastModifiedAt).getTime() > sinceMs;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();
  if (event.httpMethod !== "GET") return err(405, "Method not allowed");

  let member;
  try { member = await requireOrgMember(event); } catch (e) { return err(e.statusCode || 401, e.message); }
  const { orgCode } = member;

  const since = event.queryStringParameters?.since || "";
  const full = isFullSync(since);
  const sinceMs = full ? 0 : new Date(since).getTime();
  if (!full && Number.isNaN(sinceMs)) return err(400, "Invalid `since` timestamp (expected ISO-8601)");

  try {
    // Capture the cursor BEFORE reading, not after. If we stamped serverTime
    // after the reads/filtering, a write that lands during the read window is
    // read as its old version here, yet the returned cursor would advance past
    // it — the client stores that cursor and the change is dropped from every
    // future delta. Capturing before the reads (with the strict `>` in
    // changedSince) is conservative: such a record simply reappears in the next
    // pull. Re-sending is harmless (idempotent client upsert); dropping is not.
    const serverTime = nowIso();
    const base = `orgs/${orgCode}`;
    // timeclock.json is retired by the payhours/productionhours split — read
    // payhours.json in its place (it feeds the deprecated `timeclock` alias key
    // below during the client rollout) plus productionhours.json.
    const [tasks, people, clients, messages, groups, payhours, productionhours, orgConfig, settings] = await Promise.all([
      readJson(`${base}/tasks.json`).then(v => v ?? []),
      readJson(`${base}/people.json`).then(v => v ?? []),
      readJson(`${base}/clients.json`).then(v => v ?? []),
      readJson(`${base}/messages.json`).then(v => v ?? []),
      readJson(`${base}/groups.json`).then(v => v ?? []),
      readJson(`${base}/payhours.json`).then(v => v ?? []),
      readJson(`${base}/productionhours.json`).then(v => v ?? []),
      readJson(`${base}/config.json`).then(v => v ?? null),
      readJson(`${base}/settings.json`).then(v => v ?? null),
    ]);

    const asArr = (v) => (Array.isArray(v) ? v : []);
    const arrDelta = (arr) => asArr(arr).filter(r => full || changedSince(r, sinceMs));
    // Objects: include only when changed (null = "no update since your cursor").
    const objDelta = (obj) => (obj && (full || changedSince(obj, sinceMs))) ? obj : null;

    const isAdmin = member.isAdmin;
    const myId = member.personId != null ? String(member.personId) : null;

    // People: drop the PIN (as the people GET does); sync is always a member.
    const peopleDelta = arrDelta(people).map(({ pin: _pin, ...rest }) => rest);

    // Payhours + productionhours: both are payroll PII, so non-admins are
    // confined to their own entries, exactly like the old timeclock GET. An
    // admin sees the whole org's log.
    const payhoursDelta = asArr(payhours)
      .filter(e => isAdmin || (myId && String(e.personId) === myId))
      .filter(r => full || changedSince(r, sinceMs));
    const productionhoursDelta = asArr(productionhours)
      .filter(e => isAdmin || (myId && String(e.personId) === myId))
      .filter(r => full || changedSince(r, sinceMs));

    // Messages: enforce the same per-viewer thread ACL as the messages GET
    // (reusing canViewThread) so a member never receives conversations they
    // aren't part of. Tombstones that survive the ACL propagate the deletion.
    const decision = new Map();
    const messagesDelta = asArr(messages).filter(m => {
      if (!(full || changedSince(m, sinceMs))) return false;
      if (!myId) return false;
      if (!decision.has(m.threadKey)) {
        decision.set(m.threadKey, canViewThread(m.threadKey, myId, tasks, groups));
      }
      return decision.get(m.threadKey);
    });

    // Groups: same members-only ACL as the thread list — a viewer only receives
    // the groups they belong to (memberIds), so group names/rosters of groups
    // they aren't in never reach the client (previously ALL groups were sent).
    // No admin override, matching the message ACL. Tombstones retain memberIds,
    // so a deleted group the viewer was in still propagates for cache eviction.
    const groupsDelta = arrDelta(groups)
      .filter(g => myId && (g?.memberIds || []).map(String).includes(myId));

    return json(200, {
      serverTime,
      tasks: arrDelta(tasks),
      people: peopleDelta,
      clients: arrDelta(clients),
      messages: messagesDelta,
      groups: groupsDelta,
      payhours: payhoursDelta,
      productionhours: productionhoursDelta,
      // DEPRECATED alias for un-migrated clients still reading the `timeclock`
      // key — equals payhoursDelta. Remove after all clients have migrated.
      timeclock: payhoursDelta,
      orgConfig: objDelta(orgConfig),
      settings: objDelta(settings),
    });
  } catch (e) {
    console.error("sync GET error:", e);
    return err(500, "Failed to sync");
  }
}
