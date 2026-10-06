// A derived default must not be saved as though somebody chose it (#223/#224).
//
// `normalizeTasks` and `normalizePeople` fill missing values on LOAD — a panel's
// colour from its job, a person's department from their role, an op's
// `requiredDepartment` from nothing at all — and the client then autosaves the
// whole tree. The guess goes to S3 and becomes indistinguishable from a choice.
//
// Same shape as #341's title heuristic, which wrote its guess into the data and
// left 87 ops carrying a constraint nobody typed. The cost there was a review
// nobody could complete, because nobody could tell intent from artefact.
//
// MEASURED ON MATRIX: department === role on 18 of 18 live people;
// `requiredDepartment === ""` persisted on 109 of 294 live nodes; 118 of 118
// panels carrying their job's colour and 112 of 112 ops carrying their panel's.
// NOT ONE COLOUR BELOW JOB LEVEL WAS EVER DELIBERATELY CHOSEN — and `updPanel`
// patches `{ ...pn, ...patch }` with no cascade, so all 112 ops are stranded the
// moment anyone uses the panel colour picker.
//
// THE FIX IS ABOUT PERSISTENCE, NOT COMPUTATION. The normaliser may still derive
// for the screen; that is what keeps a panel the same colour across reloads.
// What it may not do is send the guess back.
//
// WHAT ALREADY EXISTS IS LEFT ALONE, deliberately. A stored value arrives with
// its key present, so the normaliser never fills it, so it is never marked, so
// it is never stripped. The existing 230 are unknowable — cleaning them up would
// be guessing a second time, which is the mistake this exists to stop.
//
// The marker follows two conventions already in this codebase: run-local scratch
// fields prefixed with `_` that are stripped before S3 (`_outcome`, `_placed`),
// and iOS's `hpdPresence.wasAbsent` — "Absent → 0, UNESTIMATED — never a made-up
// 7.5 — and remembered, so encode leaves the key off again."

export const DERIVED_KEY = "_derived";

/**
 * Record that `fields` on `node` were FILLED BY THE CLIENT, not read from the
 * server. Returns a new node; the original is untouched.
 */
export function markDerived(node, ...fields) {
  if (!node || typeof node !== "object") return node;
  const prev = Array.isArray(node[DERIVED_KEY]) ? node[DERIVED_KEY] : [];
  const next = [...prev];
  for (const f of fields) if (f && !next.includes(f)) next.push(f);
  return { ...node, [DERIVED_KEY]: next };
}

/**
 * Remove every marked field, and the marker, from a value of any shape.
 * Recurses through arrays and plain objects, so one call covers a whole tree.
 *
 * NEVER THROWS. It runs on the save path, and a stripper that can fail is a
 * stripper that can lose somebody's work.
 */
export function stripDerived(value) {
  if (Array.isArray(value)) return value.map(stripDerived);
  if (!value || typeof value !== "object") return value;
  // A marker that is not an array is not trusted — it is dropped, and nothing
  // else is removed on its say-so.
  const marked = Array.isArray(value[DERIVED_KEY]) ? value[DERIVED_KEY] : [];
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === DERIVED_KEY) continue;
    if (marked.includes(k)) continue;
    out[k] = stripDerived(v);
  }
  return out;
}
