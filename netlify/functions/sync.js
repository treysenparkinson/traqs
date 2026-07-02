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
//   • timeclock — payroll PII; non-admins see only their own entries
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
    const [tasks, people, clients, messages, groups, timeclock, orgConfig, settings] = await Promise.all([
      readJson(`${base}/tasks.json`).then(v => v ?? []),
      readJson(`${base}/people.json`).then(v => v ?? []),
      readJson(`${base}/clients.json`).then(v => v ?? []),
      readJson(`${base}/messages.json`).then(v => v ?? []),
      readJson(`${base}/groups.json`).then(v => v ?? []),
      readJson(`${base}/timeclock.json`).then(v => v ?? []),
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

    // Timeclock: non-admins are confined to their own payroll entries, exactly
    // like the timeclock GET. An admin sees the whole org's log.
    const timeclockDelta = asArr(timeclock)
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

    return json(200, {
      serverTime,
      tasks: arrDelta(tasks),
      people: peopleDelta,
      clients: arrDelta(clients),
      messages: messagesDelta,
      groups: arrDelta(groups),
      timeclock: timeclockDelta,
      orgConfig: objDelta(orgConfig),
      settings: objDelta(settings),
    });
  } catch (e) {
    console.error("sync GET error:", e);
    return err(500, "Failed to sync");
  }
}
