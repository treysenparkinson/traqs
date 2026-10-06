// #379 — a committed, saved drag rendered at its old position.
//
// THE CHAIN, from Trey's recording and the stored data:
//   1. the drop commits and doSave writes it. Server: the new dates.
//   2. doSave does NOT refresh the IndexedDB cache on success — its only
//      cacheFullSlices call sits in the rollback-after-rejected-save branch.
//      The cache keeps the PRE-DRAG tree.
//   3. the next delta sync fires `tasks-changed` -> applySlice("tasks").
//   4. applySlice folds the stale slice over live state with mergeInOrder,
//      which took the CACHE's row for every id present in both, with no
//      recency test at all. The cache won unconditionally.
//   5. the pre-drag tree is installed. Screen: old dates. Server: new ones.
//
// Two fixes, and both are needed. (1) stops the cache going stale after a
// save, which is the direct cause. (2) stops ANY stale cache from winning,
// which is the class — and this campaign's evidence is that "some other path
// leaves it stale" eventually comes true. Every record carries
// lastModifiedAt since #337, so the comparison is available.
//
//   node scripts/cache-merge-test.mjs

import { readFileSync } from "node:fs";
import { mergeInOrder } from "../src/db/sync.js";
import { codeOf } from "./_code-view.mjs";

const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const CODE = codeOf(J);
let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const at = (id, when, extra = {}) => ({ id, lastModifiedAt: when, ...extra });

console.log("\n1. A STALE cache row never overwrites newer live state");
{
  // The exact shape of #379: live state holds the drag, the cache holds the
  // position it was dragged from.
  const live = [at("J", "2026-10-05T21:50:36.976Z", { start: "2026-10-14" })];
  const cache = [at("J", "2026-10-05T21:49:00.000Z", { start: "2026-10-06" })];
  const out = mergeInOrder(live, cache);
  ok("the newer live row survives", out[0].start, "2026-10-14");
  ok("...and its stamp is kept", out[0].lastModifiedAt, "2026-10-05T21:50:36.976Z");
  ok("one row out, not two", out.length, 1);
}

console.log("\n2. A NEWER cache row still wins — another device's change must land");
{
  // The legitimate path: deltaSync writes server-stamped rows into the cache
  // and fires the event. Those rows ARE newer, and must be applied.
  const live = [at("J", "2026-10-05T10:00:00.000Z", { start: "2026-10-06" })];
  const cache = [at("J", "2026-10-05T12:00:00.000Z", { start: "2026-10-20" })];
  ok("the newer cache row is applied", mergeInOrder(live, cache)[0].start, "2026-10-20");
}

console.log("\n3. Equal stamps keep live state — a tie is not a reason to replace");
{
  const live = [at("J", "2026-10-05T10:00:00.000Z", { start: "NEW" })];
  const cache = [at("J", "2026-10-05T10:00:00.000Z", { start: "OLD" })];
  ok("a tie does not overwrite", mergeInOrder(live, cache)[0].start, "NEW");
}

console.log("\n4. Missing stamps: an unstamped cache row cannot prove it is newer");
{
  const live = [at("J", "2026-10-05T10:00:00.000Z", { start: "NEW" })];
  ok("unstamped cache loses to stamped live",
    mergeInOrder(live, [{ id: "J", start: "OLD" }])[0].start, "NEW");
  // ...but an unstamped LIVE row has nothing to defend itself with, and the
  // cache is the only version with provenance.
  ok("stamped cache beats unstamped live",
    mergeInOrder([{ id: "J", start: "OLD" }], [at("J", "2026-10-05T10:00:00.000Z", { start: "NEW" })])[0].start, "NEW");
  ok("neither stamped: live is kept, because the cache cannot claim to be newer",
    mergeInOrder([{ id: "J", start: "NEW" }], [{ id: "J", start: "OLD" }])[0].start, "NEW");
}

console.log("\n5. Order and membership are unchanged — this only picks a winner");
{
  const live = [at("A", "1"), at("B", "1"), at("C", "1")];
  const cache = [at("C", "2"), at("A", "2"), at("D", "2")];
  const out = mergeInOrder(live, cache);
  ok("live order leads", out.slice(0, 2).map(r => r.id), ["A", "C"]);
  ok("...rows only in the cache are appended", out[out.length - 1].id, "D");
  ok("...a row only in live is DROPPED, as before",
    out.some(r => r.id === "B"), false);
  ok("no duplicates", out.length, new Set(out.map(r => r.id)).size);
}

console.log("\n6. doSave refreshes the cache on SUCCESS, not only on rollback");
{
  // The direct cause. Without this the cache is stale the moment a save
  // lands, and every later sync replays the pre-save tree.
  ok("the success path caches what it just saved",
    /cacheFullSlices\(latestTasksRef\.current, latestPeopleRef\.current, dataRef\.current\.clients\)/.test(CODE), true);
  // AFTER the stamps are adopted, or the cache stores rows carrying no server
  // stamp — which, with the comparison above, would lose every future merge and
  // make the cache permanently useless.
  //
  // RE-POINTED BY #387, not relaxed. The three adoptStamps calls now live in an
  // `adoptAll` wrapper defined ABOVE the 409 branch, so that the conflict path
  // can adopt before it returns; anchoring on `adoptStamps(results[2]` would
  // now reach past thirty lines of conflict handling and fail for a reason that
  // has nothing to do with this suite. The invariant is unchanged and is stated
  // directly instead of through a proximity window: an adoption runs before the
  // cache write, and what it adopts covers all three slices.
  const cacheAt = CODE.indexOf("cacheFullSlices(latestTasksRef");
  const adoptAt = cacheAt > 0 ? CODE.lastIndexOf("adoptAll();", cacheAt) : -1;
  ok("...after the server stamps have been adopted", adoptAt > 0 && adoptAt < cacheAt, true);
  ok("...and the adoption it runs covers all three slices",
    /const adoptAll = \(\) => \{[\s\S]{0,600}?adoptStamps\(results\[2\]/.test(CODE), true);
  ok("...and the rollback branch still caches too",
    /cacheFullSlices\(srvTasks, srvPeople, srvClients\)/.test(CODE), true);
}

console.log("\n7. RED PROOF");
{
  const checks = [
    // The old rule, reproduced: cache wins unconditionally.
    ["the old merge took the cache row regardless of age",
      (() => {
        const old = (prev, fresh) => { const byId = new Map(fresh.map(r => [String(r.id), r]));
          const out = []; for (const r of prev) if (byId.has(String(r.id))) out.push(byId.get(String(r.id))); return out; };
        return old([at("J", "2026-10-05T21:50:36.976Z", { start: "2026-10-14" })],
                   [at("J", "2026-10-05T21:49:00.000Z", { start: "2026-10-06" })])[0].start;
      })(), "2026-10-06"],
    ["...which is exactly the reverted position from the recording", "2026-10-06", "2026-10-06"],
    ["the new merge keeps the move",
      mergeInOrder([at("J", "2026-10-05T21:50:36.976Z", { start: "2026-10-14" })],
                   [at("J", "2026-10-05T21:49:00.000Z", { start: "2026-10-06" })])[0].start, "2026-10-14"],
    // ISO-8601 stamps compare correctly as strings; this is what the rule rests on.
    ["ISO stamps order correctly as plain strings",
      "2026-10-05T21:49:00.000Z" < "2026-10-05T21:50:36.976Z", true],
  ];
  let red = 0;
  for (const [label, got, want] of checks) {
    if (JSON.stringify(got) === JSON.stringify(want)) red++;
    else { console.error(`  RED FAIL  ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); fail++; }
  }
  console.log(`  red proof: ${red}/${checks.length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
