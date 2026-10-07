// Which columns a person sees, and in what order (#428, ruling #429).
//
// THE VALUE IS SHARED, THE VISIBILITY IS PERSONAL. A column's contents — PO
// numbers, whatever — sync to everyone when somebody sets them. Whether a given
// person shows or hides that column is theirs alone, and must survive a reload
// and a change of browser.
//
// ─── WHY THIS FILE EXISTS: TWO FACTS SHARED ONE ENCODING ───
//
// Hiding a standard column used to mean REMOVING its id from `colOrder`. Both
// readers then ran the saved list through `backfillColOrder`, which appends every
// known column that is missing — so absence from the array meant BOTH:
//
//     "I hid this"                      and
//     "this column shipped after you last saved"
//
// and backfill, having no way to tell them apart, always chose the second. The
// column came back on every reload. Backfill is not the bug: without it a newly
// shipped column is stripped a moment after appearing. The ENCODING is the bug.
//
// It is the same shape `scheduleRules` records for departments — *"'Wire or Cut
// can do this' had to be written as 'nothing', which is also how you write
// 'anyone'. Two facts, one encoding"* — and it takes the same fix: say the second
// fact out loud.
//
//     colOrder    ORDER ONLY, and always complete. Backfill still appends new
//                 columns, which is all it was ever for.
//     hiddenCols  WHICH ONES ARE HIDDEN. Explicit, so absence from the order no
//                 longer carries a second meaning.
//
// The known-column list is passed IN rather than kept here: it belongs with the
// grid that defines it (`STD_COL_DEFS`), and a second copy is a second thing to
// drift.

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * A saved order, completed and cleaned: known ids in their saved order, then any
 * known id the save predates, then nothing else.
 *
 * This is what stops a column shipped after an account's last save from being
 * stripped a moment after it appears. It no longer says anything about
 * visibility — that is `hiddenCols` now.
 */
export function backfillColOrder(saved, known) {
  const ids = arr(known);
  const seen = new Set();
  const kept = [];
  for (const id of arr(saved)) {
    if (!ids.includes(id) || seen.has(id)) continue;   // unknown or duplicate
    seen.add(id); kept.push(id);
  }
  return [...kept, ...ids.filter(id => !seen.has(id))];
}

/** The columns actually drawn: the order, minus the ones this person hid. */
export function visibleColOrder(order, hidden) {
  const h = new Set(arr(hidden));
  return arr(order).filter(id => !h.has(id));
}

/**
 * The hidden list for an account, migrating one saved before `hiddenCols` existed.
 *
 * ONE BOUNDED GUESS, MADE ONCE, TO END A PERMANENT AMBIGUITY. A pre-migration
 * save is missing exactly the columns that account hid — that is the only moment
 * the old encoding can still be read, so it is read and then written down
 * explicitly, after which absence means nothing at all.
 *
 * THE TRADE, stated rather than buried: a column that shipped AFTER that account
 * last saved is indistinguishable from one they hid, and this reads it as hidden.
 * That is the same ambiguity that caused the defect, met one final time. It is
 * bounded (it happens once), visible (the column picker lists hidden columns) and
 * recoverable in a click, which is what makes it a different thing from #341 —
 * that wrote a guess into shared data with nowhere to look afterwards.
 *
 * An explicit `[]` is a real answer ("nothing hidden"), not an absent one.
 */
export function hiddenFromLegacy(savedOrder, savedHidden, known) {
  if (Array.isArray(savedHidden)) return savedHidden;
  const saved = arr(savedOrder);
  if (saved.length === 0) return [];      // nothing saved — nothing was hidden
  return arr(known).filter(id => !saved.includes(id));
}
