// #388 — SAVES MUST NOT OVERLAP THEMSELVES.
//
// THE MEASUREMENT THAT CAUSED THIS. On 2026-10-06, the first day of
// TASK_CONFLICT_MODE=enforce, `orgs/MTX2026TRAQS/rule-events.json` recorded
// twenty task-conflict rows. ALL TWENTY WERE CALLER 99 — one client, conflicting
// with itself, on one op. The staleness was not hours like #380's stale tab; it
// was −455ms, −500ms, −657ms, −664ms. And row 2's `incoming` stamp was literally
// row 1's `stored` stamp:
//
//   14:44:04.571  incoming …03.496  stored …03.996   −500ms
//   14:44:05.317  incoming …03.996  stored …04.451   −455ms
//   14:44:06.302  incoming …05.128  stored …05.785   −657ms
//   14:44:08.173  incoming …06.954  stored …07.618   −664ms
//
// Each save started before the previous one's response came back, so it carried
// the stamp from before that response was adopted. Nothing serialised doSave:
// its ~22 explicit call sites all fire `setTimeout(() => doSaveRef.current(), 0)`
// straight after a `setTasks`, and a drag inside the round trip is stale BY
// CONSTRUCTION however good the recovery afterwards is. #387 made the client
// recover from the refusal; this removes the cause.
//
// THE CONTRACT, both halves of which are properties nothing was checking:
//   1. a call made while a run is in flight must not start a second run
//   2. it must schedule EXACTLY ONE follow-up, however many calls arrive —
//      a burst of drags coalesces into one save, not one save per drag
//   3. a FAILED run must still run the queued follow-up, or an edit made during
//      a failed round trip is lost with nothing left to re-arm it
//
//   node scripts/save-serialize-test.mjs
import { serializeRuns } from "../src/saveQueue.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

// A stand-in for doSave: records when it starts and finishes, and resolves when
// told to. `gate` is the round trip — the whole bug lives inside it.
const makeFn = ({ fails = [] } = {}) => {
  const log = [];
  let release = null;
  const fn = async () => {
    const n = log.filter(e => e.startsWith("start")).length + 1;
    log.push(`start${n}`);
    await new Promise(r => { release = r; });
    log.push(`end${n}`);
    if (fails.includes(n)) throw new Error(`save ${n} failed`);
  };
  return { fn, log, finish: async () => { const r = release; release = null; r?.(); await settle(); } };
};

console.log("\n1. A call during a run does not start a second run");
{
  const { fn, log, finish } = makeFn();
  const run = serializeRuns(fn);
  run(); await settle();
  ok("the first run started", log, ["start1"]);
  run(); await settle();
  ok("a call mid-flight starts NOTHING", log, ["start1"]);
  await finish();
  ok("...it runs after the first finishes", log, ["start1", "end1", "start2"]);
  await finish();
  ok("...and then stops", log, ["start1", "end1", "start2", "end2"]);
}

console.log("\n2. EXACTLY ONE follow-up, not one per call");
{
  // Trey's burst: five drags inside one slow round trip. Before this, five
  // POSTs, four of them stale against the one before. After: two.
  const { fn, log, finish } = makeFn();
  const run = serializeRuns(fn);
  run(); await settle();
  for (let i = 0; i < 5; i++) run();
  await settle();
  ok("five mid-flight calls still start nothing", log, ["start1"]);
  await finish();
  ok("...and coalesce into ONE follow-up", log, ["start1", "end1", "start2"]);
  await finish();
  ok("...which is the last run — the burst did not queue five", log.filter(e => e.startsWith("start")).length, 2);
}

console.log("\n3. A FAILED run still runs the queued follow-up");
{
  // The requirement in Treysen's words: the dirty flag must survive a failed
  // save, or an edit made during a failed round trip is lost with nothing to
  // re-arm it. doSave itself never rejects (it catches and sets saveError), but
  // the helper must not depend on that.
  const { fn, log, finish } = makeFn({ fails: [1] });
  const run = serializeRuns(fn);
  const p = run().catch(() => "swallowed");
  await settle();
  run();                                   // the edit made during the bad round trip
  await finish();                          // run 1 rejects here
  ok("the follow-up runs even though the first FAILED", log, ["start1", "end1", "start2"]);
  await finish();
  ok("...and completes", log.at(-1), "end2");
  ok("...and the caller's promise settled rather than hanging", await p, undefined);
}

console.log("\n4. The failure still surfaces when nothing was queued");
{
  const { fn, finish } = makeFn({ fails: [1] });
  const run = serializeRuns(fn);
  let caught = null;
  const p = run().catch(e => { caught = e.message; });
  await settle();
  await finish();
  await p;
  ok("a lone failing run rejects, so saveError is still set", caught, "save 1 failed");
}

console.log("\n5. A retry that SUCCEEDS does not report the earlier failure");
{
  const { fn, finish } = makeFn({ fails: [1] });
  const run = serializeRuns(fn);
  let caught = null;
  const p = run().catch(e => { caught = e.message; });
  await settle();
  run();                                   // queues the follow-up
  await finish();                          // run 1 fails, run 2 starts
  await finish();                          // run 2 succeeds
  await p;
  ok("the queue's verdict is the LAST run, not the first", caught, null);
}

console.log("\n6. Sequential calls are untouched");
{
  const { fn, log, finish } = makeFn();
  const run = serializeRuns(fn);
  run(); await settle(); await finish();
  run(); await settle(); await finish();
  ok("two non-overlapping calls both run", log, ["start1", "end1", "start2", "end2"]);
}

console.log("\n7. RED PROOF — the unserialised call reproduces the production trace");
{
  // Exactly what doSave was: call it, call it again before the first returns.
  const { fn, log, finish } = makeFn();
  fn(); await settle();
  fn(); await settle();
  const starts = log.filter(e => e.startsWith("start")).length;
  ok("RED: unserialised, the second run starts while the first is in flight", starts, 2);
  ok("...which is the −500ms self-conflict, with no end1 between the starts",
    log.slice(0, 2), ["start1", "start2"]);
  await finish(); await finish();
}

console.log("\n8. doSave actually goes through it");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  // The helper existing and being correct is worth nothing if the save path does
  // not use it — LESSONS #1, a green assertion over code nothing executes.
  ok("TRAQS.jsx imports the helper", /import\s*\{[^}]*serializeRuns[^}]*\}\s*from\s*"\.\/saveQueue\.js"/.test(CODE), true);
  ok("...and doSave is the serialised wrapper, not the raw body",
    /const doSave = useMemo\(\(\) => serializeRuns\(doSaveOnce\)/.test(CODE), true);
  // The ~22 call sites reach doSave through doSaveRef, so the ref must hold the
  // wrapper. If it still held the raw body every explicit save would bypass the
  // queue and only the debounce would be serialised.
  ok("...and doSaveRef carries the wrapper", /doSaveRef\.current = doSave;/.test(CODE), true);
  ok("the raw body is not called anywhere else",
    (CODE.match(/doSaveOnce\b/g) || []).length, 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
