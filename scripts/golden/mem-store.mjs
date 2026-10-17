// The whole `_utils/s3.js` contract, in memory, with S3's semantics.
//
// This is the "today" store the goldens are recorded against: a key holds a JSON value or a
// binary, every write moves the key's ETag, a conditional write fails with PreconditionFailed
// when the ETag moved (null = "must not exist"), reads return deep copies. Same behaviour as the
// stub in scripts/timeclock-itest-loader.mjs, plus the parts that stub never needed: listing,
// binaries, copy/delete. dump() is test-only: every key and its value, for the golden.

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export class PreconditionFailed extends Error {
  constructor(key) { super("Precondition failed: " + key); this.name = "PreconditionFailed"; this.preconditionFailed = true; }
}

export function createMemStore(initial = {}) {
  const data = new Map();          // key -> { kind: "json", value } | { kind: "binary", body: Buffer, contentType }
  const etags = new Map();
  let n = 0;
  const bump = (k) => etags.set(k, String(++n));
  for (const [k, v] of Object.entries(initial)) {
    if (v && v.__binary) data.set(k, { kind: "binary", body: Buffer.from(v.__binary, "base64"), contentType: v.contentType || "application/octet-stream" });
    else data.set(k, { kind: "json", value: clone(v) });
    bump(k);
  }
  const tagOf = (k) => (data.has(k) ? etags.get(k) : null);
  const store = {
    name: "mem",
    async readJson(key) { const e = data.get(key); return e && e.kind === "json" ? clone(e.value) : null; },
    async writeJson(key, value) { data.set(key, { kind: "json", value: clone(value) }); bump(key); },
    async readJsonVersioned(key) { const e = data.get(key); return { data: e && e.kind === "json" ? clone(e.value) : null, etag: tagOf(key) }; },
    async writeJsonIfMatch(key, value, etag) {
      if (tagOf(key) !== (etag ?? null)) throw new PreconditionFailed(key);
      data.set(key, { kind: "json", value: clone(value) }); bump(key);
    },
    async listOrgCodes() {
      const codes = new Set();
      for (const k of data.keys()) { const m = /^orgs\/([^/]+)\//.exec(k); if (m) codes.add(m[1]); }
      return [...codes].sort();
    },
    async writeBinary(key, body, contentType) { data.set(key, { kind: "binary", body: Buffer.from(body), contentType }); bump(key); },
    // As _utils/s3.js: { data, contentType }, and a missing key THROWS NoSuchKey (GetObject does).
    async readBinaryWithMeta(key) {
      const e = data.get(key);
      if (!e || e.kind !== "binary") { const err = new Error("The specified key does not exist."); err.name = "NoSuchKey"; err.$metadata = { httpStatusCode: 404 }; throw err; }
      return { data: Buffer.from(e.body), contentType: e.contentType };
    },
    async copyPrefix(src, dst) {
      for (const k of [...data.keys()]) if (k.startsWith(src)) { data.set(dst + k.slice(src.length), JSON.parse(JSON.stringify({ ...data.get(k), body: undefined })) && { ...data.get(k) }); bump(dst + k.slice(src.length)); data.delete(k); }
    },
    async copyObject(src, dst) { if (data.has(src)) { data.set(dst, { ...data.get(src) }); bump(dst); } },
    async deleteObject(key) { data.delete(key); etags.delete(key); },
    PreconditionFailed,
    // Test-only.
    async dump() {
      const out = {};
      for (const k of [...data.keys()].sort()) {
        const e = data.get(k);
        out[k] = e.kind === "json" ? clone(e.value) : { __binary: e.body.toString("base64"), contentType: e.contentType };
      }
      return out;
    },
  };
  return store;
}
