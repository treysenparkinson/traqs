// One-time backfill for legacy production records that predate delta-sync.
//
// Delta-sync filters records by `lastModifiedAt` (only ones with a stamp > the
// client's last-pull time are sent). Existing prod records were written before
// stamping existed, so they have no `lastModifiedAt` at all. Sync's fallback
// treats a missing stamp as "always include", which means those legacy records
// would be re-sent on EVERY pull forever — defeating the point of delta-sync.
//
// The fix: give every un-stamped record ONE fixed OLD timestamp (LEGACY below).
// Because it is older than any real client cursor, the record is still included
// in a client's FIRST full sync (cursor is 0 / epoch, so LEGACY > cursor), but
// once that client has pulled it, LEGACY is <= the cursor and it is never
// re-sent. A single shared old stamp gives us both properties at once.
//
// This is invoked MANUALLY (e.g. from a one-off script or REPL) — it is not
// wired to any HTTP endpoint/handler. Run it once per org after deploying the
// timestamp feature. It only ADDS `lastModifiedAt` where missing; it never
// removes or alters any other field, and never touches already-stamped records.

import { readJson, writeJson } from "./s3.js";

// The single fixed legacy stamp. Deliberately far in the past so it precedes
// every real client sync cursor (see block comment above for why this matters).
const LEGACY = "2020-01-01T00:00:00.000Z";

// Entities stored as an ARRAY of records. Each record gets its own stamp.
const ARRAY_FILES = ["tasks.json", "people.json", "clients.json", "messages.json", "groups.json", "payhours.json", "productionhours.json"];

// Entities stored as a single OBJECT. The object itself gets a root stamp.
const OBJECT_FILES = ["config.json", "settings.json"];

/**
 * Backfill `lastModifiedAt: LEGACY` onto un-stamped records for one org.
 *
 * Returns a summary mapping each filename to what happened:
 *   - array files  -> the count of records that were stamped (0 if none)
 *   - object files -> a boolean (true if the object was stamped)
 * Files that read as null (don't exist) are skipped entirely and omitted from
 * the summary, so we never create a file that wasn't already there.
 */
export async function backfillTimestamps(orgCode) {
  const summary = {};

  // ARRAY entities: stamp only the records missing a stamp, and only write the
  // file back if at least one record actually changed (avoids a pointless PUT
  // that would otherwise rewrite an already-migrated file).
  for (const file of ARRAY_FILES) {
    const key = `orgs/${orgCode}/${file}`;
    const data = await readJson(key);
    if (data == null) continue; // absent file — do not create it
    if (!Array.isArray(data)) continue; // unexpected shape — leave untouched

    let stampedCount = 0;
    const next = data.map((rec) => {
      // Only touch object records that lack a stamp; leave everything else as-is.
      if (rec && typeof rec === "object" && !("lastModifiedAt" in rec)) {
        stampedCount++;
        return { ...rec, lastModifiedAt: LEGACY };
      }
      return rec;
    });

    if (stampedCount > 0) await writeJson(key, next);
    summary[file] = stampedCount;
  }

  // OBJECT entities: add a root stamp only if the object is a non-array object
  // missing one, then write it back.
  for (const file of OBJECT_FILES) {
    const key = `orgs/${orgCode}/${file}`;
    const data = await readJson(key);
    if (data == null) continue; // absent file — do not create it

    if (typeof data === "object" && !Array.isArray(data) && !("lastModifiedAt" in data)) {
      await writeJson(key, { ...data, lastModifiedAt: LEGACY });
      summary[file] = true;
    } else {
      summary[file] = false;
    }
  }

  return summary;
}
