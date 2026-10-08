// MOVE HISTORY IS APPEND-ONLY, AND THE SERVER HOLDS CLIENTS TO IT (#465).
//
// #458: Max attached a photo from an iOS build whose `MoveLogEntry` models a
// SUBSET of the fields the web writes. `saveJobs` re-encodes the whole `[Job]`
// array on any edit, so that one upload rewrote every entry on the board and
// dropped `fromStartHour`, `toStartHour`, `fromEndHour`, `toEndHour`,
// `fromTeam`, `toTeam`, `fromHpd`, `toHpd`, `fromDepartments` and
// `toDepartments` from 281 of 283 entries. The record of WHO a move reassigned
// and at WHAT HOUR, gone — and five server-side instruments ran on that write
// and found nothing, because none of them watches move history.
//
// THE RULE. For a node that already exists in storage, every stored entry must
// survive the write intact: an incoming entry may ADD fields, never drop or
// change them, and the array may GROW, never shrink.
//
// WHY IT HAS NO FALSE POSITIVES, checked against every write path in the
// product rather than assumed: each is `[...(existing || []), newEntry]`, a pure
// append. The single exception is `dragMove.js`'s split, which writes
// `moveLog: [goLog]` onto a BRAND-NEW node with a new id — and a node with no
// stored counterpart is never examined here.
//
// IT DOES NOT ASK iOS TO MODEL MORE. A thinner entry a client APPENDS passes
// through untouched; only entries that already exist are protected. The rule
// stops a client rewriting history without requiring it to understand history.
//
// MATCHED BY POSITION, because that is the only thing that survives the damage.
// The re-encode rewrote each entry in place, so order held; and two identical
// drags on one op produce entries whose every surviving field is equal, which no
// content key can tell apart. `recover-movelog-fields.mjs` reached 283 of 283
// by index where an identity match left 125 ambiguous.
//
// WHAT THIS DOES NOT CLOSE — stated here because the next reader will want to
// know how wide the backstop is. **It does not protect `status`.** #458 also
// flattened 39 job statuses, and no server-side rule can recover that: a status
// is not pinnable, since a user changing one is the normal case, and nothing in
// a request distinguishes "the user chose Not Started" from "my enum could not
// say anything else" — both arrive as a legal member of the org's own list. The
// defences there are the iOS fix (#447) and whoever installs it.

/**
 * Restore every stored moveLog entry the incoming tree narrowed, truncated or
 * rewrote. Returns the same array by identity when nothing changed, because the
 * conflict check and `stampArray` both compare content and handing them fresh
 * objects for untouched nodes would turn every save into a change.
 *
 * `kept` collects one record per repaired entry, for the durable rule log.
 */
export function keepMoveLogDetail(nodes, storedIdx, kept) {
  if (!Array.isArray(nodes)) return nodes;
  let moved = false;
  const out = nodes.map((n) => {
    if (!n || typeof n !== "object") return n;
    let next = n;

    const was = n.id != null ? storedIdx.get(String(n.id)) : null;
    const storedLog = Array.isArray(was?.moveLog) ? was.moveLog : null;
    if (storedLog && storedLog.length) {
      const mine = Array.isArray(n.moveLog) ? n.moveLog : [];
      const repaired = [];
      // `mine` is [] whenever the incoming moveLog is absent or not an array, so
      // a short array covers those cases too — this block is only entered when
      // `storedLog.length` is non-zero. An `|| !Array.isArray(n.moveLog)` stood
      // here and mutation proved it could never be the deciding term.
      let changed = mine.length < storedLog.length;
      for (let i = 0; i < Math.max(mine.length, storedLog.length); i++) {
        const s = storedLog[i], m = mine[i];
        if (i >= storedLog.length) { repaired.push(m); continue; }   // appended — untouched
        if (!s || typeof s !== "object") { repaired.push(s); continue; }
        if (!m || typeof m !== "object") { repaired.push(s); changed = true; continue; }
        let entry = m, fixedHere = 0;
        for (const k of Object.keys(s)) {
          if (k in m && JSON.stringify(m[k]) === JSON.stringify(s[k])) continue;
          if (entry === m) entry = { ...m };
          entry[k] = s[k];
          fixedHere++;
        }
        if (fixedHere) {
          changed = true;
          kept.push({ id: String(n.id), index: i, fields: fixedHere });
        }
        repaired.push(entry);
      }
      if (changed) { next = { ...n, moveLog: repaired }; }
    }

    if (Array.isArray(n.subs)) {
      const subs = keepMoveLogDetail(n.subs, storedIdx, kept);
      if (subs !== n.subs) { if (next === n) next = { ...n }; next.subs = subs; }
    }
    if (next !== n) moved = true;
    return next;
  });
  return moved ? out : nodes;
}
