// The schedule's Select → Delete, as a plan and an application (#455).
//
// Delete was confirmed by "Delete 18 items? … cannot be undone" — a count and
// nothing else — where 18 was, at Matrix on 2026-10-08, every task on the
// schedule from today forward. That is not informed consent. The dialog now
// lists what goes, per job.
//
// THE LIST AND THE DELETE SHARE ONE WALK, so they cannot disagree. Selection ids
// are BAR ids; what is removed is whichever panels and operations carry those
// ids. Removing a panel removes every operation under it, and an id that matches
// no node removes nothing — so "what was selected" and "what goes" differ, and
// the dialog must say the second. `planBarDelete` reports exactly the nodes
// `applyBarDelete` drops.
//
// BEHAVIOUR IS UNCHANGED. `applyBarDelete` is the inline filter that lived in
// the dialog's Delete button, moved here verbatim: ids are matched with
// Set.has (strict), panels first, then operations of the panels that remain.
// Jobs themselves are never removed by this path.

/** The tree with every selected panel (and its operations) and operation removed. */
export function applyBarDelete(tasks, ids) {
  return tasks.map(job => ({
    ...job,
    subs: (job.subs || []).filter(panel => !ids.has(panel.id))
      .map(panel => ({ ...panel, subs: (panel.subs || []).filter(op => !ids.has(op.id)) })),
  }));
}

/**
 * What applyBarDelete(tasks, ids) removes, grouped by job, in tree order.
 * Each job row: { jobId, title, tasks, panels, titles } — `tasks` counts every
 * operation that goes (selected directly, or under a selected panel), `panels`
 * counts selected panels, `titles` names what goes (panels by title, then ops).
 */
export function planBarDelete(tasks, ids) {
  const jobs = [];
  let taskCount = 0, panelCount = 0;
  for (const job of tasks || []) {
    let t = 0, p = 0;
    const titles = [];
    for (const panel of job.subs || []) {
      if (ids.has(panel.id)) {
        p++;
        titles.push(panel.title || "Untitled");
        t += (panel.subs || []).length;
        continue;
      }
      for (const op of panel.subs || []) {
        if (ids.has(op.id)) { t++; titles.push(op.title || "Untitled"); }
      }
    }
    if (t || p) {
      jobs.push({ jobId: job.id, title: job.title || "Untitled job", tasks: t, panels: p, titles });
      taskCount += t; panelCount += p;
    }
  }
  return { jobs, tasks: taskCount, panels: panelCount };
}
