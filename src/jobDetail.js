// Pure pieces of the Job Details page (scripts/job-detail-test.mjs).
// `duplicateJob` lived here until 2026-10-08 and was removed with the Duplicate
// button (#486) — it had one caller, which had one call site.

// Sub-job number: the job number plus a two-digit index ("402006-01"). Empty when
// the job has no number, so the cell shows nothing rather than an invented one.
export const subJobNumber = (jobNumber, idx) =>
  jobNumber ? `${jobNumber}-${String(idx + 1).padStart(2, "0")}` : "";


// The production sessions recorded against a job, newest first. Matched on any
// level -- a session carries all three ids, but older rows or ones written against
// a panel or task directly may not carry jobId. Deleted and zero-hour rows drop.
export function jobSessions(job, productionHours, sameId) {
  const opIds = new Set((job.subs || []).flatMap(p => (p.subs || []).map(o => String(o.id))));
  const panelIds = new Set((job.subs || []).map(p => String(p.id)));
  return (productionHours || [])
    .filter(s => s && !s.deletedAt && (Number(s.hours) || 0) > 0
      && (sameId(s.jobId, job.id) || opIds.has(String(s.opId)) || panelIds.has(String(s.panelId))))
    .sort((a, b) => String(b.clockIn || b.date || "").localeCompare(String(a.clockIn || a.date || "")));
}

// Hours per person across those sessions, largest first. pid is a string.
export function crewHours(rows) {
  const by = new Map();
  rows.forEach(r => { const k = String(r.personId); by.set(k, (by.get(k) || 0) + (Number(r.hours) || 0)); });
  return [...by.entries()].map(([pid, h]) => ({ pid, h })).sort((a, b) => b.h - a.h);
}
