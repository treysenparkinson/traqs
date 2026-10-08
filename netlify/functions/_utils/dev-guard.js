// LOCAL DEVELOPMENT DOES NOT TOUCH PRODUCTION (#454).
//
// `netlify dev` runs these functions with the live S3 credentials, Ably root
// key, OneSignal/VAPID keys and mail settings -- from the local .env and from
// the linked site's own environment, which the CLI merges in. So a
// work-in-progress build on a laptop wrote Matrix's real data: one autosave on
// 2026-10-03 deleted 287 records (#453). The same path pushes a notification to
// a real phone whenever a local edit changes an assignment, and broadcasts over
// Ably to every production client.
//
// `netlify dev` always injects NETLIFY_DEV=true into function processes
// (netlify-cli, commands/dev/dev.js). With it set:
//   - every S3 write REFUSES, loudly (refuseWriteInLocalDev). Reads are allowed,
//     so the local app still loads.
//   - Ably, push and mail are no-ops (localDevSkip).
//
// A tripwire, not the fix. The fix is a separate dev bucket with its own scoped
// login and a seeded org (#454, option 2); when that exists, writes to IT can be
// allowed here. Read at call time, never cached, so nothing can import its way
// past it.

export const isLocalDev = () => process.env.NETLIFY_DEV === "true";

export class LocalDevWriteRefused extends Error {
  constructor(what) {
    super(`Local development cannot write to the production bucket (${what}). See SCHEDULE_MAP #454.`);
    this.name = "LocalDevWriteRefused";
    this.statusCode = 503;
    this.localDevRefused = true;
  }
}

// Recorded so the suite can tell "skipped by the tripwire" from "not configured".
const record = (kind) => { (globalThis.__DEV_GUARD_SKIPS ??= []).push(kind); };

/** Throws before an S3 write when running under `netlify dev`. */
export function refuseWriteInLocalDev(what) {
  if (!isLocalDev()) return;
  record("s3");
  console.warn(`[dev-guard] local dev: refused S3 write (${what}) — #454`);
  throw new LocalDevWriteRefused(what);
}

/** True (and logged) when a side effect that reaches real people must be skipped. */
export function localDevSkip(kind) {
  if (!isLocalDev()) return false;
  record(kind);
  console.warn(`[dev-guard] local dev: ${kind} skipped — #454`);
  return true;
}
