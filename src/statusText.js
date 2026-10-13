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

/**
 * #446 part 1 — whether an edited status or priority list may be saved.
 *
 * `draft` and `source` are the option NAMES after and before the edit. A name the edit
 * added or renamed (one not present, exactly, in `source`) is trimmed and its inner runs
 * of spaces collapsed; the save is refused if any normalised form now appears more often
 * than it did before — a new `FINISHED` beside `Finished`, or a rename onto another entry.
 *
 * WHAT THE EDIT DID NOT TOUCH IS LEFT EXACTLY AS STORED, deliberately. Matrix's list
 * already holds `Finished` and `finished`, and `Boxed up ` with a trailing space. Refusing
 * the existing pair would lock the org out of its own list until the data cure (part 2)
 * runs, and trimming `Boxed up ` here without trimming the job that stores it would turn a
 * matching status into an orphan — that is a data change, and part 1 touches no data.
 *
 * Returns `{ names, problem }`: `names` aligned with `draft`, `problem` a sentence or null.
 */
export function checkOptionNames(draft, source) {
  const stored = new Set(source || []);
  const names = (draft || []).map(n => (stored.has(n) ? n : String(n ?? "").trim().replace(/\s+/g, " ")));
  const count = (list, key) => {
    const m = new Map();
    for (const n of list) { const k = key(n); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  };
  // Normalised AND exact: renaming `finished` onto its twin's spelling keeps the normalised
  // count at two but leaves two identical entries, which is still a collision the edit made.
  const grew = (key) => {
    const before = count(source || [], key);
    for (const [k, n] of count(names, key)) if (n > 1 && n > (before.get(k) || 0)) return k;
    return null;
  };
  const exact = grew(n => n);
  const k = exact != null ? normalizeStatus(exact) : grew(normalizeStatus);
  if (k == null) return { names, problem: null };
  const same = names.filter(x => normalizeStatus(x) === k).map(x => `"${x}"`);
  return { names, problem: `${same.join(" and ")} are the same option — names can't differ only by case or spacing.` };
}
