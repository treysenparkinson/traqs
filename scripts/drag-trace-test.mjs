// The trace points are on the path the week/month drag ACTUALLY takes.
//
// This suite exists because of a specific, expensive failure. #379's tracer
// printed NOTHING: its points sat inside `commitLanding`, and the week/month
// drop does not call it — it commits with `setTasks(prev => _build(prev))`
// directly. One wrong assumption about which path a drag takes silenced all
// three points, and the round was wasted discovering that rather than the bug.
//
// So each point is asserted to be INSIDE the handler it belongs to, by brace
// matching rather than by file-wide search. A trace that is present but
// unreachable is worse than no trace: it reads as evidence of absence.
//
//   node scripts/drag-trace-test.mjs
import { readFileSync } from "node:fs";
import { codeOf } from "./_code-view.mjs";
import { traceOn, trace, crumb, trackOp, trackedOp, opRow, resetSeq } from "../src/dragTrace.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));

// The body of a function, brace-matched from an anchor, so "is this point in
// onM?" is answered by containment and not by proximity.
const bodyFrom = (anchor) => {
  const at = CODE.indexOf(anchor);
  if (at < 0) return "";
  let i = CODE.indexOf("{", at), depth = 0;
  for (let j = i; j < CODE.length; j++) {
    if (CODE[j] === "{") depth++;
    else if (CODE[j] === "}") { depth--; if (depth === 0) return CODE.slice(at, j + 1); }
  }
  return "";
};

console.log("\n1. The gate is off by default and never throws");
{
  ok("traceOn() is false with no localStorage", traceOn(), false);
  ok("trace() is a no-op when off", trace("x", { a: 1 }), undefined);
  globalThis.localStorage = { getItem: () => { throw new Error("blocked"); } };
  ok("...and a throwing localStorage still reports off, not a crash", traceOn(), false);
  globalThis.localStorage = { getItem: (k) => (k === "tq_trace_drag" ? "1" : null) };
  ok("...and reads the documented key", traceOn(), true);
  globalThis.localStorage = { getItem: () => "0" };
  ok("...only for the value \"1\"", traceOn(), false);
  delete globalThis.localStorage;
}

console.log("\n2. opRow finds the op anywhere in the tree, and says so when it cannot");
{
  const tasks = [{ id: "J", lastModifiedAt: "S", subs: [{ id: "P", subs: [
    { id: "OP", title: "Wire", start: "2026-10-07", end: "2026-10-09", startHour: 8, endHour: 12, hpd: 6, team: [7, 9], moveLog: [1, 2, 3] },
  ] }] }];
  const r = opRow(tasks, "OP");
  ok("it reports the scheduling fields", [r.start, r.end, r.startHour, r.hpd], ["2026-10-07", "2026-10-09", 8, 6]);
  ok("...the team and the moveLog length", [r.team, r.moveLog], ["7,9", 3]);
  ok("...and the JOB's stamp, since ops carry none (#379)", r.jobStamp, "S");
  ok("a missing op is reported as missing, not as an empty row", opRow(tasks, "NOPE").missing, true);
  ok("...and so is a missing tree", opRow(null, "OP").missing, true);
  ok("an id given as a number still matches a string id", opRow(tasks, "OP").id, "OP");
  trackOp("ABC"); ok("the tracked op round-trips", trackedOp(), "ABC");
  trackOp(null); ok("...and clears", trackedOp(), null);
  ok("resetSeq is callable", resetSeq(), undefined);
}

console.log("\n3. EVERY POINT IS ON THE PATH — the failure #379's tracer had");
{
  // The three handlers of the week/month bar drag, by their real anchors.
  const onM = bodyFrom("const onM = me => {\n                      lastCX = me.clientX; lastCY = me.clientY;");
  const onU = bodyFrom("const onU = me => {\n                      cancelAnimationFrame(autoScrollRaf);");
  const doSave = (() => {
    const a = CODE.indexOf("const doSaveOnce = useCallback(async () => {");
    const b = CODE.indexOf("const rollbackToServer = async () => {", a);
    return a >= 0 && b > a ? CODE.slice(a, b) : "";
  })();
  ok("the mousemove handler was located", onM.length > 500, true);
  ok("the mouseup handler was located", onU.length > 500, true);
  ok("doSaveOnce was located", doSave.length > 500, true);

  // 1 — mousedown. Outside onM/onU, in the handler that installs them.
  ok("1 mousedown is present", /dragCrumb\("mousedown"/.test(CODE), true);
  ok("...and is UNGATED, so \"did it fire at all\" is answerable", /crumb as dragCrumb/.test(CODE), true);
  ok("...and is NOT inside the mousemove handler", /dragCrumb\("mousedown"/.test(onM), false);
  ok("...and registers the op the later points print", /dragTrackOp\(bar\.task\?\.id\)/.test(CODE), true);

  // 2 — mousemove, and before the ref the ghost reads, so it records what the
  // ghost is actually told.
  ok("2 mousemove is INSIDE onM", /dragTrace\("2 mousemove/.test(onM), true);
  ok("...and runs before teamDragLiveRef is written",
    onM.indexOf('dragTrace("2 mousemove') < onM.indexOf("teamDragLiveRef.current = { snapStart"), true);

  // 3 and 4 — mouseup, and the commit must sit with the setTasks that performs it.
  ok("3 mouseup is INSIDE onU", /dragTrace\("3 mouseup/.test(onU), true);
  ok("...and before the refusal returns, so a refused drop still prints",
    onU.indexOf('dragTrace("3 mouseup') < onU.indexOf("if (_refusal) { _refused(_refusal); return; }"), true);
  ok("4 commit is INSIDE onU", /dragTrace\("4 commit/.test(onU), true);
  ok("...immediately before the setTasks that commits it",
    onU.indexOf('dragTrace("4 commit') < onU.indexOf("setTasks(prev => _build(prev));"), true);
  ok("...and the no-overlap refusal is traced too", /dragTrace\("4 REFUSED/.test(onU), true);

  // 5 and 6 — after the commit, which is where nothing has ever been watched.
  ok("5 one-tick-later is INSIDE onU", /dragTrace\("5 one tick later/.test(onU), true);
  ok("6 one-frame-later is INSIDE onU", /dragTrace\("6 one frame later/.test(onU), true);
  ok("...and reads the RENDERER, not the state again", /getPersonBars\(_p\.id\)/.test(onU), true);
  ok("...gated, so a normal drag pays nothing", /if \(dragTraceOn\(\)\) \{/.test(onU), true);

  // 7 and 8 — the save, in doSaveOnce, which is the path every drag's save takes.
  ok("7 POST is INSIDE doSaveOnce", /dragTrace\("7 POST/.test(doSave), true);
  ok("...reading the array actually sent", /dragOpRow\(dedupedTasks, dragTrackedOp\(\)\)/.test(doSave), true);
  ok("8 response is INSIDE doSaveOnce", /dragTrace\("8 response/.test(doSave), true);
  ok("...and before the conflict branch returns, so a refusal still prints",
    doSave.indexOf('dragTrace("8 response') < doSave.indexOf("status: 409,"), true);
}

console.log("\n4. It is temporary, and says so");
{
  // Against the RAW source, not CODE: this marker is deliberately a comment, and
  // codeOf strips comments. Asserting it against the stripped view would be a
  // check that can never pass — the inverse of the usual mistake, and just as dead.
  const RAW = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
  ok("the import is marked for removal", /TEMPORARY \(#391 investigation\)/.test(RAW), true);
  const mod = readFileSync(new URL("../src/dragTrace.js", import.meta.url), "utf8");
  ok("the module says it comes out", /TEMPORARY\./.test(mod), true);
  ok("...and records why the last tracer failed", /commitLanding/.test(mod), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
