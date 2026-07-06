// One-time, idempotent, atomic-ish migration from the legacy timeclock.json +
// jobsessions.json files to the split payhours.json + productionhours.json.
//
// Safety model:
//   • union-by-id merge — existing TARGET rows WIN over legacy rows, so a re-run
//     after clients have started writing the new files never clobbers newer data.
//   • additive first: write the new files, then read them back and verify their
//     counts BEFORE touching the originals. If verification fails we throw and
//     leave every original intact.
//   • only after a clean verify do we archive the originals to *.migrated and
//     delete them.
//   • idempotent: if the source is gone and the .migrated marker is present we
//     short-circuit as already-migrated.
//
// Invoked via the admin-gated netlify/functions/migrate-timeclock.js endpoint
// (?confirm=1). Never auto-runs.
//
// NOTE: s3.js had no single-object copy/delete, so `copyObject`/`deleteObject`
// were added there (they wrap CopyObjectCommand/DeleteObjectCommand) and are
// used here for the archive-then-delete step.

import { readJson, writeJson, copyObject, deleteObject } from "./s3.js";

// Merge legacy rows into the existing target array, keyed by id. Target rows
// WIN on id collision. Rows lacking `source` get `defaultSource` — but event
// rows (tce_ lunch/break, identified by `eventType`) keep their shape untouched.
// Id-less rows are carried through as-is (can't be deduped).
function unionById(existing, legacy, defaultSource) {
  const ex = Array.isArray(existing) ? existing : [];
  const lg = Array.isArray(legacy) ? legacy : [];
  const withSource = (r) =>
    (r && typeof r === "object" && r.source == null && !r.eventType)
      ? { ...r, source: defaultSource }
      : r;

  const byId = new Map();
  const idless = [];
  // Legacy first…
  for (const r of lg) {
    if (r && r.id != null) byId.set(String(r.id), withSource(r));
    else if (r != null) idless.push(withSource(r));
  }
  // …then existing overwrites same ids (target wins).
  for (const r of ex) {
    if (r && r.id != null) byId.set(String(r.id), withSource(r));
    else if (r != null) idless.push(withSource(r));
  }
  return [...byId.values(), ...idless];
}

export async function migrateTimeclock(orgCode) {
  const base = `orgs/${orgCode}`;
  const tcKey = `${base}/timeclock.json`;
  const jsKey = `${base}/jobsessions.json`;
  const payKey = `${base}/payhours.json`;
  const prodKey = `${base}/productionhours.json`;
  const tcMigratedKey = `${base}/timeclock.json.migrated`;
  const jsMigratedKey = `${base}/jobsessions.json.migrated`;

  const legacyPay = await readJson(tcKey);
  const legacyProd = await readJson(jsKey);

  // (a) Source gone → either already migrated (marker present) or never existed.
  if (legacyPay == null) {
    const marker = await readJson(tcMigratedKey);
    if (marker != null) {
      // Finish a possibly-interrupted archive: if a prior run deleted
      // timeclock.json but failed before archiving jobsessions.json, complete it
      // now. Its rows were already merged into productionhours.json before any
      // archive step ran, so this only cleans up the orphaned source file.
      const leftoverProd = await readJson(jsKey);
      if (leftoverProd != null) {
        await copyObject(jsKey, jsMigratedKey);
        await deleteObject(jsKey);
      }
      return { status: "already-migrated" };
    }
    return { status: "nothing-to-migrate" };
  }

  const legacyPayArr = Array.isArray(legacyPay) ? legacyPay : [];
  const legacyProdArr = Array.isArray(legacyProd) ? legacyProd : [];

  // (c)+(d) Union-by-id (target wins) and write each new file, re-reading the
  // target IMMEDIATELY before its write and unioning just-in-time. Post-deploy,
  // live clockOut/payClockOut write payhours.json directly; reading the target
  // right before we write it (rather than up front) shrinks the window in which
  // such a concurrent punch could be clobbered to a single read→write gap, and
  // union-by-id keeps those newer target rows (target wins on id collision).
  // Still: run this migration off-hours / with nobody clocked in to be safest.
  const freshPay = await readJson(payKey);
  const mergedPay = unionById(freshPay, legacyPayArr, "kiosk");
  const payCount = mergedPay.length;
  await writeJson(payKey, mergedPay);

  const freshProd = await readJson(prodKey);
  const mergedProd = unionById(freshProd, legacyProdArr, "kiosk");
  const prodCount = mergedProd.length;
  await writeJson(prodKey, mergedProd);

  console.log(
    `[migrate-timeclock] ${orgCode}: legacyPay=${legacyPayArr.length} legacyProd=${legacyProdArr.length} ` +
    `-> mergedPay=${payCount} mergedProd=${prodCount}`
  );

  const verifyPay = await readJson(payKey);
  const verifyProd = await readJson(prodKey);
  if (!Array.isArray(verifyPay) || verifyPay.length < payCount) {
    throw new Error(
      `[migrate-timeclock] ${orgCode}: payhours verify failed ` +
      `(expected >= ${payCount}, got ${Array.isArray(verifyPay) ? verifyPay.length : "non-array"}); originals left intact`
    );
  }
  if (!Array.isArray(verifyProd) || verifyProd.length < prodCount) {
    throw new Error(
      `[migrate-timeclock] ${orgCode}: productionhours verify failed ` +
      `(expected >= ${prodCount}, got ${Array.isArray(verifyProd) ? verifyProd.length : "non-array"}); originals left intact`
    );
  }

  // (e) Verified — archive originals to *.migrated, then delete them.
  await copyObject(tcKey, tcMigratedKey);
  await deleteObject(tcKey);
  if (legacyProd != null) {
    await copyObject(jsKey, jsMigratedKey);
    await deleteObject(jsKey);
  }

  console.log(`[migrate-timeclock] ${orgCode}: migrated payCount=${payCount} prodCount=${prodCount}`);
  return { status: "migrated", payCount, prodCount };
}
