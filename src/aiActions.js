// What the assistant is told about its own tool calls (#403).
//
// `executeConfirmedActions` used to end every run with a CONSTANT STRING:
//
//     content: "Action applied successfully."
//
// for every tool, unconditionally, built BEFORE the save had been awaited
// (`setTimeout(() => doSave(), 300)`). It could not have known the answer even
// in principle. Two different ways to be wrong, both telling the user the same
// comfortable lie:
//
//   1. THE HANDLER CHANGED NOTHING. `prev.map(t => t.id === input.job_id ? … : t)`
//      matches nothing for an unknown id and returns the list untouched.
//   2. THE SERVER REFUSED THE WRITE. /tasks classifies the change and demands the
//      matching permission, so a worker asking TRAQS to reassign is refused
//      there — after the chat has already said it worked.
//
// Treysen's ruling, 2026-10-06: "Trey asks TRAQS to move something, it's refused
// at the server, and the assistant tells him it worked. He has no reason to
// check."
//
// AND IT MISLEADS THE MODEL, not only the person. tool_result goes straight back
// into the conversation, so the assistant reasons from "applied successfully"
// and will confirm the change again when asked about it.
//
// Pure and separate from the component so the mapping is testable as behaviour
// rather than as a grep over JSX.

export const OUTCOME_APPLIED = "applied";
export const OUTCOME_NOCHANGE = "nochange";
export const OUTCOME_REFUSED = "refused";

const normalise = (o) => {
  if (!o) return { outcome: OUTCOME_APPLIED, reason: "" };
  if (typeof o === "string") return { outcome: o, reason: "" };
  return { outcome: o.outcome || OUTCOME_APPLIED, reason: o.reason || "" };
};

/**
 * Build the tool_result blocks for one confirmed run.
 *
 * @param {Array<{id: string, name?: string}>} toolUses
 * @param {Object|undefined} outcomes  tool_use_id -> OUTCOME_* or { outcome, reason }
 * @param {{ok: boolean, status?: number, message?: string}|undefined} save
 *
 * Missing arguments are read the generous way — applied, and saved — because
 * this runs inside a chat turn and must never be the thing that throws. The
 * assertions it exists to make are about the cases where something IS known to
 * have gone wrong.
 */
export function toolResultsFor(toolUses, outcomes, save) {
  const list = Array.isArray(toolUses) ? toolUses : [];
  const saved = !save || save.ok !== false;
  return list.map((tu) => {
    const { outcome, reason } = normalise((outcomes || {})[tu?.id]);
    let content;
    if (outcome === OUTCOME_NOCHANGE) {
      // Reported BEFORE the save is considered: nothing was changed, so the save
      // has nothing to do with this one. Saying "not saved" here would invent a
      // change that never existed and send the model looking for it.
      content = `No matching record was found for ${tu?.name || "this action"} — nothing was changed.`;
    } else if (outcome === OUTCOME_REFUSED) {
      content = `Refused: ${reason || "the change was not allowed."} Nothing was changed.`;
    } else if (!saved) {
      // The local change was made and then did NOT persist. The status matters:
      // 403 is a permission verdict the user must act on, 409 is a stale copy
      // they can retry. The model can tell them apart and say something useful.
      const bits = [
        "The change was applied locally but NOT SAVED to the server",
        save?.status ? ` (${save.status})` : "",
        save?.message ? `: ${save.message}` : ".",
      ];
      content = bits.join("") + " Treat it as not done.";
    } else {
      content = "Applied and saved.";
    }
    return { type: "tool_result", tool_use_id: tu?.id, content };
  });
}
