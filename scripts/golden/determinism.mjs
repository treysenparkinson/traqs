// Makes a handler run reproducible, so its golden can be compared byte for byte later.
//
// Frozen clock (Date.now() and `new Date()` return the scenario's "now" until it is moved),
// seeded Math.random, and seeded node:crypto randomBytes / randomUUID / getRandomValues. Must be
// imported BEFORE any handler module, because handlers capture these at call time but some
// libraries bind them at import time.

import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const nodeCrypto = require("node:crypto");
const RealDate = Date;

let NOW = RealDate.parse("2026-10-14T15:30:00.000Z");
let seed = 1;

// mulberry32: tiny, seedable, good enough for ids.
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

class FrozenDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(NOW); else super(...args); }
  static now() { return NOW; }
}
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;
globalThis.Date = FrozenDate;

Math.random = rand;

const bytes = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rand() * 256); return b; };
nodeCrypto.randomBytes = (n, cb) => { const b = bytes(n); if (cb) { cb(null, b); return undefined; } return b; };
nodeCrypto.randomUUID = () => {
  const b = bytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const fillRandom = (arr) => { const b = bytes(arr.byteLength); new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(b); return arr; };
// Some of these are getter-only on Node 22; defineProperty replaces them where it can.
const force = (obj, key, value) => {
  if (!obj) return;
  try { Object.defineProperty(obj, key, { value, configurable: true, writable: true }); }
  catch { try { obj[key] = value; } catch { /* left as is: nothing in the handlers uses it */ } }
};
force(nodeCrypto, "getRandomValues", fillRandom);
force(nodeCrypto.webcrypto, "getRandomValues", fillRandom);
force(globalThis.crypto, "getRandomValues", fillRandom);
force(globalThis.crypto, "randomUUID", nodeCrypto.randomUUID);
syncBuiltinESMExports();

export const RealDateCtor = RealDate;
export function resetDeterminism({ now = "2026-10-14T15:30:00.000Z", randomSeed = 1 } = {}) {
  NOW = RealDate.parse(now);
  seed = randomSeed;
}
export function setNow(iso) { NOW = RealDate.parse(iso); }
export function advance(ms) { NOW += ms; }
