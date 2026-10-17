// Goldens: messages, message-reads, groups, timeoff.
import { AUTH, orgSeed, ORG } from "../fixture-org.mjs";

const K = (file) => `orgs/${ORG}/${file}`;
// A seed built from the fixture org with a change applied.
const seedWith = (fn) => () => { const s = orgSeed(); fn(s); return s; };

// Callers the fixture doesn't name.
const NORA = { personId: "14", isAdmin: true, adminPerms: null, email: "nora@testpanels.example", orgCode: ORG, canClockInOut: true, canSignOff: false, isEngineer: false };
const STRANGER = { ...AUTH.wendy, personId: null, email: "stranger@elsewhere.example" };
const GONE = { ...AUTH.wendy, personId: "15", email: "gone@testpanels.example" };

// Threads of every kind the ACL knows, plus ones it must refuse.
const T1 = "2026-10-11T15:00:00.000Z";
const allThreadsSeed = seedWith((s) => {
  s[K("messages.json")].push(
    { id: "m5", threadKey: "panel:p2", scope: "panel", jobId: "j1", panelId: "p2", text: "RTU drawings?", authorId: "99", authorName: "Sam Shop", participantIds: ["99"], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m6", threadKey: "op:o4", scope: "op", jobId: "j1", panelId: "p2", opId: "o4", text: "Enclosure in", authorId: "99", authorName: "Sam Shop", participantIds: [], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m7", threadKey: "group:Floor", scope: "group", text: "by group name", authorId: "1", authorName: "Ada Admin", participantIds: [], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m8", threadKey: "group:g_cr", scope: "group", text: "Approve o1?", authorId: "12", authorName: "Rita Restricted", participantIds: [], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m9", threadKey: "job:j2", scope: "job", jobId: "j2", text: "empty team", authorId: "1", authorName: "Ada Admin", participantIds: [], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m10", threadKey: "weird:x", scope: "job", text: "unknown kind", authorId: "1", authorName: "Ada Admin", participantIds: [], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m11", threadKey: "dm:7_99", scope: "dm", text: "cleared earlier", authorId: "7", authorName: "Wendy Wirer", participantIds: ["7", "99"], attachments: [], timestamp: T1, lastModifiedAt: T1, deletedAt: T1 },
    { id: "m12", threadKey: "dm:12_14", scope: "dm", text: "admins only", authorId: "12", authorName: "Rita Restricted", participantIds: ["12", "14"], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m13", threadKey: "job:j0", scope: "job", jobId: "j0", text: "tombstoned job", authorId: "1", authorName: "Ada Admin", participantIds: [], attachments: [], timestamp: T1, lastModifiedAt: T1 },
    { id: "m14", threadKey: "group:g_dead", scope: "group", text: "tombstoned group", authorId: "7", authorName: "Wendy Wirer", participantIds: [], attachments: [], timestamp: T1, lastModifiedAt: T1 },
  );
  s[K("groups.json")].push({ id: "g_dead", name: "Old crew", memberIds: ["7", 99], createdBy: "7", createdAt: "2026-09-01T00:00:00.000Z", deletedAt: "2026-09-02T00:00:00.000Z", lastModifiedAt: "2026-09-02T00:00:00.000Z" });
  s[K("tasks.json")][2].team = ["7"];   // j0 is tombstoned; a team on it must not grant access
  s[K("reads.json")] = {
    "dm:1_7": { "1": "2026-10-09T15:05:00.000Z", "7": "2026-10-09T15:00:00.000Z" },
    "job:j1": { "99": "2026-10-10T15:00:00.000Z" },
    "group:g_cr": { "1": "2026-10-11T15:00:00.000Z" },
    "group:g_floor": { "7": "2026-10-10T16:00:00.000Z" },
    "dm:12_14": { "12": T1 },
  };
});

const msg = (over) => ({ threadKey: "dm:1_7", scope: "dm", text: "On it", authorId: "7", authorName: "Wendy Wirer", authorColor: "#16a34a", participantIds: ["1", "7"], ...over });
const att = (i) => ({ key: `orgs/${ORG}/attachments/AAAAAAAA${i}-f${i}.png`, filename: `f${i}.png`, mimeType: "image/png", size: 100 + i });

// Groups helpers.
const groups = () => orgSeed()[K("groups.json")];
const gFloor = () => groups().find((g) => g.id === "g_floor");
const gCr = () => groups().find((g) => g.id === "g_cr");

// Time-off seeds.
const noApproversSeed = seedWith((s) => {
  for (const p of s[K("people.json")]) if (p.userRole === "admin") p.userRole = "user";
});
const groupedRequestSeed = seedWith((s) => {
  const r = s[K("timeoff.json")].find((x) => x.id === "to_b2");
  r.groupId = "g_to_b2";
  s[K("groups.json")].push({ id: "g_to_b2", name: "Time Off · Sam Shop · November 9", memberIds: [99, 1, "14"], createdBy: "99", createdAt: "2026-10-11T15:00:00.000Z" });
});
const patch = (body) => ({ fn: "timeoff", method: "PATCH", body });

export default [
  // ══ messages GET ════════════════════════════════════════════
  { name: "messages GET as admin Ada: dm + group, not job she isn't on", auth: AUTH.ada, seed: allThreadsSeed, steps: [{ fn: "messages", method: "GET" }] },
  { name: "messages GET as Wendy: dm, job/panel/op via job team, group by id and name", auth: AUTH.wendy, seed: allThreadsSeed, steps: [{ fn: "messages", method: "GET" }] },
  { name: "messages GET as Sam: job threads + group, not the 1_7 dm", auth: AUTH.sam, seed: allThreadsSeed, steps: [{ fn: "messages", method: "GET" }] },
  { name: "messages GET as Rita: completion group + own dm only", auth: AUTH.rita, seed: allThreadsSeed, steps: [{ fn: "messages", method: "GET" }] },
  { name: "messages GET: unknown email and tombstoned person's email both get []", auth: STRANGER, seed: allThreadsSeed, steps: [
    { fn: "messages", method: "GET" },
    { fn: "messages", method: "GET", auth: GONE },
  ] },
  { name: "messages edges: no token 401, missing org header 400, PUT 405", auth: null, steps: [
    { fn: "messages", method: "GET" },
    { fn: "messages", method: "GET", auth: AUTH.ada, headers: { "x-org-code": null } },
    { fn: "messages", method: "PUT", body: {} },
  ] },

  // ══ messages POST ═══════════════════════════════════════════
  { name: "messages POST dm then GET as the other participant", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "POST", body: msg({ text: "  On it  " }) },
    { fn: "messages", method: "GET", auth: AUTH.ada },
  ] },
  { name: "messages POST group thread: heading is group name, all members pushed", auth: AUTH.sam, steps: [
    { fn: "messages", method: "POST", body: msg({ threadKey: "group:g_floor", scope: "group", text: "Forklift free", authorId: 99, authorName: "Sam Shop", authorColor: undefined, participantIds: undefined }) },
  ] },
  { name: "messages POST job/op/panel threads: scope default, job+op heading, finish_request type", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "POST", body: { threadKey: "job:j1", jobId: "j1", text: "MCC-1 wired", authorId: "7", authorName: "Wendy Wirer" } },
    { fn: "messages", method: "POST", auth: AUTH.sam, body: { threadKey: "op:o4", scope: "op", jobId: "j1", panelId: "p2", opId: "o4", text: "Started fab", authorId: "99", authorName: "Sam Shop" } },
    { fn: "messages", method: "POST", auth: AUTH.wendy, body: { threadKey: "panel:p1", scope: "panel", jobId: "j1", panelId: "p1", text: "Panel done", authorId: "7", authorName: "Wendy Wirer", type: "finish_request", finishRequestId: "fr_9" } },
  ] },
  { name: "messages POST to a thread the caller isn't in: 403", auth: AUTH.sam, steps: [
    { fn: "messages", method: "POST", body: msg({ authorId: "99", authorName: "Sam Shop" }) },
    { fn: "messages", method: "POST", body: msg({ threadKey: "group:g_cr", scope: "group", authorId: "99" }) },
    { fn: "messages", method: "POST", body: msg({ threadKey: "weird:x", authorId: "99" }) },
  ] },
  { name: "messages POST identity: author spoofing 403, unknown email 403, no token 401", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "POST", body: msg({ authorId: "1", authorName: "Ada Admin" }) },
    { fn: "messages", method: "POST", body: msg({}), auth: STRANGER },
    { fn: "messages", method: "POST", body: msg({}), auth: null },
  ] },
  { name: "messages POST client ids: valid kept, invalid and duplicate replaced", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "POST", body: msg({ id: "  c_Web-123  ", text: "valid id" }) },
    { fn: "messages", method: "POST", body: msg({ id: "bad id!", text: "invalid id" }) },
    { fn: "messages", method: "POST", body: msg({ id: "m1", text: "duplicate id" }) },
    { fn: "messages", method: "POST", body: msg({ id: "x".repeat(65), text: "too long id" }) },
    { fn: "messages", method: "POST", body: msg({ id: 42, text: "numeric id" }) },
  ] },
  { name: "messages POST attachments: attachment-only allowed, capped at 10", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "POST", body: msg({ text: "   ", attachments: Array.from({ length: 12 }, (_, i) => att(i)) }) },
    { fn: "messages", method: "POST", body: msg({ text: "not an array", attachments: { key: "x" } }) },
  ] },
  { name: "messages POST validation: missing fields, bad JSON", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "POST", body: msg({ text: "  ", attachments: [] }) },
    { fn: "messages", method: "POST", body: msg({ threadKey: "" }) },
    { fn: "messages", method: "POST", body: msg({ authorId: undefined }) },
    { fn: "messages", method: "POST", body: "{not json" },
    { fn: "messages", method: "POST", body: "null" },
    { fn: "messages", method: "POST", body: msg({ text: "a".repeat(10001) }) },
    { fn: "messages", method: "POST", body: msg({ participantIds: Array.from({ length: 501 }, (_, i) => String(i)) }) },
  ] },
  { name: "messages POST participantIds stored verbatim, not used for recipients", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "POST", body: msg({ threadKey: "group:g_floor", scope: "group", participantIds: ["7", "made-up", 3] }) },
  ] },

  // ══ messages DELETE ?threadKey= ═════════════════════════════
  { name: "messages DELETE group by its creator (worker), then GET", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "DELETE", query: { threadKey: "group:g_floor" } },
    { fn: "messages", method: "GET" },
  ] },
  { name: "messages DELETE group by admin non-creator, by name, twice", auth: AUTH.ada, seed: allThreadsSeed, steps: [
    { fn: "messages", method: "DELETE", query: { threadKey: "group:Floor" } },
    { fn: "messages", method: "DELETE", query: { threadKey: "group:Floor" } },
  ] },
  { name: "messages DELETE group by non-creator worker refused", auth: AUTH.sam, steps: [
    { fn: "messages", method: "DELETE", query: { threadKey: "group:g_floor" } },
  ] },
  { name: "messages DELETE job thread: worker refused, admin allowed", auth: AUTH.wendy, steps: [
    { fn: "messages", method: "DELETE", query: { threadKey: "job:j1" } },
    { fn: "messages", method: "DELETE", query: { threadKey: "job:j1" }, auth: AUTH.ada },
    { fn: "messages", method: "GET", auth: AUTH.wendy },
  ] },
  { name: "messages DELETE by restricted admin on a job thread allowed", auth: AUTH.rita, steps: [
    { fn: "messages", method: "DELETE", query: { threadKey: "job:j1" } },
  ] },
  { name: "messages DELETE refused: dm even for admin, unknown kind/group, no threadKey, unknown viewer", auth: AUTH.ada, steps: [
    { fn: "messages", method: "DELETE", query: { threadKey: "dm:1_7" } },
    { fn: "messages", method: "DELETE", query: { threadKey: "weird:x" } },
    { fn: "messages", method: "DELETE", query: { threadKey: "group:nope" } },
    { fn: "messages", method: "DELETE" },
    { fn: "messages", method: "DELETE", query: { threadKey: "group:g_floor" }, auth: STRANGER },
  ] },

  // ══ message-reads ═══════════════════════════════════════════
  { name: "message-reads GET is ACL-filtered per viewer", auth: AUTH.ada, seed: allThreadsSeed, steps: [
    { fn: "message-reads", method: "GET" },
    { fn: "message-reads", method: "GET", auth: AUTH.wendy },
    { fn: "message-reads", method: "GET", auth: AUTH.sam },
    { fn: "message-reads", method: "GET", auth: AUTH.rita },
  ] },
  { name: "message-reads edges: no personId GET/POST, failing token, 405", auth: STRANGER, steps: [
    { fn: "message-reads", method: "GET" },
    { fn: "message-reads", method: "POST", body: { threadKey: "dm:1_7" } },
    { fn: "message-reads", method: "GET", auth: AUTH.wendy, authFail: { status: 401, message: "Token expired" } },
    { fn: "message-reads", method: "DELETE", authFail: null },
  ] },
  { name: "message-reads POST single: explicit at, default now, then GET", auth: AUTH.wendy, steps: [
    { fn: "message-reads", method: "POST", body: { threadKey: "job:j1", at: "2026-10-10T15:00:00.000Z" } },
    { fn: "message-reads", method: "POST", body: { threadKey: "group:g_floor" } },
    { fn: "message-reads", method: "GET" },
  ] },
  { name: "message-reads POST single: cursor never moves backwards", auth: AUTH.ada, steps: [
    { fn: "message-reads", method: "POST", body: { threadKey: "dm:1_7", at: "2026-10-01T00:00:00.000Z" } },
    { fn: "message-reads", method: "POST", body: { threadKey: "dm:1_7", at: "2026-10-09T15:05:00.000Z" } },
    { fn: "message-reads", method: "POST", body: { threadKey: "dm:1_7", at: "2026-10-12T00:00:00.000Z" } },
  ] },
  { name: "message-reads POST refusals: single not-participant 403, missing key 400, bad JSON 400; batch empty/all-skipped write nothing", auth: AUTH.sam, steps: [
    { fn: "message-reads", method: "POST", body: { threadKey: "dm:1_7" } },
    { fn: "message-reads", method: "POST", body: { at: "2026-10-12T00:00:00.000Z" } },
    { fn: "message-reads", method: "POST", body: "{oops" },
    { fn: "message-reads", method: "POST", body: { entries: [] } },
    { fn: "message-reads", method: "POST", body: { entries: [{ threadKey: "dm:1_7", at: "2026-10-13T00:00:00.000Z" }] } },
  ] },
  { name: "message-reads POST batch: invisible skipped, empty keys dropped, backwards ignored", auth: AUTH.wendy, steps: [
    { fn: "message-reads", method: "POST", body: { entries: [
      { threadKey: "dm:1_7", at: "2026-10-01T00:00:00.000Z" },
      { threadKey: "dm:1_7", at: "2026-10-13T00:00:00.000Z" },
      { threadKey: "job:j1", at: 12345 },
      { threadKey: "group:g_cr", at: "2026-10-13T00:00:00.000Z" },
      { threadKey: "" },
      null,
      { threadKey: "op:o2", at: "2026-10-13T01:00:00.000Z" },
    ] } },
    { fn: "message-reads", method: "GET" },
  ] },

  // ══ groups ══════════════════════════════════════════════════
  { name: "groups GET: members only, per viewer, tombstones hidden", auth: AUTH.ada, seed: allThreadsSeed, steps: [
    { fn: "groups", method: "GET" },
    { fn: "groups", method: "GET", auth: AUTH.wendy },
    { fn: "groups", method: "GET", auth: AUTH.rita },
    { fn: "groups", method: "GET", auth: STRANGER },
    { fn: "groups", method: "GET", auth: null },
  ] },
  { name: "groups POST: worker creates a group, then GET", auth: AUTH.wendy, steps: [
    { fn: "groups", method: "POST", body: [gFloor(), { id: "g_wire", name: "Wiring crew", memberIds: ["7", 99], createdBy: "7", createdAt: "2026-10-14T15:30:00.000Z" }] },
    { fn: "groups", method: "GET", auth: AUTH.sam },
  ] },
  { name: "groups POST: creator renames and changes members", auth: AUTH.wendy, steps: [
    { fn: "groups", method: "POST", body: [{ ...gFloor(), name: "Shop Floor", memberIds: ["7", 99] }] },
  ] },
  { name: "groups POST: non-creator edit and omission ignored, edits to groups the poster isn't in dropped", auth: AUTH.sam, steps: [
    { fn: "groups", method: "POST", body: [{ ...gFloor(), name: "Sam's floor" }] },
    { fn: "groups", method: "POST", body: [{ id: "g_sam", name: "Sam solo", memberIds: [99], createdBy: "99" }] },
    { fn: "groups", method: "POST", body: [gFloor(), { id: "g_sam", name: "Sam solo", memberIds: [99], createdBy: "99" }, { ...gCr(), name: "hacked", memberIds: [99] }] },
    { fn: "groups", method: "GET" },
  ] },
  { name: "groups POST: admin edits a group she didn't create and tombstones by omission", auth: AUTH.ada, steps: [
    { fn: "groups", method: "POST", body: [gCr(), { ...gFloor(), name: "Floor (admin)" }] },
    { fn: "groups", method: "POST", body: [gCr()] },
    { fn: "groups", method: "GET" },
  ] },
  { name: "groups POST: stale client cannot resurrect a tombstoned group", auth: AUTH.wendy, seed: allThreadsSeed, steps: [
    { fn: "groups", method: "POST", body: [gFloor(), { id: "g_dead", name: "Old crew", memberIds: ["7", 99], createdBy: "7" }] },
  ] },
  { name: "groups POST: group with no creator is admin-only", auth: AUTH.wendy, seed: seedWith((s) => { delete s[K("groups.json")][1].createdBy; }), steps: [
    { fn: "groups", method: "POST", body: [{ ...gFloor(), createdBy: undefined, name: "worker rename" }] },
    { fn: "groups", method: "POST", body: [gCr(), { ...gFloor(), createdBy: undefined, name: "admin rename" }], auth: AUTH.ada },
  ] },
  { name: "groups POST empty: 409 when visible groups would empty, force=1 bypasses", auth: AUTH.wendy, steps: [
    { fn: "groups", method: "POST", body: [] },
    { fn: "groups", method: "POST", body: [], query: { force: "1" } },
    { fn: "groups", method: "GET" },
  ] },
  { name: "groups POST empty by non-creator: 409, force keeps the group anyway", auth: AUTH.sam, steps: [
    { fn: "groups", method: "POST", body: [] },
    { fn: "groups", method: "POST", body: [], query: { force: "1" } },
  ] },
  { name: "groups POST empty from someone in no groups is allowed", auth: AUTH.rita, seed: seedWith((s) => { s[K("groups.json")][0].memberIds = [1]; }), steps: [
    { fn: "groups", method: "POST", body: [] },
  ] },
  { name: "groups POST validation: not an array, bad JSON, no token", auth: AUTH.ada, steps: [
    { fn: "groups", method: "POST", body: { id: "g_x" } },
    { fn: "groups", method: "POST", body: "{nope" },
    { fn: "groups", method: "POST", body: [], auth: null },
    { fn: "groups", method: "PATCH", body: [], auth: AUTH.ada },
  ] },
  { name: "groups ensure-completion: worker joins existing group, approvers backfilled, repeat is a no-op, no person record 403", auth: AUTH.wendy, steps: [
    { fn: "groups", method: "POST", query: { action: "ensure-completion" } },
    { fn: "groups", method: "POST", query: { action: "ensure-completion" } },
    { fn: "groups", method: "POST", query: { action: "ensure-completion" }, auth: STRANGER },
  ] },
  { name: "groups ensure-completion: past requester kept, others reconciled out", auth: AUTH.ada,
    seed: seedWith((s) => {
      s[K("groups.json")][0].memberIds = [1, "12", "14", 99, "7"];
      s[K("messages.json")].push({ id: "m_fr", threadKey: "group:g_cr", scope: "group", type: "finish_request", finishRequestId: "fr_2", text: "Done?", authorId: "99", authorName: "Sam Shop", participantIds: [], attachments: [], timestamp: T1 });
    }),
    steps: [{ fn: "groups", method: "POST", query: { action: "ensure-completion" } }] },
  { name: "groups ensure-completion: creates the group when none exists", auth: AUTH.sam,
    seed: seedWith((s) => { s[K("groups.json")] = s[K("groups.json")].filter((g) => g.id !== "g_cr"); }),
    steps: [{ fn: "groups", method: "POST", query: { action: "ensure-completion" } }, { fn: "groups", method: "GET" }] },
  { name: "groups ensure-completion: no approver in the org", auth: AUTH.wendy, seed: noApproversSeed,
    steps: [{ fn: "groups", method: "POST", query: { action: "ensure-completion" } }] },

  // ══ timeoff GET / POST ══════════════════════════════════════
  { name: "timeoff GET: admins see all, workers see own", auth: AUTH.ada, steps: [
    { fn: "timeoff", method: "GET" },
    { fn: "timeoff", method: "GET", auth: AUTH.rita },
    { fn: "timeoff", method: "GET", auth: AUTH.wendy },
    { fn: "timeoff", method: "GET", auth: AUTH.sam },
    { fn: "timeoff", method: "GET", auth: null },
  ] },
  { name: "timeoff POST: worker request creates group + bubble + pushes, then admin sees it", auth: AUTH.wendy, steps: [
    { fn: "timeoff", method: "POST", body: { type: "pto", start: "2026-11-02", end: "2026-11-04", note: "  Family trip  " } },
    { fn: "timeoff", method: "GET", auth: AUTH.ada },
    { fn: "messages", method: "GET", auth: NORA },
    { fn: "groups", method: "GET", auth: AUTH.wendy },
  ] },
  // The new request's id is makeId() under the frozen clock + seeded Math.random (groupId is
  // drawn first): stable across runs, so the follow-up PATCH can name it.
  { name: "timeoff POST then approve the new request by id", auth: AUTH.wendy, steps: [
    { fn: "timeoff", method: "POST", body: { type: "PTO", start: "2026-11-02", end: "2026-11-02" } },
    { ...patch({ id: "mv89ne8003jmyl", action: "approve" }), auth: AUTH.ada, now: "2026-10-14T16:00:00.000Z" },
  ] },
  { name: "timeoff POST: admin requesting is left out of the approvers", auth: AUTH.ada, steps: [
    { fn: "timeoff", method: "POST", body: { type: "UTO", start: "2026-12-24", end: "2026-12-24" } },
  ] },
  { name: "timeoff POST: no approvers, no group, no push", auth: AUTH.sam, seed: noApproversSeed, steps: [
    { fn: "timeoff", method: "POST", body: { type: "UTO", start: "2026-11-16", end: "2026-11-17", note: "" } },
  ] },
  { name: "timeoff POST validation", auth: AUTH.wendy, steps: [
    { fn: "timeoff", method: "POST", body: { type: "SICK", start: "2026-11-02", end: "2026-11-02" } },
    { fn: "timeoff", method: "POST", body: { type: "PTO", start: "11/02/2026", end: "2026-11-02" } },
    { fn: "timeoff", method: "POST", body: { type: "PTO", start: "2026-11-05", end: "2026-11-02" } },
    { fn: "timeoff", method: "POST", body: { type: "PTO", start: "2026-11-02", end: "2026-11-02", note: "n".repeat(501) } },
    { fn: "timeoff", method: "POST", body: "{bad" },
    { fn: "timeoff", method: "POST", body: { type: "PTO", start: "2026-11-02", end: "2026-11-02" }, auth: STRANGER },
  ] },

  // ══ timeoff PATCH ═══════════════════════════════════════════
  { name: "timeoff approve: writes person.timeOff with reqId", auth: AUTH.ada, steps: [
    patch({ id: "to_b2", action: "APPROVE" }),
    { fn: "timeoff", method: "GET", auth: AUTH.sam },
  ] },
  { name: "timeoff approve an already-approved request (expected-status precondition)", auth: AUTH.ada, steps: [
    patch({ id: "to_a1", action: "approve" }),
  ] },
  { name: "timeoff deny with reason, then edit of the closed request refused", auth: NORA, steps: [
    patch({ id: "to_b2", action: "deny", reason: "  Short-staffed that week  " }),
    { ...patch({ id: "to_b2", action: "edit", start: "2026-11-10", end: "2026-11-10" }), auth: AUTH.sam },
  ] },
  { name: "timeoff deny an approved request without reason: person.timeOff untouched", auth: AUTH.ada, steps: [
    patch({ id: "to_a1", action: "deny" }),
  ] },
  { name: "timeoff reopen: approved pulls the entry, denied just resets, pending refused", auth: AUTH.ada, steps: [
    patch({ id: "to_a1", action: "reopen" }),
    patch({ id: "to_b2", action: "reopen" }),
    patch({ id: "to_b2", action: "deny", reason: "no" }),
    patch({ id: "to_b2", action: "reopen" }),
  ] },
  { name: "timeoff cancel by owner of an approved request removes the entry", auth: AUTH.wendy, steps: [
    patch({ id: "to_a1", action: "cancel" }),
    { fn: "timeoff", method: "GET" },
  ] },
  { name: "timeoff cancel someone else's: worker refused, admin allowed", auth: AUTH.wendy, steps: [
    patch({ id: "to_b2", action: "cancel" }),
    { ...patch({ id: "to_b2", action: "cancel" }), auth: AUTH.rita },
    { ...patch({ id: "to_b2", action: "approve" }), auth: AUTH.ada },
  ] },
  { name: "timeoff edit dates of an approved request: back to pending, entry removed", auth: AUTH.wendy, steps: [
    patch({ id: "to_a1", action: "edit", start: "2026-10-22", end: "2026-10-23" }),
  ] },
  { name: "timeoff edit type/note only on approved: entry rewritten in place", auth: AUTH.wendy, steps: [
    patch({ id: "to_a1", action: "edit", type: "uto", note: "Dentist (unpaid)" }),
  ] },
  { name: "timeoff edit dates with reapprove:false by admin: stays approved, entry rewritten", auth: AUTH.ada, steps: [
    patch({ id: "to_a1", action: "edit", start: "2026-10-27", end: "2026-10-27", reapprove: false }),
  ] },
  { name: "timeoff edit flow with a group thread: approve, move dates, bubble re-posted", auth: AUTH.ada, seed: groupedRequestSeed, steps: [
    patch({ id: "to_b2", action: "approve" }),
    { ...patch({ id: "to_b2", action: "edit", start: "2026-11-12", end: "2026-11-13", note: "moved" }), auth: AUTH.sam },
    { fn: "messages", method: "GET", auth: AUTH.ada },
  ] },
  { name: "timeoff PATCH refusals: restricted admin/worker can't decide, edit validation + someone else's, missing id, unknown action, long reason, unknown id, 405", auth: AUTH.sam, steps: [
    { ...patch({ id: "to_b2", action: "approve" }), auth: AUTH.rita },
    { ...patch({ id: "to_a1", action: "reopen" }), auth: AUTH.rita },
    { ...patch({ id: "to_b2", action: "approve" }), auth: AUTH.sam },
    { ...patch({ id: "to_b2", action: "deny" }), auth: AUTH.wendy },
    { ...patch({ id: "to_a1", action: "edit", start: "2026-10-22" }), auth: AUTH.sam },
    patch({ id: "to_b2", action: "edit", start: "2026-11-10", end: "2026-11-09" }),
    patch({ id: "to_b2", action: "edit", type: "VAC" }),
    patch({ id: "to_b2", action: "edit", start: "bad" }),
    patch({ id: "to_b2", action: "edit", note: "x".repeat(501) }),
    { ...patch({ action: "approve" }), auth: AUTH.ada },
    patch({ id: "to_b2", action: "archive" }),
    patch({ id: "to_b2", action: "deny", reason: "r".repeat(501) }),
    patch({ id: "to_nope", action: "approve" }),
    { fn: "timeoff", method: "PATCH", body: "{bad" },
    { fn: "timeoff", method: "DELETE" },
  ] },
];
