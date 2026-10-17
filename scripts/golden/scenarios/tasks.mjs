// Goldens: tasks (GET, legacy bare-array POST, delta envelope POST) and every guard the
// POST runs: permission classification (src/taskActions.js), finish requests, stale-copy
// conflicts, schedule / overlap / tier rules, server-owned loggedHours, append-only moveLog,
// the resurrection guard, the empty-org guard, rule-events.json, session reactions on
// people.json, and the pushes / Ably publishes a write fires.
import { AUTH, orgSeed, ORG } from "../fixture-org.mjs";

const K = (f) => `orgs/${ORG}/${f}`;
const TK = K("tasks.json");
const PK = K("people.json");
const NOW = "2026-10-14T15:30:00.000Z";

const jobs = () => orgSeed()[TK];
const live = () => jobs().filter((j) => !j.deletedAt);

// Map every node (job, panel, op) through fn(node) by id; the others untouched.
const mapNodes = (list, id, fn) => list.map((n) => {
  if (!n || typeof n !== "object") return n;
  let out = String(n.id) === String(id) ? fn(n) : n;
  if (Array.isArray(out.subs)) out = { ...out, subs: mapNodes(out.subs, id, fn) };
  return out;
});
const edit = (id, fn, list = live()) => mapNodes(list, id, fn);
const job = (id, list = jobs()) => list.find((j) => j.id === id);

// Seeds.
const withTasks = (fn) => () => { const s = orgSeed(); s[TK] = fn(s[TK]); return s; };
const withPeople = (fn) => () => { const s = orgSeed(); s[PK] = fn(s[PK]); return s; };
const tier = (t) => () => { const s = orgSeed(); s[K("billing.json")] = { tier: t, lastModifiedAt: "2026-10-01T12:00:00.000Z" }; return s; };

// o2 carrying a pending finish request raised by Wendy.
const PENDING_FR = { id: "fr_2", by: "7", byName: "Wendy Wirer", at: "2026-10-14T14:00:00.000Z", status: "pending" };
const pendingOnO2 = (list) => mapNodes(list, "o2", (o) => ({ ...o, finishRequests: [PENDING_FR], pendingFinish: true }));
const pendingSeed = withTasks(pendingOnO2);
const pendingLive = () => pendingOnO2(live());

// Wendy clocked into o2 with a drain anchor (the session the reactions act on).
const clockOnO2 = (extra = {}) => withPeople((ps) => ps.map((p) => (p.id === "7" ? { ...p, activeJobClock: {
  clockIn: "2026-10-14T13:00:00.000Z", opId: "o2", panelId: "p1", jobId: "j1", sessionId: "s_wendy_1",
  reservoirOpId: "o2", drainCheckpoint: "2026-10-14T13:00:00.000Z", totalPausedMs: 0, pausedAt: null, ...extra,
} } : p)));

// Restricted admins built from Rita's grants.
const rp = AUTH.rita.adminPerms;
const moveOnly = { ...AUTH.rita, adminPerms: { ...rp, editJobs: false } };
const editOnly = { ...AUTH.rita, adminPerms: { ...rp, moveJobs: false } };
const noApprove = { ...AUTH.rita, adminPerms: { ...rp, approveCompletions: false } };

const OLD = "2026-09-20T00:00:00.000Z";   // older than every stored stamp
const post = (body, extra = {}) => ({ fn: "tasks", method: "POST", body, ...extra });
const moveO2 = (list = live(), entry = {}) => mapNodes(list, "o2", (o) => ({
  ...o, start: "2026-10-15", end: "2026-10-16",
  moveLog: [...(o.moveLog || []), { fromStart: "2026-10-13", fromEnd: "2026-10-14", toStart: "2026-10-15", toEnd: "2026-10-16", date: "2026-10-14", movedBy: "Ada Admin", reason: "Moved in schedule", ...entry }],
}));

export default [
  // ── GET ─────────────────────────────────────────────────────
  { name: "tasks GET as worker: tombstoned j0 filtered out", auth: AUTH.wendy, steps: [{ fn: "tasks", method: "GET" }] },
  { name: "tasks GET refusals: no token 401, failing token passed through, no X-Org-Code 400", auth: null, steps: [
    { fn: "tasks", method: "GET" },
    { fn: "tasks", method: "GET", auth: AUTH.ada, authFail: { status: 403, message: "Not a member of this org" } },
    { fn: "tasks", method: "GET", authFail: null, headers: { "x-org-code": null } },
  ] },
  { name: "tasks GET with no tasks.json yet: empty list", auth: AUTH.ada,
    seed: () => { const s = orgSeed(); delete s[TK]; return s; }, steps: [{ fn: "tasks", method: "GET" }] },
  { name: "tasks PUT: 405, OPTIONS: preflight", auth: AUTH.ada, steps: [{ fn: "tasks", method: "PUT", body: [] }, { fn: "tasks", method: "OPTIONS" }] },

  // ── POST shape ──────────────────────────────────────────────
  { name: "tasks POST refusals: no token 401, invalid JSON 400, non-envelope object 400", auth: null, steps: [
    post(live()), { ...post("{not json"), auth: AUTH.ada }, post({ jobs: [] }) ] },
  { name: "tasks POST no-ops: unchanged bare array (worker autosave); empty delta envelope by admin, then by worker", auth: AUTH.wendy,
    steps: [post(live()), { ...post({ upsert: [], delete: [] }), auth: AUTH.ada }, { ...post({ upsert: [], delete: [] }), auth: AUTH.wendy }] },
  { name: "tasks POST bare array: admin renames j2, stamps returned", auth: AUTH.ada,
    steps: [post(edit("j2", (j) => ({ ...j, title: "Crusher Retrofit Ph.2" })))] },
  { name: "tasks POST bare array: absence tombstones j2", auth: AUTH.ada, steps: [post(live().filter((j) => j.id !== "j2"))] },
  { name: "tasks POST bare array: admin adds j3 with a numeric job-level team (stringified, no assignment push)", auth: AUTH.ada,
    steps: [post([...live(), { id: "j3", title: "New Booster", jobNumber: "24-130", status: "Not Started", start: "2026-11-09", end: "2026-11-13", team: [99, 7], subs: [] }])] },
  { name: "tasks POST to an org with no tasks.json: first write stored", auth: AUTH.ada,
    seed: () => { const s = orgSeed(); delete s[TK]; return s; },
    steps: [post([{ id: "jn1", title: "First job", status: "Not Started", subs: [] }])] },

  // ── empty-org guard / force ─────────────────────────────────
  { name: "tasks POST that would empty the org: [] and a delete-everything delta are 409", auth: AUTH.ada,
    steps: [post([]), post({ upsert: [], delete: ["j1", "j2"] })] },
  { name: "tasks POST [] ?force=1: every job tombstoned", auth: AUTH.ada, steps: [post([], { query: { force: "1" } })] },
  { name: "tasks POST delta deleting every live job ?force=1", auth: AUTH.ada, steps: [post({ upsert: [], delete: ["j1", "j2"] }, { query: { force: "1" } })] },
  { name: "tasks POST [] to an org whose jobs are all tombstoned: allowed (nothing to protect)", auth: AUTH.ada,
    seed: withTasks((ts) => ts.map((j) => ({ ...j, deletedAt: j.deletedAt || "2026-10-01T00:00:00.000Z" }))), steps: [post([])] },

  // ── delta envelope ──────────────────────────────────────────
  { name: "tasks POST delta: upsert one job, absence deletes nothing", auth: AUTH.ada,
    steps: [post({ upsert: [{ ...job("j2"), notes: "rev 2" }] })] },
  { name: "tasks POST delta: delete j2, unknown id ignored, new j3 appended", auth: AUTH.ada,
    steps: [post({ upsert: [{ id: "j3", title: "Delta job", status: "Not Started", subs: [] }], delete: ["j2", "nope"] })] },
  { name: "tasks POST delta: upsert and delete the same id ends deleted", auth: AUTH.ada,
    steps: [post({ upsert: [{ ...job("j2"), title: "renamed" }], delete: ["j2"] })] },
  { name: "tasks POST delta: moveJobs-only admin upserting just j1 with a moved op", auth: moveOnly,
    steps: [post({ upsert: [job("j1", edit("o4", (o) => ({ ...o, start: "2026-10-20", end: "2026-10-22" })))] })] },
  { name: "tasks POST delta: schedule enforce, upserting only j2 while Wendy is clocked into o2", auth: AUTH.ada, env: { SCHEDULE_RULES_MODE: "enforce" },
    seed: clockOnO2(), steps: [post({ upsert: [{ ...job("j2"), notes: "j2 only" }] })] },

  // ── resurrection guard ──────────────────────────────────────
  { name: "resurrection: admin re-sends tombstoned j0 live (bare array, then delta): tombstone kept", auth: AUTH.ada, steps: [
    post([...live(), { ...job("j0"), deletedAt: undefined, title: "Cancelled bid (back?)" }]),
    post({ upsert: [{ ...job("j0"), deletedAt: null }] }),
  ] },

  // ── permission classification ───────────────────────────────
  { name: "perm: worker refusals (edit, move, delete by absence, delta delete, j0 re-sent live, attachment removal, engineering, sign-off)", auth: AUTH.wendy, steps: [
    post(edit("j1", (j) => ({ ...j, title: "Hacked" }))),
    post(edit("o4", (o) => ({ ...o, start: "2026-10-20", end: "2026-10-22" }))),
    post(live().filter((j) => j.id !== "j2")),
    post({ delete: ["j2"] }),
    post([...live(), { ...job("j0"), deletedAt: undefined }]),
    post(edit("p1", (p) => ({ ...p, attachments: [] }))),
    post(edit("p1", (p) => ({ ...p, engineering: { ...p.engineering, verified: { by: "7", byName: "Wendy Wirer", at: NOW } } }))),
    post(edit("p2", (p) => ({ ...p, signOffs: [{ step: "Torque", by: "7", at: NOW }] }))),
  ] },
  { name: "perm: worker appends an attachment to an op (allowed)", auth: AUTH.wendy,
    steps: [post(edit("o2", (o) => ({ ...o, attachments: [{ key: `orgs/${ORG}/attachments/QqQqQqQqQ-photo.jpg`, filename: "photo.jpg", mimeType: "image/jpeg", size: 50, uploadedById: "7", uploadedByName: "Wendy Wirer", uploadedAt: NOW }] })))] },
  { name: "perm: restricted admin refusals (Rita reassigns; moveJobs-only renames / forges a moveLog entry; editJobs-only moves; no approveCompletions finishes)", steps: [
    { ...post(edit("o4", (o) => ({ ...o, team: ["7"] }))), auth: AUTH.rita },
    { ...post(edit("o4", (o) => ({ ...o, title: "Renamed" }))), auth: moveOnly },
    { ...post(edit("o4", (o) => ({ ...o, moveLog: [{ fromStart: "2026-10-01", toStart: "2026-10-19", date: "2026-10-14", movedBy: "Rita" }] }))), auth: moveOnly },
    { ...post(edit("o4", (o) => ({ ...o, startHour: 8 }))), auth: editOnly },
    { ...post(edit("o4", (o) => ({ ...o, status: "Finished" }))), auth: noApprove },
  ] },
  { name: "perm: restricted admin moves and renames (editJobs + moveJobs held)", auth: AUTH.rita,
    steps: [post(edit("o4", (o) => ({ ...o, title: "Fab enclosure (SS)", start: "2026-10-20", end: "2026-10-22" })))] },
  { name: "perm: moveJobs-only admin moves an op (allowed)", auth: moveOnly, steps: [post(edit("o4", (o) => ({ ...o, start: "2026-10-20", end: "2026-10-22", hpd: 24 })))] },
  { name: "perm: status to Finished needs approveCompletions (granted to Rita)", auth: AUTH.rita,
    steps: [post(edit("o4", (o) => ({ ...o, status: "Finished" })))] },
  { name: "perm: status to a non-finished state is editJobs; team pushed", auth: noApprove,
    steps: [post(edit("o4", (o) => ({ ...o, status: "MTX FAT" })))] },
  { name: "perm: org-renamed finished status still needs approveCompletions", auth: noApprove,
    seed: () => { const s = orgSeed(); s[K("settings.json")].statusOpts = s[K("settings.json")].statusOpts.map((x) => (x.isFinished ? { ...x, name: "Shipped" } : x)); return s; },
    steps: [post(edit("o4", (o) => ({ ...o, status: "Shipped" })))] },

  // ── finish requests ─────────────────────────────────────────
  { name: "finish: worker raises a request for themself (allowed, no perm)", auth: AUTH.wendy,
    steps: [post(edit("o2", (o) => ({ ...o, finishRequests: [{ id: "fr_w1", by: "7", byName: "Wendy Wirer", at: NOW, status: "pending" }], pendingFinish: true })))] },
  { name: "finish: worker refusals (request for someone else; request born approved)", auth: AUTH.wendy, steps: [
    post(edit("o4", (o) => ({ ...o, finishRequests: [{ id: "fr_w2", by: "99", byName: "Sam Shop", at: NOW, status: "pending" }], pendingFinish: true }))),
    post(edit("o2", (o) => ({ ...o, finishRequests: [{ id: "fr_w3", by: "7", byName: "Wendy Wirer", at: NOW, status: "approved" }] }))),
  ] },
  { name: "finish: admin approves Wendy's request (finish + status pushes)", auth: AUTH.ada, seed: pendingSeed,
    steps: [post(mapNodes(pendingLive(), "o2", (o) => ({ ...o, status: "Finished", finishedAt: NOW, pendingFinish: false,
      finishRequests: [{ ...PENDING_FR, status: "approved", resolvedBy: "1", resolvedByName: "Ada Admin", resolvedAt: NOW }] })))] },
  { name: "finish: restricted admin with approveCompletions approves", auth: AUTH.rita, seed: pendingSeed,
    steps: [post(mapNodes(pendingLive(), "o2", (o) => ({ ...o, status: "Finished", finishedAt: NOW, pendingFinish: false,
      finishRequests: [{ ...PENDING_FR, status: "approved", resolvedBy: "12", resolvedByName: "Rita Restricted", resolvedAt: NOW }] })))] },
  { name: "finish: admin declines Wendy's request", auth: AUTH.ada, seed: pendingSeed,
    steps: [post(mapNodes(pendingLive(), "o2", (o) => ({ ...o, pendingFinish: false,
      finishRequests: [{ ...PENDING_FR, status: "declined", resolvedBy: "1", resolvedByName: "Ada Admin", resolvedAt: NOW, declineReason: "Labels missing" }] })))] },
  { name: "finish: worker approves own request -> 403", auth: AUTH.wendy, seed: pendingSeed,
    steps: [post(mapNodes(pendingLive(), "o2", (o) => ({ ...o, status: "Finished", pendingFinish: false,
      finishRequests: [{ ...PENDING_FR, status: "approved", resolvedBy: "7" }] })))] },
  { name: "finish: stale copy re-sends a decided request as pending (decision kept)", auth: AUTH.ada,
    steps: [post(edit("o1", (o) => ({ ...o, title: "Mount backpan (rev)", finishRequests: o.finishRequests.map((r) => ({ ...r, status: "pending", resolvedBy: undefined, resolvedByName: undefined, resolvedAt: undefined })) })))] },
  { name: "finish: admin client that omits finishRequests on o1 (absent entry kept)", auth: AUTH.ada,
    steps: [post(edit("o1", (o) => { const { finishRequests, ...rest } = o; return rest; }))] },
  { name: "finish: worker client that omits finishRequests on o1", auth: AUTH.wendy,
    steps: [post(edit("o1", (o) => { const { finishRequests, ...rest } = o; return rest; }))] },

  // ── stale-copy conflicts ────────────────────────────────────
  { name: "conflict log: stale j2 copy with a change goes through, recorded", auth: AUTH.ada,
    steps: [post(edit("j2", (j) => ({ ...j, title: "Crusher (stale)", lastModifiedAt: OLD })))] },
  { name: "conflict enforce: stale j2 copy kept as stored, conflicts listed", auth: AUTH.ada, env: { TASK_CONFLICT_MODE: "enforce" },
    steps: [post(edit("j2", (j) => ({ ...j, title: "Crusher (stale)", lastModifiedAt: OLD })))] },
  { name: "conflict enforce: stale stamp but identical content is not a conflict", auth: AUTH.ada, env: { TASK_CONFLICT_MODE: "enforce" },
    steps: [post(edit("j2", (j) => ({ ...j, lastModifiedAt: OLD })))] },
  { name: "conflict enforce: fresh j1 edit lands, stale j2 refused, in one write", auth: AUTH.ada, env: { TASK_CONFLICT_MODE: "enforce" },
    steps: [post(edit("j2", (j) => ({ ...j, notes: "stale", lastModifiedAt: OLD }), edit("j1", (j) => ({ ...j, notes: "fresh" }))))] },
  { name: "conflict enforce: loggedHours clobber on a fresh job beside a stale one", auth: AUTH.ada, env: { TASK_CONFLICT_MODE: "enforce" },
    seed: withTasks((ts) => mapNodes(ts, "j2", (j) => ({ ...j, loggedHours: 3 }))),
    steps: [post(edit("j2", (j) => ({ ...j, loggedHours: 0 }), edit("j1", (j) => ({ ...j, notes: "stale", lastModifiedAt: OLD }))))] },
  { name: "conflict off: no record, no conflicts key", auth: AUTH.ada, env: { TASK_CONFLICT_MODE: "off" },
    steps: [post(edit("j2", (j) => ({ ...j, title: "Crusher (stale)", lastModifiedAt: OLD })))] },
  { name: "conflict: second save with the returned stamp is not stale", auth: AUTH.ada, env: { TASK_CONFLICT_MODE: "enforce" },
    steps: [
      post(edit("j2", (j) => ({ ...j, notes: "one" }))),
      { ...post(edit("j2", (j) => ({ ...j, notes: "two", lastModifiedAt: "2026-10-14T15:30:00.000Z" }))), now: "2026-10-14T15:31:00.000Z" },
    ] },

  // ── schedule rules ──────────────────────────────────────────
  { name: "schedule enforce: department violation -> 422 with violations", auth: AUTH.ada, env: { SCHEDULE_RULES_MODE: "enforce" },
    steps: [post(edit("o2", (o) => ({ ...o, team: ["7", "99"] })))] },
  { name: "schedule log: department violation recorded, write goes through", auth: AUTH.ada,
    steps: [post(edit("o2", (o) => ({ ...o, team: ["7", "99"] })))] },
  { name: "schedule enforce: moving an op someone is clocked into -> 422 activeClock", auth: AUTH.ada, env: { SCHEDULE_RULES_MODE: "enforce" },
    seed: clockOnO2(), steps: [post(moveO2())] },
  { name: "schedule enforce: removing the job an active clock is under -> 422", auth: AUTH.ada, env: { SCHEDULE_RULES_MODE: "enforce" },
    seed: clockOnO2(), steps: [post(live().filter((j) => j.id !== "j1"))] },

  // ── overlap rule (Business only) ────────────────────────────
  { name: "overlap enforce on Business: double-booking Wendy -> 422", auth: AUTH.ada, env: { OVERLAP_RULE_MODE: "enforce" },
    steps: [post(edit("o4", (o) => ({ ...o, team: ["7"], start: "2026-10-14", end: "2026-10-14", startHour: 7, endHour: 11, hpd: 4 })))] },
  { name: "overlap log on Business: recorded as overlap-rule, saved", auth: AUTH.ada,
    steps: [post(edit("o4", (o) => ({ ...o, team: ["7"], start: "2026-10-14", end: "2026-10-14", startHour: 7, endHour: 11, hpd: 4 })))] },
  { name: "overlap enforce on Basic: rule off, tier rule logs the job layer", auth: AUTH.ada, env: { OVERLAP_RULE_MODE: "enforce" }, seed: tier("basic"),
    steps: [post(edit("o4", (o) => ({ ...o, team: ["7"], start: "2026-10-14", end: "2026-10-14", startHour: 7, endHour: 11, hpd: 4 })))] },

  // ── tier rule (Basic) ───────────────────────────────────────
  { name: "tier enforce on Basic: editing a nested job -> 403 tierRule", auth: AUTH.ada, env: { TIER_RULES_MODE: "enforce" }, seed: tier("basic"),
    steps: [post(edit("j1", (j) => ({ ...j, notes: "edited on basic" })))] },
  { name: "tier enforce on Basic: new panel job -> 403; flat shift job allowed", auth: AUTH.ada, env: { TIER_RULES_MODE: "enforce" }, seed: tier("basic"),
    steps: [
      post([...live(), { id: "jp", title: "Panel job", jobType: "panel", status: "Not Started", subs: [] }]),
      post([...live(), { id: "jg", title: "Shift", jobType: "general", status: "Not Started", subs: [{ id: "jg_1", title: "Day", team: ["7"], start: "2026-10-20", end: "2026-10-20" }] }]),
    ] },
  { name: "tier enforce on Basic: untouched stored nested job does not trip it", auth: AUTH.ada, env: { TIER_RULES_MODE: "enforce" }, seed: tier("basic"),
    steps: [post(edit("j2", (j) => ({ ...j, notes: "j2 only" })))] },
  { name: "tier enforce on an org with no billing.json (Basic by absence)", auth: AUTH.ada, env: { TIER_RULES_MODE: "enforce" },
    seed: () => { const s = orgSeed(); delete s[K("billing.json")]; return s; },
    steps: [post(edit("j1", (j) => ({ ...j, notes: "no billing" })))] },

  // ── X-Action-Source ─────────────────────────────────────────
  { name: "ai action source logged (newlines stripped)", auth: AUTH.ada,
    steps: [post(edit("j2", (j) => ({ ...j, notes: "by ai" })), { headers: { "X-Action-Source": "ai:move_job,assign_person\r\nextra" } })] },
  { name: "ai action source logged even on a refused write; non-ai source ignored", auth: AUTH.wendy,
    steps: [
      post(edit("j2", (j) => ({ ...j, notes: "by ai" })), { headers: { "x-action-source": "ai:update_job" } }),
      post(edit("j2", (j) => ({ ...j, notes: "by hand" })), { headers: { "x-action-source": "manual:drag" } }),
    ] },

  // ── server-owned / append-only ──────────────────────────────
  { name: "loggedHours is server-owned: admin's different values put back, worker's dropped key restored", auth: AUTH.ada, steps: [
    post(edit("o1", (o) => ({ ...o, loggedHours: 99 }), edit("p1", (p) => ({ ...p, loggedHours: 0 })))),
    { ...post(edit("j1", (j) => { const { loggedHours, ...rest } = j; return rest; })), auth: AUTH.wendy },
  ] },
  { name: "loggedHours on a new op keeps what it arrived with", auth: AUTH.ada,
    steps: [post(edit("p2", (p) => ({ ...p, subs: [...p.subs, { id: "o5", title: "Split half", status: "Not Started", start: "2026-10-22", end: "2026-10-22", team: ["99"], loggedHours: 0, splitFrom: "o4" }] })))] },
  { name: "moveLog append-only: client sends a truncated moveLog", auth: AUTH.ada,
    steps: [post(edit("o1", (o) => ({ ...o, notes: "touched", moveLog: [] })))] },
  { name: "moveLog append-only: client sends an edited, thinner entry", auth: AUTH.ada,
    steps: [post(edit("o1", (o) => ({ ...o, notes: "touched", moveLog: [{ ...o.moveLog[0], reason: "rewritten", fromStartHour: undefined }] })))] },
  { name: "moveLog append-only: worker re-sends a thinner entry with nothing else changed", auth: AUTH.wendy,
    steps: [post(edit("o1", (o) => ({ ...o, moveLog: [{ fromStart: "2026-10-09", toStart: "2026-10-12" }] })))] },
  { name: "moveLog: a move with an appended entry (day-move push to the team)", auth: AUTH.ada, steps: [post(moveO2())] },
  { name: "hpd 7.5 onto an unestimated job recorded with the user agent", auth: AUTH.ada,
    steps: [post(edit("j2", (j) => ({ ...j, hpd: 7.5 })), { headers: { "user-agent": "TRAQS/1.4 (iPhone; iOS 18.0)" } })] },

  // ── session reactions on people.json ────────────────────────
  { name: "session: someone else moves the op Wendy is clocked into -> drain rebaselined", auth: AUTH.ada,
    seed: clockOnO2({ totalPausedMs: 60000, pausedAt: "2026-10-14T15:00:00.000Z" }), steps: [post(moveO2())] },
  { name: "session: the session's own shrink entry does not rebaseline", auth: AUTH.ada,
    seed: clockOnO2(), steps: [post(moveO2(live(), { sessionId: "s_wendy_1" }))] },
  { name: "session: a finish request raised on the clocked op freezes the session", auth: AUTH.wendy,
    seed: clockOnO2(), steps: [post(edit("o2", (o) => ({ ...o, finishRequests: [{ id: "fr_w9", by: "7", byName: "Wendy Wirer", at: NOW, status: "pending" }], pendingFinish: true })))] },
  { name: "session: already frozen stays at its first instant", auth: AUTH.wendy,
    seed: clockOnO2({ frozenAtMs: 1760450000000 }), steps: [post(edit("o2", (o) => ({ ...o, finishRequests: [{ id: "fr_w9", by: "7", byName: "Wendy Wirer", at: NOW, status: "pending" }], pendingFinish: true })))] },

  // ── notifications ───────────────────────────────────────────
  { name: "notify: assign Sam to o3 and take Wendy off o2", auth: AUTH.ada,
    steps: [post(edit("o3", (o) => ({ ...o, team: ["99"] }), edit("o2", (o) => ({ ...o, team: [] }))))] },];
