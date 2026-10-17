// Runs golden scenarios against the REAL handlers and a chosen store.
//
// A scenario file (scripts/golden/scenarios/<area>.mjs) default-exports a list:
//   { name, now?, seed?: () => storeContents, auth?: AUTH.x | null, authFail?, env?: {...},
//     steps: [{ fn: "people", method: "GET", query?, headers?, body?, auth?, now? }] }
// Each scenario starts from a fresh store holding `seed()` (default: the fixture org), a frozen
// clock and seeded randomness, and records per step: status, headers, parsed body, side effects;
// then the store's end state as a diff against the seed (`writes` / `deleted`).
//
// This module must be the first import of the process (determinism + loader).

import { resetDeterminism, setNow } from "./determinism.mjs";
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
const { orgSeed, ORG } = await import("./fixture-org.mjs");

const FN_DIR = new URL("../../netlify/functions/", import.meta.url);
const handlers = new Map();
async function handlerFor(fn) {
  if (!handlers.has(fn)) handlers.set(fn, (await import(new URL(`${fn}.js`, FN_DIR).href)).handler);
  return handlers.get(fn);
}

export const BASE_ENV = {
  PIN_PEPPER: "golden-pepper-not-a-secret", ALLOWED_ORIGIN: "https://traqs.test",
  SCHEDULE_RULES_MODE: "log", TASK_CONFLICT_MODE: "log", OVERLAP_RULE_MODE: "log", TIER_RULES_MODE: "log",
  IDENTITY_PROVIDER_MODE: "log", TZ_FALLBACK_MODE: "log", SIGNUPS_ENABLED: "true",
};
const ENV_KEYS = [...new Set([...Object.keys(BASE_ENV), "NETLIFY_DEV", "DEV_S3_BUCKET"])];

const parseBody = (res) => {
  if (res?.isBase64Encoded) return { __base64: res.body };
  if (typeof res?.body !== "string" || res.body === "") return res?.body ?? null;
  try { return JSON.parse(res.body); } catch { return { __text: res.body }; }
};

// Stable deep compare: object key order ignored, array order kept, -0 = 0, undefined dropped.
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().filter((key) => x[key] !== undefined).map((key) => [key, x[key]])) : x));

export function storeDiff(before, after) {
  const writes = {}, deleted = [];
  for (const key of Object.keys(after)) if (canon(after[key]) !== canon(before[key])) writes[key] = after[key];
  for (const key of Object.keys(before)) if (!(key in after)) deleted.push(key);
  return { writes, deleted: deleted.sort() };
}

export async function runScenario(sc, { makeStore }) {
  resetDeterminism({ now: sc.now || "2026-10-14T15:30:00.000Z", randomSeed: sc.randomSeed ?? 1 });
  // Every key the scenario sets is restored afterwards too, not just the base ones: a key one
  // scenario sets (ABLY_ROOT_KEY) must not leak into the next.
  const touched = [...new Set([...ENV_KEYS, ...Object.keys(sc.env || {})])];
  const saved = Object.fromEntries(touched.map((key) => [key, process.env[key]]));
  for (const key of touched) delete process.env[key];
  Object.assign(process.env, BASE_ENV, sc.env || {});
  const seed = (sc.seed || orgSeed)();
  const store = await makeStore(seed);
  globalThis.__STORE = store;
  globalThis.__AUTH = sc.auth === undefined ? null : sc.auth;
  globalThis.__AUTH_FAIL = sc.authFail || null;
  const steps = [];
  try {
    for (const st of sc.steps) {
      if (st.now) setNow(st.now);
      if (st.auth !== undefined) globalThis.__AUTH = st.auth;
      if (st.authFail !== undefined) globalThis.__AUTH_FAIL = st.authFail;
      globalThis.__EFFECTS = [];
      const handler = await handlerFor(st.fn);
      const headers = { "x-org-code": st.org ?? ORG, ...(globalThis.__AUTH ? { authorization: "Bearer golden" } : {}), ...(st.headers || {}) };
      for (const [hk, hv] of Object.entries(headers)) if (hv === null) delete headers[hk];
      const event = {
        httpMethod: st.method || "GET", path: `/.netlify/functions/${st.fn}`, headers,
        queryStringParameters: st.query || {}, isBase64Encoded: false,
        body: st.body === undefined ? null : typeof st.body === "string" ? st.body : JSON.stringify(st.body),
      };
      let res;
      try { res = await handler(event, {}); }
      catch (e) { res = { thrown: `${e?.name || "Error"}: ${e?.message}` }; }
      steps.push({
        status: res?.statusCode ?? null, thrown: res?.thrown,
        headers: res?.headers ? Object.fromEntries(Object.entries(res.headers).filter(([h]) => !/^access-control-/i.test(h))) : null,
        body: parseBody(res), effects: globalThis.__EFFECTS,
      });
    }
    const after = await store.dump();
    return { name: sc.name, steps, store: storeDiff(seed, after) };
  } finally {
    for (const [key, v] of Object.entries(saved)) { if (v === undefined) delete process.env[key]; else process.env[key] = v; }
    await store.close?.();
  }
}
