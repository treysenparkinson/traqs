// Pure pieces of the Job Details page (scripts/job-detail-test.mjs).
import { copyForDuplicate } from "./copyRules.js";

// Sub-job number: the job number plus a two-digit index ("402006-01"). Empty when
// the job has no number, so the cell shows nothing rather than an invented one.
export const subJobNumber = (jobNumber, idx) =>
  jobNumber ? `${jobNumber}-${String(idx + 1).padStart(2, "0")}` : "";

// A copy of a job to start again from: same client, PM, priority, estimates and
// assignees, but fresh ids throughout (deps remapped onto them), every status
// back to Not Started, and NOTHING THAT RECORDS WHAT HAPPENED TO THE ORIGINAL.
//
// What that means is no longer decided here. `copyForDuplicate` owns it, shared
// with the split and the template, because this file having its own list is what
// let the three disagree: it dropped ten fields and carried `moveLog`, so a copy
// of 402057 was born with 201 move-log entries describing moves that happened to
// something else (#466). The engagement goes with the history now too -- the job
// number was already cleared so two jobs never share one, and the PO and the due
// date are the same kind of thing.
//
// Deleted panels and tasks are left behind.
export function duplicateJob(job, { uid, now, settings } = {}) {
  const idMap = new Map();
  const live = arr => (arr || []).filter(x => x && !x.deletedAt);
  const assign = node => { idMap.set(String(node.id), uid()); live(node.subs).forEach(assign); };
  assign(job);
  const remap = deps => (deps || []).map(d => idMap.get(String(d)) ?? d);
  const copy = node => {
    const out = { ...copyForDuplicate(node, { settings }),
      id: idMap.get(String(node.id)), status: "Not Started", deps: remap(node.deps) };
    if (node.subs) out.subs = live(node.subs).map(copy);
    return out;
  };
  const out = copy(job);
  out.title = `${job.title || "Job"} (copy)`;
  out.createdAt = now;
  return out;
}

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
