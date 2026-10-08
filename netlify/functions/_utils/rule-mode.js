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
//   (PERMISSION_GATES_MODE was root cause 4's switch, across /tasks and
//    /clients. RETIRED 2026-10-08 after days on `enforce` in production: the
//    legacy classifier it chose between is deleted, the /clients no-op allowance
//    it gated is unconditional, and no code reads the variable. It can be removed
//    from the Netlify environment. Noted here rather than deleted outright
//    because `ruleMode` returns "log" for an ABSENT variable, so a flag that is
//    still read somewhere unnoticed fails quietly in the permissive direction —
//    which is exactly how this one nearly took /clients down with it.)
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
