// Rollout switch for server-side refusals (SCHEDULE_MAP root cause 3).
//
// Every new refusal ships in "log" first: the write goes through exactly as it
// did before, and the server records what it WOULD have refused, so the logs
// show what live clients actually trip before anything is turned on.
//
//   SCHEDULE_RULES_MODE — schedule rules on /tasks and the session-field guards
//                         (updateJobSession, people PATCH, the shrink startHour)
//   TASK_CONFLICT_MODE  — the per-job stale-copy check on /tasks
//   OVERLAP_RULE_MODE   — the one overlap rule on /tasks (src/overlapRules.js),
//                         Business orgs only
//   PERMISSION_GATES_MODE — root cause 4's permission changes, loosening and
//                         tightening alike: in log both behave exactly as before
//                         and the change is only recorded
//   IDENTITY_PROVIDER_MODE — the org's identity-provider allowlist, checked in
//                         requireOrgMember (tag `identity-provider`)
//
// Values: off | log | enforce. Unset or unrecognised means log. Read per call,
// so a change to the Netlify env takes effect on the next deploy without code.
const MODES = new Set(["off", "log", "enforce"]);

export function ruleMode(envName) {
  const v = String(process.env[envName] ?? "").trim().toLowerCase();
  return MODES.has(v) ? v : "log";
}

/** One JSON line per event, greppable in the Netlify function log by `tag`. */
export function logRule(tag, fields) {
  console.warn(JSON.stringify({ tag, at: new Date().toISOString(), ...fields }));
}
