// ESM resolve hook: redirect timeclock.js's (and tasks.js's) _utils/* imports to in-memory stubs
// so the REAL handler runs against a fake S3 and fake auth.
// In-memory S3 with S3's conditional-write semantics: every stored key has an
// ETag that changes on each write, writeJsonIfMatch fails with PreconditionFailed
// when the ETag moved since the read (or, for etag null, when the key now
// exists). globalThis.__BEFORE_WRITE(key), when set, runs before each
// conditional write's check, so a test can land a competing write inside another
// handler's read-modify-write window.
const S3_STUB = `
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const tags = () => (globalThis.__ETAGS ??= {});
  const bump = (key) => { tags()[key] = String(Number(tags()[key] ?? 0) + 1); };
  const tagOf = (key) => (globalThis.__S3[key] === undefined ? null : String(tags()[key] ?? 0));
  export const readJson  = async (key) => (globalThis.__S3[key] === undefined ? null : clone(globalThis.__S3[key]));
  export const writeJson = async (key, v) => { globalThis.__S3[key] = clone(v); bump(key); globalThis.__WRITES.push(key); };
  export const readJsonVersioned = async (key) => ({ data: globalThis.__S3[key] === undefined ? null : clone(globalThis.__S3[key]), etag: tagOf(key) });
  export class PreconditionFailed extends Error {
    constructor(key) { super("Precondition failed: " + key); this.name = "PreconditionFailed"; this.preconditionFailed = true; }
  }
  export const writeJsonIfMatch = async (key, v, etag) => {
    const hook = globalThis.__BEFORE_WRITE; if (hook) await hook(key);
    if (tagOf(key) !== (etag ?? null)) { (globalThis.__PRECONDITION_FAILURES ??= []).push(key); throw new PreconditionFailed(key); }
    globalThis.__S3[key] = clone(v); bump(key); globalThis.__WRITES.push(key);
  };
`;

export const STUBS = {
  "./_utils/s3.js": S3_STUB,
  // _utils/update-json.js imports the same module by its sibling path.
  "./s3.js": S3_STUB,
  "./_utils/auth.js": `
    // __AUTH_FAIL = { status, message } makes auth fail the way the real one does
    // (expired token 401, rate-limited identity provider 503).
    export const requireOrgMember = async () => {
      const f = globalThis.__AUTH_FAIL;
      if (f) throw new AuthError(f.status, f.message || "auth failed");
      return { ...globalThis.__AUTH };
    };
    // messages.js resolves the caller itself: token -> email -> people.json row.
    export const validateToken = async () => ({});
    export const emailForToken = async () => ({ email: globalThis.__AUTH?.email ?? null, transient: false });
    export class AuthError extends Error { constructor(statusCode, message) { super(message); this.statusCode = statusCode; } }
  `,
  "./_utils/cors.js": `
    export const preflight = () => ({ statusCode: 204 });
    export const json = (statusCode, body) => ({ statusCode, body });
    export const err  = (statusCode, message) => ({ statusCode, body: { error: message } });
  `,
  "./_utils/org.js": `
    export const orgCodeFromHeader = () => "TESTORG";
    export const orgKey = (event, file) => "orgs/TESTORG/" + file;
  `,
  // Identity stamping: the test asserts on hours/dates/counters, not on stamps.
  "./_utils/timestamps.js": `
    export const nowIso = () => new Date().toISOString();
    export const stampArray = (next) => next;
    export const stampObject = (next) => next;
    export const softDelete = (r) => ({ ...r, deletedAt: nowIso() });
    export const reconcileDeletions = (next) => next;
    export const changedIds = () => [];
    // #339. Faithful, unlike the inert stubs above, and deliberately so: tasks.js
    // now runs the empty-org guard on what the write WOULD store, so a stub that
    // returned only the upsert would make the guard fire on every partial write
    // in these tests. Short enough to read beside the real one in
    // _utils/timestamps.js, which delta-write-test.mjs covers properly.
    export const applyExplicitWrite = (upsert, deleteIds, previous) => {
      const prev = Array.isArray(previous) ? previous : [];
      const ups = Array.isArray(upsert) ? upsert : [];
      const del = new Set((Array.isArray(deleteIds) ? deleteIds : []).filter(x => x != null).map(String));
      const byId = new Map(ups.filter(r => r && r.id != null).map(r => [String(r.id), r]));
      const out = [], seen = new Set();
      for (const r of prev) {
        if (!r || r.id == null) { out.push(r); continue; }
        const id = String(r.id); seen.add(id);
        if (del.has(id)) { out.push(r.deletedAt ? r : softDelete(r)); continue; }
        const inc = byId.get(id);
        out.push(inc && !(r.deletedAt && !inc.deletedAt) ? inc : r);
      }
      for (const r of ups) {
        if (!r || r.id == null) { out.push(r); continue; }
        const id = String(r.id);
        if (seen.has(id) || del.has(id)) continue;
        out.push(r);
      }
      return out;
    };
  `,
  "./_utils/entities.js": `
    export const isLive = (r) => !r?.deletedAt;
    export const filterLive = (a) => (Array.isArray(a) ? a.filter(isLive) : a);
  `,
  "./_utils/ably-publish.js": `export const publishChange = async () => {};`,
  "./_utils/push.js": `
    export const sendSilentPush = async () => {};
    export const sendVisiblePush = async () => {};
  `,
  "./_utils/pin.js": `
    export const verifyPin = async () => true;
    export const encryptPin = (p) => p;
    export const decryptPin = (p) => p;
  `,
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return {
      url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]),
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
