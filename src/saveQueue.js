// Run an async function so that it never overlaps itself (#388).
//
// WHY THIS EXISTS. `doSave` POSTs the whole task tree and, since #337, adopts
// the `lastModifiedAt` the server hands back so the NEXT save compares against
// what is actually stored. That adoption happens when the response arrives — so
// any save STARTED before the previous one's response lands carries the stamp
// from before it, and the server correctly reports it as stale.
//
// Nothing stopped that. doSave's ~22 explicit call sites each fire
// `setTimeout(() => doSaveRef.current(), 0)` immediately after a `setTasks`, so
// two drags inside one round trip produce two overlapping saves, the second
// stale by construction. On 2026-10-06 that was twenty task-conflict records in
// a day, every one of them caller 99 — one client conflicting with itself, with
// staleness of −455ms to −664ms rather than the hours a genuinely stale tab
// shows. #387 made the client RECOVER from the refusal; this removes the cause.
//
// THE CONTRACT:
//   - a call made while a run is in flight does not start a second run
//   - it schedules EXACTLY ONE follow-up, however many calls arrive. A burst of
//     drags during a slow round trip coalesces into one save, not one per drag,
//     because each run already sends the whole tree as it stands when it starts
//   - a FAILED run still runs the queued follow-up. Otherwise an edit made
//     during a failed round trip is dropped with nothing left to re-arm it: the
//     debounce that would have re-armed it was cancelled when that save began
//
// NOT A LOCK AND NOT A QUEUE OF WORK. It holds one boolean, not a list of
// pending saves, because the work is always "send the current state" — two
// queued saves would send the same thing twice.

/**
 * Wrap `fn` so it never runs concurrently with itself.
 * @param {(...a: any[]) => Promise<any>} fn
 * @returns {(...a: any[]) => Promise<void>} the serialised runner
 */
export function serializeRuns(fn) {
  let running = false;
  let dirty = false;
  return async function run(...args) {
    // Mid-flight: record that another run is wanted and return. The caller is a
    // fire-and-forget `setTimeout`, so there is nothing to await and nothing to
    // tell; the follow-up below is the answer.
    if (running) { dirty = true; return; }
    running = true;
    let failure = null;
    try {
      // A loop rather than recursion: a long burst of drags would otherwise
      // nest one promise frame per save.
      do {
        // Cleared BEFORE the run, not after. A call arriving while fn is in
        // flight must set it again and get its own follow-up; clearing
        // afterwards would swallow exactly the edits this exists to catch.
        dirty = false;
        // Reset each time, so the verdict reported below is the LAST run's. A
        // first attempt that failed and a retry that worked is a success, and
        // reporting the stale failure would raise saveError over saved data.
        failure = null;
        try { await fn(...args); }
        catch (err) { failure = err; }   // caught, not thrown: the queue must drain
      } while (dirty);
    } finally {
      // In `finally` so a throw from anywhere above cannot strand the flag true
      // and wedge every later save.
      running = false;
    }
    if (failure) throw failure;
  };
}
