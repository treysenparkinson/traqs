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

async function authHeaders() {
  if (!_ctx) throw new Error("sync not configured — call configureSync first");
  const token = await _ctx.getToken();
  return { Authorization: `Bearer ${token}`, "X-Org-Code": _ctx.orgCode };
}

// Raw GET of the delta since a cursor ("0"/undefined → full snapshot).
export async function fetchDelta(since) {
  const q = encodeURIComponent(since || "0");
  const res = await fetch(`${SYNC_URL}?since=${q}`, { headers: await authHeaders() });
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
    const recs = resp[entity];
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
  await db.transaction("rw", db.tasks, db.people, db.clients, db.messages, db.groups, db.timeclock, db.orgConfig, db.settings, async () => {
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
      if (!cursor) return await fullResync();
      const resp = await fetchDelta(cursor);
      return await applyDelta(resp);
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

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
