// A trace of ONE drag, end to end, behind localStorage.tq_trace_drag = "1".
//
// WHY IT EXISTS. Four real defects came out of this snap-back — #387 (the client
// could not recover from a refusal), #388 (saves raced themselves), #389 (a drop
// could land on quitting time), #390 (the day and the hour were rounded
// separately) — and NONE of them is the one Trey is still hitting. Every one was
// inferred from one end or the other: the rule log, or the arithmetic. Nobody
// has watched a single drag travel from the mouse to the screen.
//
// The question each line answers is the same one: AT WHICH STEP DOES THE VALUE
// STOP BEING WHAT HE AIMED AT.
//
// THE LAST TRACER PRINTED NOTHING, and that is the failure this is written
// against. Its points sat inside `commitLanding`, and the week/month drop does
// not call it — it commits with setTasks directly. So:
//   - every point here is on the path the week/month drag ACTUALLY takes, and
//     the suite asserts each one is inside the handler it belongs to
//   - `crumb` at mousedown is UNGATED, so "did it fire at all?" is answerable
//     without first getting the flag right
//
// TEMPORARY. It exists to find one defect and comes out once that is done, the
// same as #379's.

const KEY = "tq_trace_drag";

/** Is the trace on? Never throws — private windows and blocked storage both
 *  report "off" rather than breaking a drag. */
export function traceOn() {
  try { return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1"; }
  catch { return false; }
}

// The op this drag is about, so the save and render points can print THAT row
// out of a 64-job tree instead of the whole thing.
let tracked = null;
export const trackOp = (id) => { tracked = id == null ? null : String(id); };
export const trackedOp = () => tracked;

let seq = 0;
export const resetSeq = () => { seq = 0; };

/** One gated line. `step` is the stage; `data` is printed as an object so the
 *  console keeps it inspectable rather than stringifying it. */
export function trace(step, data) {
  if (!traceOn()) return;
  // eslint-disable-next-line no-console
  console.log(`[drag ${String(++seq).padStart(3, "0")}] ${step}`, data ?? {});
}

/** UNGATED, one line, mousedown only. If this is absent from the console the
 *  handler never ran and nothing below it can be believed. */
export function crumb(step, data) {
  // eslint-disable-next-line no-console
  console.log(`[drag:crumb] ${step}`, data ?? {});
}

/** The scheduling fields of one op, found anywhere in the job tree. Returns a
 *  flat row so two prints can be compared by eye without unfolding objects. */
export function opRow(tasks, id) {
  if (!Array.isArray(tasks) || id == null) return { missing: true, id: String(id ?? "") };
  const want = String(id);
  for (const job of tasks) {
    for (const panel of (job.subs || [])) {
      for (const op of (panel.subs || [])) {
        if (String(op.id) !== want) continue;
        return {
          id: want, title: op.title || "",
          start: op.start, end: op.end, startHour: op.startHour, endHour: op.endHour,
          hpd: op.hpd, team: (op.team || []).join(","),
          moveLog: (op.moveLog || []).length,
          jobStamp: job.lastModifiedAt || null,
        };
      }
    }
  }
  return { missing: true, id: want };
}
