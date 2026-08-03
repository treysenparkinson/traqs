import { db, syncBus, ARRAY_ENTITIES } from "./index.js";

// Delta-sync client: pulls /sync?since=<cursor>, writes changes through to
// IndexedDB, and notifies React (via syncBus) which slices to re-hydrate.
//
// Auth context (Auth0 token getter + orgCode) is configured once after login so
// the Ably "changed" handler can trigger deltaSync() with no arguments.

const SYNC_URL = "/.netlify/functions/sync";
let _ctx = null; // { getToken, orgCode }
let _inFlight = null; // coalesces overlapping deltaSync calls (Ably can burst)

export function configureSync(ctx) { _ctx = ctx; }
export function isConfigured() { return !!_ctx?.orgCode; }

// `fresh` bypasses the Auth0 SDK's token cache (cacheMode:"off"), used only on a
// 401 retry: the cached access token can be expired-but-not-yet-rotated, and
// re-sending it would just 401 again.
async function authHeaders(fresh = false) {
  if (!_ctx) throw new Error("sync not configured — call configureSync first");
  const token = await _ctx.getToken(fresh ? { cacheMode: "off" } : undefined);
  return { Authorization: `Bearer ${token}`, "X-Org-Code": _ctx.orgCode };
}

// Raw GET of the delta since a cursor ("0"/undefined → full snapshot).
//
// A 401 here is almost never a real auth failure: the backend resolves the
// caller's email through Auth0 /userinfo (access tokens carry no email claim),
// which rate-limits under the request bursts this endpoint generates — and the
// token itself can be mid-rotation. Both are transient, and /sync is the ONLY
// delivery path for chat, so failing the whole cycle on the first 401 silently
// stalls messaging until the next lucky poll. Retry once with a forced-fresh
// token before giving up. Safe to retry: /sync is a pure read.
export async function fetchDelta(since) {
  const q = encodeURIComponent(since || "0");
  let res = await fetch(`${SYNC_URL}?since=${q}`, { headers: await authHeaders() });
  if (res.status === 401) {
    await new Promise((r) => setTimeout(r, 1200));   // let the server's email cache warm
    res = await fetch(`${SYNC_URL}?since=${q}`, { headers: await authHeaders(true) });
  }
  if (!res.ok) throw new Error(`sync failed: ${res.status}`);
  return res.json();
}

async function getCursor() {
  const meta = await db.meta.get("sync-cursor");
  return meta?.serverTime || null;
}

// Write one /sync response through to Dexie, then emit change events. Array
// entities: upsert live records, delete tombstoned (deletedAt) ones. Object
// entities: replace when present (null = unchanged). Cursor advances to
// response.serverTime. Returns the list of entities that actually changed.
export async function applyDelta(resp) {
  if (!resp || typeof resp !== "object") return [];
  const changed = [];

  for (const entity of ARRAY_ENTITIES) {
    // `payhours` is the canonical /sync key; fall back to the deprecated
    // `timeclock` alias the server still emits during rollout, for safety.
    const recs = entity === "payhours" && resp.payhours === undefined ? resp.timeclock : resp[entity];
    if (!Array.isArray(recs) || recs.length === 0) continue;
    const toPut = recs.filter((r) => r && !r.deletedAt);
    const toDelete = recs.filter((r) => r && r.deletedAt).map((r) => String(r.id));
    await db.transaction("rw", db[entity], async () => {
      if (toPut.length) await db[entity].bulkPut(toPut);
      if (toDelete.length) await db[entity].bulkDelete(toDelete);
    });
    changed.push(entity);
  }

  if (resp.orgConfig) { await db.orgConfig.put({ key: "current", value: resp.orgConfig }); changed.push("orgConfig"); }
  if (resp.settings)  { await db.settings.put({ key: "current", value: resp.settings });   changed.push("settings"); }

  if (resp.serverTime) {
    const meta = (await db.meta.get("sync-cursor")) || { key: "sync-cursor" };
    await db.meta.put({ ...meta, key: "sync-cursor", serverTime: resp.serverTime });
  }

  for (const entity of changed) syncBus.dispatchEvent(new CustomEvent(`${entity}-changed`));
  if (changed.length) syncBus.dispatchEvent(new CustomEvent("any-changed", { detail: { entities: changed } }));
  return changed;
}

// Full snapshot into empty tables (first ever load, or a forced rebuild).
export async function fullResync() {
  const resp = await fetchDelta("0");
  await db.transaction("rw", [...ARRAY_ENTITIES.map((e) => db[e]), db.orgConfig, db.settings], async () => {
    await Promise.all([...ARRAY_ENTITIES.map((e) => db[e].clear()), db.orgConfig.clear(), db.settings.clear()]);
  });
  const changed = await applyDelta(resp);
  const meta = (await db.meta.get("sync-cursor")) || { key: "sync-cursor" };
  await db.meta.put({ ...meta, key: "sync-cursor", serverTime: resp.serverTime, lastFullSyncAt: new Date().toISOString() });
  return changed;
}

// Incremental sync from the stored cursor; falls back to a full resync if there
// is no cursor yet. Overlapping calls coalesce onto one in-flight request so a
// burst of Ably events doesn't fan out into N redundant /sync round-trips.
export async function deltaSync() {
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const cursor = await getCursor();
      const changed = cursor ? await applyDelta(await fetchDelta(cursor)) : await fullResync();
      _health.consecutiveFailures = 0;
      _health.lastError = null;
      _health.lastSuccessAt = new Date().toISOString();
      syncBus.dispatchEvent(new CustomEvent("sync-health", { detail: getSyncHealth() }));
      return changed;
    } catch (e) {
      _health.consecutiveFailures += 1;
      _health.lastError = e?.message || String(e);
      syncBus.dispatchEvent(new CustomEvent("sync-health", { detail: getSyncHealth() }));
      throw e;
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

// Fold the authoritative /messages GET into the cache.
//
// The GET returns the viewer's ENTIRE thread history (ACL-filtered, tombstones
// already stripped); /sync deltas are time-filtered, so anything older than this
// browser's cursor was never written here. That gap was load-bearing: the
// rehydrate path REPLACES React state with readSlice("messages"), so on a
// browser whose cache was never fully seeded (a fullResync that 401'd, a profile
// whose IndexedDB was cleared, a different origin like localhost vs the deployed
// site) the first live delta swapped a complete 387-message thread for whatever
// few records the cache happened to hold — and nothing ever repaired it, because
// only fullResync writes history and it runs only when the cursor is missing.
//
// Mirrors iOS SyncService.mergeFullMessages. Upsert-only: it never evicts, so a
// partial or transient GET cannot delete cached history (deletions still arrive
// as tombstones through applyDelta). Empty input is a no-op for the same reason.
export async function mergeFullMessages(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  const rows = list.filter((m) => m && m.id != null && !m.deletedAt);
  if (!rows.length) return false;
  await db.messages.bulkPut(rows);
  syncBus.dispatchEvent(new CustomEvent("messages-changed"));
  syncBus.dispatchEvent(new CustomEvent("any-changed", { detail: { entities: ["messages"] } }));
  return true;
}

// Fold an authoritative full GET (/tasks, /people, /clients) into the cache.
//
// Same gap mergeFullMessages closed, and load-bearing for the same reason: the
// rehydrate path (applySlice in TRAQS.jsx) rebuilds React state from
// readSlice(entity) and lets the CACHED version of a record win over the one
// already in memory — and drops any in-memory record the cache doesn't have.
// So a cache holding a stale copy of a job doesn't just fail to update; on the
// next sync event it actively replaces the good server copy, and a job the
// cache never saw disappears from state entirely. That is how a schedule
// assignment made on one machine could vanish on another: the job was still
// there (the stale record still exists) but its ops had no team/dates, so no
// bars rendered on the person's row.
//
// Nothing wrote these GETs back to Dexie, so the cache could only ever be
// repaired by a fullResync — which runs only when the cursor is missing.
// Upsert-only, exactly like mergeFullMessages: a partial or transient GET can
// never evict cached records, and real deletions still arrive as tombstones
// through applyDelta.
export async function mergeFullSlice(entity, list) {
  if (!ARRAY_ENTITIES.includes(entity)) return false;
  if (!Array.isArray(list) || list.length === 0) return false;
  const rows = list.filter((r) => r && r.id != null && !r.deletedAt);
  if (!rows.length) return false;
  await db[entity].bulkPut(rows);
  syncBus.dispatchEvent(new CustomEvent(`${entity}-changed`));
  syncBus.dispatchEvent(new CustomEvent("any-changed", { detail: { entities: [entity] } }));
  return true;
}

// Sync health. Every deltaSync() call site catches and discards errors — correct
// (a failed background sync must not break the app) but it meant a total
// messaging outage produced no signal anywhere. Tracking it here lets the UI
// surface a stalled sync without changing that contract.
const _health = { consecutiveFailures: 0, lastError: null, lastSuccessAt: null };
export function getSyncHealth() { return { ..._health }; }

// Read a whole array slice back out of the cache (for re-hydrating React state).
export async function readSlice(entity) {
  if (ARRAY_ENTITIES.includes(entity)) return db[entity].toArray();
  if (entity === "orgConfig" || entity === "settings") {
    const row = await db[entity].get("current");
    return row?.value ?? null;
  }
  return null;
}

// Has the cache ever been populated? Gates whether cold-hydrate has data to show.
export async function hasCachedData() {
  const [cursor, taskCount] = await Promise.all([getCursor(), db.tasks.count()]);
  return !!cursor || taskCount > 0;
}
