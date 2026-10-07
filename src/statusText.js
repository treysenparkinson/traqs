// Job and operation statuses are FREE TEXT the org edits, so comparing them
// with `===` is wrong (#445).
//
// `statusOpts` is a user-editable list. Matrix's holds **`Finished` AND
// `finished` as two separate entries**, plus `Boxed up ` with a trailing space.
// 11 of its 28 finished jobs carry the lowercase one, so every
// `status === "Finished"` in the product — 79 of them — is blind to 39% of the
// finished work. Those jobs do not fade on the gantt, do not count as done in
// the KPIs, are not skipped by the schedulers, and are not excluded from the
// overlap rules. None of it errors.
//
// THE REAL CURE IS THE DATA, not 79 call sites: the status list should not be
// able to hold two entries that differ only by case or padding, and the stored
// values should be normalised once. That is a migration and a write to live
// data, so it is logged rather than done here. This module is what makes any
// rule keyed on a status correct in the meantime, and the ratchet below is what
// stops the eightieth being written.

/** A status reduced to its comparable form: trimmed, inner runs collapsed, lowercased. */
export function normalizeStatus(s) {
  return String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Whether two statuses mean the same thing, however they were typed. */
export function sameStatus(a, b) {
  return normalizeStatus(a) === normalizeStatus(b);
}

// E-STRICT (#440), and the narrowness is the ruling rather than an oversight.
// `MTX FAT`, `C FAT`, `Crated`, `Boxed up` and `Ready for Packaging` PROBABLY
// mean the shop's work is done — and "probably" is how an indicator starts
// lying in the other direction. The broad set takes the board's red count from
// 42 to 23; it is available on evidence, not ahead of it.
const CLOSED = new Set(["finished", "shipped/ invoiced", "shipped not invoiced"]);

/** Whether this status means the work is over and nothing about it is late. */
export function isClosedStatus(s) {
  return CLOSED.has(normalizeStatus(s));
}

// The vocabulary the product itself ships and compares against. A raw
// comparison to one of these is the hazard; `req.status === "approved"` is not,
// because request statuses are server-written lowercase enums that no user can
// retype. Flagging those would make the guard unusable (LESSONS #4).
const VOCAB = ["Finished", "Not Started", "In Progress", "On Hold", "Paused", "Pending"];

/**
 * Raw `===`/`!==` comparisons of a `.status` against the editable vocabulary.
 * @returns {{line: number, text: string, member: string}[]}
 */
export function statusLiteralViolations(src) {
  const out = [];
  const lines = String(src == null ? "" : src).split(/\r?\n/);
  const noBlocks = String(src == null ? "" : src).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const stripped = noBlocks.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ""));
  const RE = new RegExp(String.raw`\.status\s*[=!]==\s*"(${VOCAB.join("|")})"`, "g");
  stripped.forEach((line, i) => {
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(line))) out.push({ line: i + 1, text: lines[i], member: m[1] });
  });
  return out;
}
