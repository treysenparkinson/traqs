// #403 — THE ASSISTANT REPORTED REFUSED WRITES AS APPLIED.
//
// `executeConfirmedActions` ended every run with:
//
//     const toolResults = toolUses.map(tu => ({ type: "tool_result",
//       tool_use_id: tu.id, content: "Action applied successfully." }));
//
// A CONSTANT STRING, for every tool, unconditionally — and it was built BEFORE
// the save had been awaited (`setTimeout(() => doSave(), 300)`). Two different
// ways to be wrong, and both tell the user the same comfortable lie:
//
//   1. THE HANDLER CHANGED NOTHING. `setTasks(prev => prev.map(t => t.id ===
//      input.job_id ? … : t))` matches nothing for an unknown id and returns the
//      list untouched. Reported as applied.
//   2. THE SERVER REFUSED THE WRITE. The /tasks POST classifies the change and
//      demands the matching permission — a worker asking TRAQS to reassign is
//      refused there. The chat had already said it worked.
//
// Treysen: "Trey asks TRAQS to move something, it's refused at the server, and
// the assistant tells him it worked. He has no reason to check."
//
// THE SECOND ONE ALSO MISLEADS THE MODEL, not just the person. The tool_result
// is fed straight back into the conversation, so the assistant builds its next
// answer on "Action applied successfully" and will happily confirm the change
// again when asked.
//
//   node scripts/ai-action-result-test.mjs
import { OUTCOME_APPLIED, OUTCOME_NOCHANGE, OUTCOME_REFUSED, toolResultsFor } from "../src/aiActions.js";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const uses = [{ id: "t1", name: "update_operation" }, { id: "t2", name: "assign_person_to_job" }];
const contentOf = (rows) => rows.map(r => r.content);

console.log("\n1. THE PROPERTY — a result never claims more than happened");
{
  const rows = toolResultsFor(uses, { t1: OUTCOME_APPLIED, t2: OUTCOME_APPLIED }, { ok: true });
  ok("the shape the API expects is preserved",
    rows.map(r => [r.type, r.tool_use_id]), [["tool_result", "t1"], ["tool_result", "t2"]]);
  ok("a real change that saved reports applied", rows.every(r => /applied/i.test(r.content)), true);
  ok("...and says nothing about failure", rows.some(r => /not|fail|refus/i.test(r.content)), false);
}

console.log("\n2. A HANDLER THAT CHANGED NOTHING");
{
  const rows = toolResultsFor(uses, { t1: OUTCOME_NOCHANGE, t2: OUTCOME_APPLIED }, { ok: true });
  ok("the no-op does NOT report success", /applied successfully/i.test(rows[0].content), false);
  ok("...it says nothing matched", /nothing was changed/i.test(rows[0].content), true);
  ok("...and names the tool so the model can retry sensibly", /update_operation/.test(rows[0].content), true);
  ok("the sibling that DID apply still reports applied", /applied/i.test(rows[1].content), true);
}

console.log("\n3. A HANDLER REFUSED LOCALLY");
{
  const rows = toolResultsFor(uses, { t1: { outcome: OUTCOME_REFUSED, reason: "Treysen is clocked into this operation" } }, { ok: true });
  ok("a refusal does not read as success", /applied successfully/i.test(rows[0].content), false);
  ok("...it carries the reason verbatim", /Treysen is clocked into this operation/.test(rows[0].content), true);
  ok("...marked as refused", /refused/i.test(rows[0].content), true);
}

console.log("\n4. THE SAVE FAILED — NOTHING PERSISTED, WHATEVER THE HANDLERS DID");
{
  // The local mutation can be perfect and the write still refused at /tasks.
  // Every applied action has to be walked back in the report, or the assistant
  // confirms a change that does not exist.
  const rows = toolResultsFor(uses, { t1: OUTCOME_APPLIED, t2: OUTCOME_APPLIED },
    { ok: false, status: 403, message: "You do not have permission to reassign operations." });
  ok("NO result claims success", contentOf(rows).some(c => /applied successfully/i.test(c)), false);
  ok("every result says the save failed", rows.every(r => /not saved/i.test(r.content)), true);
  ok("...and carries the server's own words", rows.every(r => /do not have permission to reassign/.test(r.content)), true);
  ok("...and the status, so the model can tell 403 from 409", rows.every(r => /403/.test(r.content)), true);
}

console.log("\n5. A FAILED SAVE DOES NOT INVENT A CHANGE THAT NEVER HAPPENED");
{
  const rows = toolResultsFor(uses, { t1: OUTCOME_NOCHANGE, t2: OUTCOME_APPLIED }, { ok: false, status: 409, message: "changed on the server" });
  ok("the no-op still reports as a no-op, not as a failed save", /nothing was changed/i.test(rows[0].content), true);
  ok("...and does not also claim the save lost it", /not saved/i.test(rows[0].content), false);
  ok("the applied one reports the failed save", /not saved/i.test(rows[1].content), true);
}

console.log("\n6. EDGE CASES — it must never throw inside the chat turn");
{
  ok("no tool uses yields no results", toolResultsFor([], {}, { ok: true }), []);
  ok("a missing outcome map is treated as applied",
    /applied/i.test(toolResultsFor([uses[0]], undefined, { ok: true })[0].content), true);
  ok("a missing save result is treated as succeeded",
    /applied/i.test(toolResultsFor([uses[0]], { t1: OUTCOME_APPLIED }, undefined)[0].content), true);
  ok("a refusal with no reason still does not read as success",
    /applied successfully/i.test(toolResultsFor([uses[0]], { t1: { outcome: OUTCOME_REFUSED } }, { ok: true })[0].content), false);
  ok("a save failure with no message still says it failed",
    /not saved/i.test(toolResultsFor([uses[0]], { t1: OUTCOME_APPLIED }, { ok: false })[0].content), true);
}

console.log("\n7. RED PROOF — the constant string");
{
  // What it used to produce, for every tool, in every one of the cases above.
  const old = uses.map(tu => ({ type: "tool_result", tool_use_id: tu.id, content: "Action applied successfully." }));
  ok("RED: the old result was identical whatever happened",
    [...new Set(contentOf(old))], ["Action applied successfully."]);
  ok("...including when the save was refused", /applied successfully/i.test(old[0].content), true);
  ok("...and the fix differs on exactly that input",
    toolResultsFor(uses, { t1: OUTCOME_APPLIED, t2: OUTCOME_APPLIED }, { ok: false, status: 403 })[0].content !== old[0].content, true);
}

console.log("\n8. The chat path uses it, and awaits the save first");
{
  const { readFileSync } = await import("node:fs");
  const { codeOf } = await import("./_code-view.mjs");
  const CODE = codeOf(readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8"));
  const at = CODE.indexOf("const executeConfirmedActions = async () => {");
  const body = at < 0 ? "" : CODE.slice(at, at + 6000);
  ok("executeConfirmedActions was found", body.length > 500, true);
  ok("the constant string is gone", /content: "Action applied successfully\."/.test(body), false);
  ok("...replaced by the shared builder", /toolResultsFor\(toolUses, outcomes, saveResult\)/.test(body), true);
  // The old code fired the save on a 300ms timer and built the results
  // immediately, so it could not have known the answer even in principle.
  ok("the save is AWAITED, not fired on a timer",
    /setTimeout\(\(\) => doSave\(\), 300\)/.test(body), false);
  // The await and the read are two statements, because the verdict comes back
  // through a ref rather than a return value — serializeRuns (#388) coalesces,
  // so doSave resolves without having run when a save was already in flight.
  ok("...the save is awaited through the serialised wrapper", /await doSaveRef\.current\(\);/.test(body), true);
  ok("...and its verdict is read from the ref the save writes",
    /const saveResult = lastSaveResultRef\.current;/.test(body), true);
  // BOTH indices found. `a < b` is true when `a` is -1, i.e. exactly when the
  // clear is missing — the assertion would be green on the bug it exists to
  // catch. This is the SECOND time this shape slipped through in one session
  // (assign-consolidation-test section 1 had it this morning), which is why
  // LESSONS #13 now names the mutation that finds it.
  const clearAt = body.indexOf("lastSaveResultRef.current = null;");
  const awaitAt = body.indexOf("await doSaveRef.current();");
  ok("...cleared first, so a stale verdict cannot be reported as this one's",
    clearAt >= 0 && awaitAt > clearAt, true);

  // THE HANDLERS, not just the formatter. The behavioural sections above pass
  // outcomes IN, so nothing there can see a handler that stopped computing them.
  ok("the handlers report whether they matched anything",
    /outcomes\[tu\.id\] = changed \? OUTCOME_APPLIED : OUTCOME_NOCHANGE;/.test(body), true);
  ok("...and the id-matching handlers check before mutating",
    (body.match(/changed = (jobExists|nodeExists)\(/g) || []).length, 4);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
