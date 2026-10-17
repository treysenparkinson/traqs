// Which store `_utils/s3.js` talks to (Postgres migration plan, C4).
//
//   STORAGE_BACKEND=postgres   JSON keys go to Postgres at TRAQS_DATABASE_URL
//   (unset / s3)               S3, exactly as before — the default, so nothing changes by accident
//
// Attachment binaries stay in S3 in production (plan: "Binaries stay in S3"); under local dev,
// where S3 writes are refused anyway (#454), they go to the local database too, so uploads work
// while click-testing. STORAGE_BINARIES=s3|postgres overrides.
//
// The actor (who is making this request) is recorded by auth.js into the request's own context
// (request-context.js) and lands in change_log through the store's SET LOCAL.

import pg from "pg";
import { createPgStore } from "./pg.js";
import { requestContext } from "../request-context.js";

let store = null;

export const usePostgres = () => process.env.STORAGE_BACKEND === "postgres";
export const binariesOnPostgres = () => usePostgres() && (process.env.STORAGE_BINARIES
  ? process.env.STORAGE_BINARIES === "postgres"
  : process.env.NETLIFY_DEV === "true");

/**
 * Called by auth.js when the caller is resolved. Writes into THIS request's context
 * (request-context.js withRequest); outside one it does nothing, so an actor can never be
 * attributed to the wrong request.
 */
export function setActor(actor) {
  const ctx = requestContext.getStore();
  if (ctx) ctx.actor = { ...(ctx.actor || {}), ...actor };
}
const currentActor = () => requestContext.getStore()?.actor || null;

function assertSafeUrl(url) {
  // Local dev must never point at a shared database by accident: the S3 dev guard's rule (#454),
  // applied to Postgres.
  if (process.env.NETLIFY_DEV === "true") {
    let host;
    try { host = new URL(url).hostname; } catch { throw new Error("TRAQS_DATABASE_URL is not a valid URL"); }
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      const e = new Error(`Local development refuses a non-local database (${host}); see SCHEDULE_MAP #454`);
      e.name = "LocalDevWriteRefused"; e.statusCode = 503;
      throw e;
    }
  }
}

export function pgStore() {
  if (store) return store;
  const url = process.env.TRAQS_DATABASE_URL;
  if (!url) throw new Error("STORAGE_BACKEND=postgres needs TRAQS_DATABASE_URL");
  assertSafeUrl(url);
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.TRAQS_DB_POOL_MAX) || 5 });
  // An idle pooled connection dropped by the server (restart, failover, admin kill) emits
  // 'error' on the pool; unhandled, Node treats it as fatal and the whole function dies. The
  // next query simply gets a fresh connection, so log and carry on.
  pool.on("error", (e) => console.error(`[store] idle database connection lost: ${e.message}`));
  store = createPgStore({ pool, actor: currentActor });
  store.__pool = pool;
  return store;
}

/** Test seam: swap the store (golden harness, contract tests). */
export function __setPgStoreForTests(s) { store = s; }
export async function __closePgStoreForTests() { const p = store?.__pool; store = null; if (p) await p.end(); }
