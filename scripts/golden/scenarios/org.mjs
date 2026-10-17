// Goldens: sync, org, org-config, org-lookup, forgot-org, invite, attachment, notify,
// push-subscribe, ably-token, migrate-timeclock.
import { AUTH, orgSeed, ORG } from "../fixture-org.mjs";

const K = (file) => `orgs/${ORG}/${file}`;
// orgSeed() plus a mutation (and/or extra keys for other orgs).
const seedWith = (mut, extra = {}) => () => { const s = orgSeed(); mut?.(s); return { ...s, ...extra }; };
const T0 = "2026-10-01T12:00:00.000Z";

// ── callers the fixture doesn't ship ─────────────────────────
// A founding admin: listed in config.adminEmails, no people row yet.
const OWNER = { personId: null, isAdmin: true, adminPerms: null, email: "owner@testpanels.example", orgCode: ORG, canClockInOut: true, canSignOff: false, isEngineer: false };
// The invitee of the seeded live invite inv_1, before they have a person row.
const NEWHIRE = { personId: null, isAdmin: false, adminPerms: null, email: "newhire@testpanels.example", orgCode: ORG, canClockInOut: true, canSignOff: false, isEngineer: false };
const ADA_GOOGLE = { ...AUTH.ada, payload: { sub: "google-oauth2|ada123" } };

// ── other orgs, for the cross-org scans ──────────────────────
const OTHER_ORGS = {
  // Same email domain, Wendy IS on its roster; owner@ is a second admin (mixed case).
  "orgs/OTHERORG/config.json": { name: "Other Fab LLC", domain: "testpanels.example", adminEmail: "boss@other.example",
    adminEmails: ["boss@other.example", "OWNER@testpanels.example"], createdAt: "2026-02-01T00:00:00.000Z", lastModifiedAt: T0 },
  "orgs/OTHERORG/people.json": [{ id: 1, name: "Wendy at Other", email: "Wendy@testpanels.example", userRole: "user", lastModifiedAt: T0 }],
  // Same email domain, Wendy is NOT on its roster.
  "orgs/THIRDORG/config.json": { name: "Third Works", domain: "testpanels.example", adminEmail: "third@third.example", createdAt: "2026-03-01T00:00:00.000Z", lastModifiedAt: T0 },
  "orgs/THIRDORG/people.json": [{ id: 1, name: "Somebody", email: "somebody@testpanels.example", userRole: "user", lastModifiedAt: T0 }],
  // Soft-deleted org whose admin is Wendy and owner@.
  "orgs/DELORG/config.json": { name: "Deleted Demo", domain: "", adminEmail: "wendy@testpanels.example", adminEmails: ["owner@testpanels.example"],
    createdAt: "2026-04-01T00:00:00.000Z", deletedAt: "2026-09-30T00:00:00.000Z", lastModifiedAt: "2026-09-30T00:00:00.000Z" },
  // A people file but no config: skipped by every scan.
  "orgs/NOCFGORG/people.json": [{ id: 1, name: "Orphan", email: "wendy@testpanels.example" }],
};

// ── sync: a seed with tombstones and ACL-relevant rows stamped after the delta cursor ──
const SINCE = "2026-10-11T00:00:00.000Z";
const LATE = "2026-10-13T09:00:00.000Z";
const syncDeltaSeed = seedWith((s) => {
  s[K("tasks.json")].push({ id: "j9", title: "Scrapped quote", status: "Not Started", subs: [], deletedAt: LATE, lastModifiedAt: LATE });
  s[K("people.json")].push({ id: "16", name: "Left Recently", email: "left@testpanels.example", userRole: "user", pin: "2222", cap: 8, timeOff: [], deletedAt: LATE, lastModifiedAt: LATE });
  s[K("clients.json")][1] = { ...s[K("clients.json")][1], notes: "net 60", lastModifiedAt: LATE };
  s[K("messages.json")].push(
    { id: "m5", threadKey: "dm:1_7", scope: "dm", text: "", authorId: "1", participantIds: ["1", "7"], attachments: [], timestamp: LATE, deletedAt: LATE, lastModifiedAt: LATE },
    { id: "m6", threadKey: "dm:1_99", scope: "dm", text: "Sam only", authorId: "1", participantIds: ["1", "99"], attachments: [], timestamp: LATE, lastModifiedAt: LATE },
    { id: "m7", threadKey: "group:g_admins", scope: "group", text: "admins only", authorId: "1", participantIds: [], attachments: [], timestamp: LATE, lastModifiedAt: LATE },
  );
  s[K("groups.json")].push(
    { id: "g_old", name: "Old Crew", memberIds: ["7", 1], createdBy: 1, createdAt: T0, deletedAt: LATE, lastModifiedAt: LATE },
    { id: "g_admins", name: "Admins", memberIds: [1, "12"], createdBy: 1, createdAt: LATE, lastModifiedAt: LATE },
  );
  s[K("payhours.json")].push({ id: "tc_c", personId: 99, date: "2026-10-13", clockIn: "2026-10-13T13:00:00.000Z", clockOut: "2026-10-13T14:00:00.000Z", hours: 1, jobRefs: [], source: "kiosk", deletedAt: LATE, lastModifiedAt: LATE });
  s[K("productionhours.json")].push({ id: "js_old", personId: 99, jobId: "j1", panelId: "p2", opId: "o4", clockIn: "2026-10-05T13:00:00.000Z", clockOut: "2026-10-05T15:00:00.000Z", hours: 2, date: "2026-10-05", source: "kiosk", lastModifiedAt: "2026-10-05T15:00:00.000Z" });
  s[K("config.json")].lastModifiedAt = "2026-10-12T00:00:00.000Z";
});

// ── attachment payloads ──────────────────────────────────────
const TXT = Buffer.from("hello golden").toString("base64");
const PNG_URL = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
const TOO_BIG = Buffer.alloc(8 * 1024 * 1024 + 1, 0x41).toString("base64");
const up = (over) => ({ fn: "attachment", method: "POST", body: { filename: "note.txt", mimeType: "text/plain", data: TXT, ...over } });

// ── migrate-timeclock legacy files ───────────────────────────
const legacySeed = seedWith(null, {
  [K("timeclock.json")]: [
    { id: "tc_a", personId: "7", date: "2026-10-12", clockIn: "2026-10-12T13:00:00.000Z", clockOut: "2026-10-12T21:00:00.000Z", hours: 7.5, jobRefs: [], note: "legacy copy, loses to target" },
    { id: "tc_old", personId: "7", date: "2026-09-02", clockIn: "2026-09-02T13:00:00.000Z", clockOut: "2026-09-02T21:00:00.000Z", hours: 8, jobRefs: [] },
    { id: "tce_old", personId: "7", date: "2026-09-02", eventType: "lunchStart", timestamp: "2026-09-02T18:00:00.000Z" },
    { personId: 99, date: "2026-09-03", clockIn: "2026-09-03T13:00:00.000Z", clockOut: "2026-09-03T15:00:00.000Z", hours: 2 },
  ],
  [K("jobsessions.json")]: [
    { id: "js_a", personId: "7", jobId: "j1", panelId: "p1", opId: "o1", clockIn: "2026-10-12T13:00:00.000Z", clockOut: "2026-10-12T19:00:00.000Z", hours: 6, date: "2026-10-12" },
    { id: "js_legacy", personId: 99, jobId: "j1", panelId: "p2", opId: "o4", clockIn: "2026-09-03T13:00:00.000Z", clockOut: "2026-09-03T15:00:00.000Z", hours: 2, date: "2026-09-03", source: "ios-app" },
  ],
});

const orgPost = (body) => ({ fn: "org", method: "POST", auth: null, body });
const validOrg = { name: "Brand New Shop", domain: "@NewShop.Example", adminEmail: "Founder@NewShop.example",
  adminEmails: ["second@newshop.example", "FOUNDER@newshop.example", "junk", null], adminName: "Fay Founder",
  industry: "Fabrication", companySize: "1-10", country: "US", currency: "", tier: "Business", code: "SQUAT",
  settings: { timeZone: " America/Chicago ", payPeriodType: "weekly", payPeriodStart: "2026-10-05", hpd: 10 } };

const notify = (body) => ({ fn: "notify", method: "POST", body });
const sub = (endpoint) => ({ endpoint, keys: { p256dh: "BKey" + endpoint.length, auth: "a" + endpoint.length }, expirationTime: null });

export default [
  // ══ sync ═══════════════════════════════════════════════════
  { name: "sync GET full as admin (no since, since=0, since=1970): everything, pins stripped to hasPin", auth: AUTH.ada, steps: [
    { fn: "sync", method: "GET" },
    { fn: "sync", method: "GET", query: { since: "0" } },
    { fn: "sync", method: "GET", query: { since: "1970-01-01T00:00:00.000Z" } },
  ] },
  { name: "sync GET full as worker Wendy: own payhours, projected production, member groups, ACL messages", auth: AUTH.wendy, steps: [{ fn: "sync", method: "GET" }] },
  { name: "sync GET full as worker Sam (job + group threads, not the dm), then as restricted admin (whole payroll)", auth: AUTH.sam, steps: [
    { fn: "sync", method: "GET" },
    { fn: "sync", method: "GET", auth: AUTH.rita },
  ] },
  { name: "sync GET delta as admin: only newer rows, unstamped rows always, unchanged objects null; future cursor", auth: AUTH.ada, steps: [
    { fn: "sync", method: "GET", query: { since: SINCE } },
    { fn: "sync", method: "GET", query: { since: "2027-01-01T00:00:00.000Z" } },
  ] },
  { name: "sync GET delta as admin with tombstones and a changed orgConfig", auth: AUTH.ada, seed: syncDeltaSeed,
    steps: [{ fn: "sync", method: "GET", query: { since: SINCE } }] },
  { name: "sync GET delta as worker with tombstones: ACL still applied to tombstones", auth: AUTH.wendy, seed: syncDeltaSeed,
    steps: [{ fn: "sync", method: "GET", query: { since: SINCE } }] },
  { name: "sync GET as a member with no person id: no messages or groups", auth: OWNER, steps: [{ fn: "sync", method: "GET" }] },
  { name: "sync GET on an org with no files: empty arrays, null objects", auth: AUTH.ada, seed: () => ({}), steps: [{ fn: "sync", method: "GET" }] },
  { name: "sync refusals: bad since, POST, no token, failing token", auth: AUTH.ada, steps: [
    { fn: "sync", method: "GET", query: { since: "last tuesday" } },
    { fn: "sync", method: "POST", body: {} },
    { fn: "sync", method: "GET", auth: null },
    { fn: "sync", method: "GET", auth: AUTH.ada, authFail: { status: 403, message: "Not a member of this organization" } },
  ] },

  // ══ org GET (public) ═══════════════════════════════════════
  { name: "org GET ?code: exists (SSO connection passed through), deleted 404, unknown 404, invalid, missing", auth: null,
    seed: seedWith((s) => { s[K("config.json")].connection = "testpanels-sso"; }, OTHER_ORGS), steps: [
      { fn: "org", method: "GET", query: { code: ORG } },
      { fn: "org", method: "GET", query: { code: "OTHERORG" } },
      { fn: "org", method: "GET", query: { code: "DELORG" } },
      { fn: "org", method: "GET", query: { code: "NOPE123" } },
      { fn: "org", method: "GET", query: { code: "a!" } },
      { fn: "org", method: "GET" },
    ] },
  { name: "org GET ?code: 21st call from one IP in a minute is rate limited", auth: null, now: "2026-10-14T16:00:10.000Z",
    steps: Array.from({ length: 21 }, () => ({ fn: "org", method: "GET", query: { code: ORG }, headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } })) },

  // ══ org POST (create) ══════════════════════════════════════
  { name: "org POST: create a Business org, generated code, normalised admins", steps: [orgPost(validOrg)] },
  { name: "org POST: minimal Basic org, one-letter name gets ORG prefix", steps: [orgPost({ name: "X", adminEmail: "a@b.co", tier: "basic", settings: { timeZone: "UTC" } })] },
  { name: "org POST: signups disabled", env: { SIGNUPS_ENABLED: "false" }, steps: [orgPost(validOrg)] },
  { name: "org POST: validation refusals (timeZone, tier, fields, JSON)", steps: [
    orgPost({ ...validOrg, settings: { payPeriodType: "weekly" } }),
    orgPost({ ...validOrg, settings: { timeZone: "   " } }),
    orgPost({ ...validOrg, settings: { timeZone: "Mountain" } }),
    orgPost({ ...validOrg, tier: undefined }),
    orgPost({ ...validOrg, tier: "Enterprise" }),
    orgPost({ ...validOrg, name: "" }),
    orgPost({ ...validOrg, adminEmail: undefined }),
    orgPost({ ...validOrg, name: "N".repeat(81) }),
    orgPost({ ...validOrg, domain: "d".repeat(81) }),
    orgPost({ ...validOrg, adminEmail: "no-at-sign" }),
    orgPost({ ...validOrg, settings: { timeZone: "UTC", payPeriodType: "fortnightly" } }),
    orgPost({ ...validOrg, settings: { timeZone: "UTC", payPeriodStart: "10/05/2026" } }),
    orgPost("not json"),
    { fn: "org", method: "POST", auth: null },
  ] },

  // ══ org PATCH ══════════════════════════════════════════════
  { name: "org PATCH newName: admin renames (trimmed, published), then the same name again keeps the stamp", auth: AUTH.ada, steps: [
    { fn: "org", method: "PATCH", body: { newName: "  Test Panels Incorporated  " } },
    { fn: "org", method: "PATCH", now: "2026-10-14T16:00:00.000Z", body: { newName: "Test Panels Incorporated" } },
  ] },
  { name: "org PATCH newDomain on Business: set with @ and caps, then clear", auth: AUTH.ada, steps: [
    { fn: "org", method: "PATCH", body: { newDomain: "@@TestPanels.Example" } },
    { fn: "org", method: "PATCH", body: { newDomain: "" } },
  ] },
  { name: "org PATCH newName / newDomain refusals: blank, too long, perms, no admin fits, email shape", auth: AUTH.ada, steps: [
    { fn: "org", method: "PATCH", body: { newName: "   " } },
    { fn: "org", method: "PATCH", body: { newName: "N".repeat(81) } },
    { fn: "org", method: "PATCH", auth: AUTH.rita, body: { newName: "Rita Co" } },
    { fn: "org", method: "PATCH", auth: AUTH.wendy, body: { newName: "Wendy Co" } },
    { fn: "org", method: "PATCH", auth: AUTH.ada, body: { newDomain: "acme.com" } },
    { fn: "org", method: "PATCH", body: { newDomain: "user@acme.com" } },
    { fn: "org", method: "PATCH", body: { newDomain: "-bad-.com" } },
    { fn: "org", method: "PATCH", body: { newDomain: "a".repeat(250) + ".com" } },
    { fn: "org", method: "PATCH", auth: AUTH.rita, body: { newDomain: "testpanels.example" } },
  ] },
  { name: "org PATCH newDomain and identityProviders on Basic tier refused", auth: ADA_GOOGLE,
    seed: seedWith((s) => { s[K("billing.json")] = { tier: "basic", lastModifiedAt: T0 }; }), steps: [
      { fn: "org", method: "PATCH", body: { newDomain: "testpanels.example" } },
      { fn: "org", method: "PATCH", body: { identityProviders: ["google"] } },
    ] },
  { name: "org PATCH newDomain with no billing record reads as Basic", auth: AUTH.ada,
    seed: seedWith((s) => { delete s[K("billing.json")]; }),
    steps: [{ fn: "org", method: "PATCH", body: { newDomain: "" } }] },
  { name: "org PATCH identityProviders: google only, then both (stored as [])", auth: ADA_GOOGLE, steps: [
    { fn: "org", method: "PATCH", body: { identityProviders: ["google", "github"] } },
    { fn: "org", method: "PATCH", body: { identityProviders: ["microsoft", "google"] } },
  ] },
  { name: "org PATCH identityProviders refusals: lockout, token with no sub, none picked, restricted admin", auth: ADA_GOOGLE, steps: [
    { fn: "org", method: "PATCH", body: { identityProviders: ["microsoft"] } },
    { fn: "org", method: "PATCH", auth: AUTH.ada, body: { identityProviders: ["google"] } },
    { fn: "org", method: "PATCH", auth: ADA_GOOGLE, body: { identityProviders: ["github"] } },
    { fn: "org", method: "PATCH", auth: AUTH.rita, body: { identityProviders: ["google"] } },
  ] },
  { name: "org PATCH deleteOrg: soft delete, repeat is idempotent, public GET then 404s", auth: AUTH.ada, steps: [
    { fn: "org", method: "PATCH", body: { deleteOrg: true } },
    { fn: "org", method: "PATCH", now: "2026-10-15T09:00:00.000Z", body: { deleteOrg: true } },
    { fn: "org", method: "GET", auth: null, query: { code: ORG } },
  ] },
  { name: "org PATCH deleteOrg refusals: restricted admin, worker, deleteOrg not true", auth: AUTH.rita, steps: [
    { fn: "org", method: "PATCH", body: { deleteOrg: true } },
    { fn: "org", method: "PATCH", auth: AUTH.wendy, body: { deleteOrg: true } },
    { fn: "org", method: "PATCH", auth: AUTH.ada, body: { deleteOrg: "yes" } },
  ] },
  { name: "org PATCH deleteOrg on MTX2026TRAQS is refused before the perm check", auth: { ...AUTH.rita, orgCode: "MTX2026TRAQS" },
    seed: seedWith(null, { "orgs/MTX2026TRAQS/config.json": { name: "Matrix", domain: "matrix.example", adminEmail: "x@matrix.example", lastModifiedAt: T0 } }),
    steps: [{ fn: "org", method: "PATCH", org: "MTX2026TRAQS", body: { deleteOrg: true } }] },
  { name: "org PATCH deleteOrg / newName when the org has no config: 404", auth: { ...AUTH.ada, orgCode: "GHOSTORG" }, steps: [
    { fn: "org", method: "PATCH", org: "GHOSTORG", body: { deleteOrg: true } },
    { fn: "org", method: "PATCH", org: "GHOSTORG", body: { newName: "Ghost" } },
  ] },
  { name: "org PATCH newCode, empty body, bad JSON, no token, PUT", auth: AUTH.ada, steps: [
    { fn: "org", method: "PATCH", body: { newCode: "NEWCODE1" } },
    { fn: "org", method: "PATCH", body: {} },
    { fn: "org", method: "PATCH", body: "{oops" },
    { fn: "org", method: "PATCH", auth: null, body: { newName: "Anon" } },
    { fn: "org", method: "PUT", auth: AUTH.ada, body: {} },
  ] },

  // ══ org-config ═════════════════════════════════════════════
  { name: "org-config GET as worker then admin: no admin emails, tier, isMember / isAdmin", auth: AUTH.wendy, steps: [
    { fn: "org-config", method: "GET" },
    { fn: "org-config", method: "GET", auth: AUTH.ada },
  ] },
  { name: "org-config GET with no billing record: tier basic", auth: AUTH.ada,
    seed: seedWith((s) => { delete s[K("billing.json")]; }), steps: [{ fn: "org-config", method: "GET" }] },
  { name: "org-config refusals: non-member, no token, unknown org, POST", auth: AUTH.wendy, steps: [
    { fn: "org-config", method: "GET", authFail: { status: 403, message: "Not a member of this organization" } },
    { fn: "org-config", method: "GET", authFail: null, auth: null },
    { fn: "org-config", method: "GET", auth: { ...AUTH.ada, orgCode: "GHOSTORG" }, org: "GHOSTORG" },
    { fn: "org-config", method: "POST", auth: AUTH.ada, body: {} },
  ] },
  { name: "org-config founding admin self-provisions a person row once", auth: OWNER, steps: [
    { fn: "org-config", method: "GET" },
    { fn: "org-config", method: "GET", now: "2026-10-14T15:31:00.000Z" },
  ] },
  { name: "org-config founding admin of an empty org gets id 1", auth: { ...OWNER, email: "founder@newshop.example", orgCode: "NEWSHOP" },
    seed: () => ({
      "orgs/NEWSHOP/config.json": { name: "New Shop", domain: "", adminEmail: "Founder@NewShop.example", adminEmails: ["founder@newshop.example"], adminName: "Fay Founder", createdAt: T0, lastModifiedAt: T0 },
      "orgs/NEWSHOP/people.json": [], "orgs/NEWSHOP/billing.json": { tier: "business", requestedTier: null, requestedAt: null, requestedBy: null, lastModifiedAt: T0 },
    }),
    steps: [{ fn: "org-config", method: "GET", org: "NEWSHOP" }] },
  { name: "org-config admin whose only row is tombstoned resolves to it; non-admin with no row stays isMember false", auth: { ...OWNER, email: "gone@testpanels.example" }, steps: [
    { fn: "org-config", method: "GET" },
    { fn: "org-config", method: "GET", auth: NEWHIRE },
  ] },
  { name: "org-config login settles a live invite for that address, not expired ones", auth: { ...NEWHIRE, personId: "20" },
    seed: seedWith((s) => {
      s[K("people.json")].push({ id: "20", name: "New Hire", email: "newhire@testpanels.example", userRole: "user", cap: 8, timeOff: [], lastModifiedAt: T0 });
      s[K("invites.json")].push(
        { id: "inv_old", token: "tok_expired_bbbbbbbbbbbb", email: "newhire@testpanels.example", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-15T00:00:00.000Z", acceptedAt: null, revokedAt: null },
        { id: "inv_other", token: "tok_other_cccccccccccccc", email: "someone@testpanels.example", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: "2026-10-10T00:00:00.000Z", expiresAt: "2026-10-24T00:00:00.000Z", acceptedAt: null, revokedAt: null },
      );
    }),
    steps: [{ fn: "org-config", method: "GET" }, { fn: "org-config", method: "GET", now: "2026-10-14T16:00:00.000Z" }] },

  // ══ org-lookup ═════════════════════════════════════════════
  { name: "org-lookup GET: worker matches by domain + roster across orgs (query email ignored); admin by adminEmail", auth: AUTH.wendy, seed: seedWith(null, OTHER_ORGS), steps: [
    { fn: "org-lookup", method: "GET", query: { email: "ada@testpanels.example" } },
    { fn: "org-lookup", method: "GET", auth: AUTH.ada },
  ] },
  { name: "org-lookup GET: tombstoned person and second-listed admin get no match", auth: { ...AUTH.wendy, email: "gone@testpanels.example" }, seed: seedWith(null, OTHER_ORGS),
    steps: [{ fn: "org-lookup", method: "GET" }, { fn: "org-lookup", method: "GET", auth: OWNER }] },
  { name: "org-lookup refusals: no token, no email on token, POST", auth: null, steps: [
    { fn: "org-lookup", method: "GET" },
    { fn: "org-lookup", method: "GET", auth: { ...AUTH.wendy, email: null } },
    { fn: "org-lookup", method: "POST", auth: AUTH.wendy, body: {} },
  ] },

  // ══ forgot-org ═════════════════════════════════════════════
  { name: "forgot-org POST: listed admin of two live orgs gets one email; deleted org skipped", auth: null, seed: seedWith(null, OTHER_ORGS),
    steps: [
      { fn: "forgot-org", method: "POST", body: { email: "  Owner@TestPanels.example " } },
      { fn: "forgot-org", method: "POST", body: { email: "ada@testpanels.example" } },
    ] },
  { name: "forgot-org POST: domain match or unknown address is ok with no email", auth: null, seed: seedWith(null, OTHER_ORGS), steps: [
    { fn: "forgot-org", method: "POST", body: { email: "wendy@testpanels.example" } },
    { fn: "forgot-org", method: "POST", body: { email: "stranger@nowhere.example" } },
  ] },
  { name: "forgot-org refusals: bad email, bad JSON, GET, and a POST with no body (throws)", auth: null, steps: [
    { fn: "forgot-org", method: "POST", body: { email: "nope" } },
    { fn: "forgot-org", method: "POST", body: {} },
    { fn: "forgot-org", method: "POST", body: "{bad" },
    { fn: "forgot-org", method: "GET" },
    { fn: "forgot-org", method: "POST" },
  ] },

  // ══ invite ═════════════════════════════════════════════════
  { name: "invite POST create: admin invites (email sent, token once), odd role from a sender not on the roster, list", auth: AUTH.ada, steps: [
    { fn: "invite", method: "POST", body: { email: "  Fresh.Face@Example.com ", role: "admin", name: "Fresh Face", personId: 42 } },
    { fn: "invite", method: "POST", auth: { ...AUTH.ada, email: "owner@testpanels.example" }, body: { email: "second@example.com", role: "superuser" } },
    { fn: "invite", method: "GET", auth: AUTH.ada },
  ] },
  { name: "invite POST create refusals: duplicate live invite, bad email, restricted admin, worker", auth: AUTH.ada, steps: [
    { fn: "invite", method: "POST", body: { email: "NewHire@testpanels.example" } },
    { fn: "invite", method: "POST", body: { email: "no-at" } },
    { fn: "invite", method: "POST", auth: AUTH.rita, body: { email: "x@example.com" } },
    { fn: "invite", method: "POST", auth: AUTH.wendy, body: { email: "x@example.com" } },
    { fn: "invite", method: "POST", auth: AUTH.ada, body: "{nope" },
  ] },
  { name: "invite POST create: an expired invite does not block a new one", auth: AUTH.ada, now: "2026-10-25T00:00:00.000Z",
    steps: [{ fn: "invite", method: "POST", body: { email: "newhire@testpanels.example" } }] },
  { name: "invite GET list as worker (tokens stripped, activeCount), then ?token&org public view and its refusals", auth: null,
    seed: seedWith((s) => { s[K("invites.json")].push(
      { id: "inv_rev", token: "tok_rev_dddddddddddddddd", email: "rev@example.com", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: T0, expiresAt: "2026-10-15T12:00:00.000Z", acceptedAt: null, revokedAt: "2026-10-02T00:00:00.000Z" },
      { id: "inv_acc", token: "tok_acc_eeeeeeeeeeeeeeee", email: "acc@example.com", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: T0, expiresAt: "2026-10-15T12:00:00.000Z", acceptedAt: "2026-10-03T00:00:00.000Z", revokedAt: null },
      { id: "inv_exp", token: "tok_exp_ffffffffffffffff", email: "exp@example.com", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-15T00:00:00.000Z", acceptedAt: null, revokedAt: null },
    ); }),
    steps: [
      { fn: "invite", method: "GET", auth: AUTH.wendy },
      { fn: "invite", method: "GET", auth: null, query: { token: "tok_live_aaaaaaaaaaaaaaaa", org: ORG } },
      { fn: "invite", method: "GET", query: { token: "tok_exp_ffffffffffffffff", org: ORG } },
      { fn: "invite", method: "GET", query: { token: "tok_rev_dddddddddddddddd", org: ORG } },
      { fn: "invite", method: "GET", query: { token: "tok_acc_eeeeeeeeeeeeeeee", org: ORG } },
      { fn: "invite", method: "GET", query: { token: "tok_unknown", org: ORG } },
      { fn: "invite", method: "GET", query: { token: "tok_live_aaaaaaaaaaaaaaaa", org: "no/slash" } },
      { fn: "invite", method: "GET", query: { token: "tok_live_aaaaaaaaaaaaaaaa", org: "NOPE123" } },
    ] },
  { name: "invite POST accept: matching email creates a person, second accept refused", auth: NEWHIRE, steps: [
    { fn: "invite", method: "POST", body: { token: "tok_live_aaaaaaaaaaaaaaaa", accept: true } },
    { fn: "invite", method: "POST", body: { token: "tok_live_aaaaaaaaaaaaaaaa", accept: true } },
  ] },
  { name: "invite POST accept: already on the roster binds, creates nothing", auth: { ...NEWHIRE, email: "newhire@testpanels.example" },
    seed: seedWith((s) => { s[K("people.json")].push({ id: "20", name: "New Hire", email: "NewHire@testpanels.example ", userRole: "user", cap: 8, timeOff: [], lastModifiedAt: T0 }); }),
    steps: [{ fn: "invite", method: "POST", body: { token: "tok_live_aaaaaaaaaaaaaaaa", accept: true } }] },
  { name: "invite POST accept: a tombstoned row for the address does not bind", auth: NEWHIRE,
    seed: seedWith((s) => { s[K("people.json")].push({ id: "2", name: "Old Hire", email: "newhire@testpanels.example", userRole: "user", cap: 8, timeOff: [], deletedAt: T0, lastModifiedAt: T0 }); }),
    steps: [{ fn: "invite", method: "POST", body: { token: "tok_live_aaaaaaaaaaaaaaaa", accept: true } }] },
  { name: "invite POST accept refusals: wrong email, unknown token, expired, revoked", auth: AUTH.wendy,
    seed: seedWith((s) => { s[K("invites.json")].push(
      { id: "inv_rev", token: "tok_rev_dddddddddddddddd", email: "wendy@testpanels.example", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: T0, expiresAt: "2026-10-15T12:00:00.000Z", acceptedAt: null, revokedAt: "2026-10-02T00:00:00.000Z" },
      { id: "inv_exp", token: "tok_exp_ffffffffffffffff", email: "wendy@testpanels.example", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-15T00:00:00.000Z", acceptedAt: null, revokedAt: null },
    ); }),
    steps: [
      { fn: "invite", method: "POST", body: { token: "tok_live_aaaaaaaaaaaaaaaa", accept: true } },
      { fn: "invite", method: "POST", body: { token: "tok_nope", accept: true } },
      { fn: "invite", method: "POST", body: { token: "tok_exp_ffffffffffffffff", accept: true } },
      { fn: "invite", method: "POST", body: { token: "tok_rev_dddddddddddddddd", accept: true } },
      { fn: "invite", method: "POST", auth: { ...NEWHIRE, email: "" }, body: { token: "tok_live_aaaaaaaaaaaaaaaa", accept: true } },
    ] },
  { name: "invite DELETE revoke by body id, then by query id, then the public view 404s", auth: AUTH.ada,
    seed: seedWith((s) => { s[K("invites.json")].push({ id: "inv_2", token: "tok_two_gggggggggggggggg", email: "two@example.com", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: T0, expiresAt: "2026-10-24T15:00:00.000Z", acceptedAt: null, revokedAt: null }); }),
    steps: [
      { fn: "invite", method: "DELETE", body: { id: "inv_1" } },
      { fn: "invite", method: "DELETE", query: { id: "inv_2" } },
      { fn: "invite", method: "GET", auth: null, query: { token: "tok_live_aaaaaaaaaaaaaaaa", org: ORG } },
      { fn: "invite", method: "GET" },
    ] },
  { name: "invite DELETE refusals: unknown id, accepted invite, restricted admin, PATCH", auth: AUTH.ada,
    seed: seedWith((s) => { s[K("invites.json")].push({ id: "inv_acc", token: "tok_acc_eeeeeeeeeeeeeeee", email: "acc@example.com", role: "user", invitedBy: "ada@testpanels.example", personId: null, name: "", createdAt: T0, expiresAt: "2026-10-24T15:00:00.000Z", acceptedAt: "2026-10-03T00:00:00.000Z", revokedAt: null }); }),
    steps: [
      { fn: "invite", method: "DELETE", body: { id: "inv_nope" } },
      { fn: "invite", method: "DELETE", body: { id: "inv_acc" } },
      { fn: "invite", method: "DELETE", auth: AUTH.rita, body: { id: "inv_1" } },
      { fn: "invite", method: "PATCH", auth: AUTH.ada, body: {} },
      { fn: "invite", method: "GET", auth: null },
    ] },

  // ══ attachment ═════════════════════════════════════════════
  { name: "attachment POST message context: worker uploads, data URL accepted, name sanitised", auth: AUTH.wendy, steps: [
    up({ context: "message", filename: "shop photo (final)#1.png", mimeType: "image/png", data: PNG_URL }),
    up({ context: "message" }),
  ] },
  { name: "attachment POST other / no context: admin only", auth: AUTH.ada, steps: [
    up({ context: "other", filename: "drawing.pdf", mimeType: "application/pdf" }),
    up({ filename: "x".repeat(130) + ".csv", mimeType: "text/csv" }),
    up({ context: "somethingElse" }),
    { ...up({}), auth: AUTH.wendy },
    { ...up({ context: "other" }), auth: AUTH.sam },
  ] },
  { name: "attachment POST jobFinish: allowed within 5 minutes of the last clock-out", auth: AUTH.wendy, steps: [
    { ...up({ context: "jobFinish", filename: "done.jpg", mimeType: "image/jpeg" }), now: "2026-10-12T21:33:00.000Z" },
    { ...up({ context: "jobFinish", filename: "edge.jpg", mimeType: "image/jpeg" }), now: "2026-10-12T21:35:00.000Z" },
    { ...up({ context: "jobFinish", filename: "late.jpg", mimeType: "image/jpeg" }), now: "2026-10-12T21:35:01.000Z" },
  ] },
  { name: "attachment POST jobFinish refused: long after clock-out, no punches, admin bypass", auth: AUTH.sam, now: "2026-10-13T21:10:00.000Z", steps: [
    up({ context: "jobFinish" }),
    { ...up({ context: "jobFinish" }), auth: { ...AUTH.wendy, personId: "14" } },
    { ...up({ context: "jobFinish" }), auth: AUTH.rita },
  ] },
  { name: "attachment POST jobFinish refused while still on the clock", auth: AUTH.wendy, now: "2026-10-12T21:32:00.000Z",
    seed: seedWith((s) => { s[K("people.json")][1].activeClockIn = { clockIn: "2026-10-12T21:31:00.000Z", jobRefs: [], events: [], source: "kiosk" }; }),
    steps: [up({ context: "jobFinish" })] },
  { name: "attachment POST jobFinish ignores lunch events and tombstoned punches", auth: AUTH.wendy, now: "2026-10-14T15:32:00.000Z",
    seed: seedWith((s) => { s[K("payhours.json")].push(
      { id: "tce_x", personId: "7", date: "2026-10-14", eventType: "lunchEnd", timestamp: "2026-10-14T15:30:00.000Z", clockOut: "2026-10-14T15:30:00.000Z", lastModifiedAt: "2026-10-14T15:30:00.000Z" },
      { id: "tc_del", personId: "7", date: "2026-10-14", clockIn: "2026-10-14T13:00:00.000Z", clockOut: "2026-10-14T15:30:00.000Z", hours: 2.5, deletedAt: "2026-10-14T15:31:00.000Z", lastModifiedAt: "2026-10-14T15:31:00.000Z" },
      { id: "tc_ok", personId: 7, date: "2026-10-14", clockIn: "2026-10-14T13:00:00.000Z", clockOut: "2026-10-14T15:28:00.000Z", hours: 2.4, lastModifiedAt: "2026-10-14T15:28:00.000Z" },
    ); }),
    steps: [up({ context: "jobFinish" })] },
  { name: "attachment POST refusals: over 8 MB, disallowed types, missing fields, bad JSON, no token", auth: AUTH.ada, steps: [
    up({ context: "message", data: TOO_BIG }),
    up({ context: "message", mimeType: "text/html" }),
    up({ context: "message", mimeType: "image/svg+xml" }),
    up({ context: "message", data: "" }),
    up({ context: "message", filename: undefined }),
    { fn: "attachment", method: "POST", body: "{x" },
    { ...up({ context: "message" }), auth: null },
  ] },
  { name: "attachment GET: a stored file comes back as base64, a missing one is 404", auth: null,
    seed: () => ({ ...orgSeed(), "orgs/TESTORG/attachments/AbCdEfGhI-mcc1.pdf": { __binary: Buffer.from("%PDF-1.4 golden").toString("base64"), contentType: "application/pdf" } }),
    steps: [
      { fn: "attachment", method: "GET", query: { key: "orgs/TESTORG/attachments/AbCdEfGhI-mcc1.pdf" } },
      { fn: "attachment", method: "GET", query: { key: "orgs/TESTORG/attachments/ZzZzZzZzZ-revb.pdf" } },
    ] },
  { name: "attachment GET ?key validation refusals and PUT", auth: null, steps: [
    { fn: "attachment", method: "GET" },
    { fn: "attachment", method: "GET", query: { key: "orgs/TESTORG/attachments/../people.json" } },
    { fn: "attachment", method: "GET", query: { key: "orgs/TESTORG/people.json" } },
    { fn: "attachment", method: "GET", query: { key: "orgs/TESTORG/attachments/sub/dir.pdf" } },
    { fn: "attachment", method: "GET", query: { key: "orgs/x/attachments/a.pdf" } },
    { fn: "attachment", method: "GET", query: { key: "orgs/TESTORG/attachments/a b.pdf" } },
    { fn: "attachment", method: "PUT", auth: AUTH.ada, body: {} },
  ] },

  // ══ notify ═════════════════════════════════════════════════
  { name: "notify POST worker: finish_request goes to completion approvers, every privileged type refused", auth: AUTH.wendy, steps: [
    notify({ type: "finish_request", jobTitle: "Lift Station 4", jobNumber: "24-117", requestedByName: "Wendy Wirer", jobTeamIds: ["7", 99] }),
    notify({ type: "finish_request", jobTitle: "Lift Station 4" }),
    notify({ type: "step", stepLabel: "Designed", jobTitle: "Lift Station 4" }),
    notify({ type: "assigned", newTeamIds: ["99"], jobTitle: "x" }),
    notify({ type: "new_job", jobTitle: "x" }),
    notify({ type: "ready", jobTitle: "x" }),
    notify({ type: "completion_resolved", stepLabel: "approved", jobTitle: "x" }),
    notify({ type: "made_up" }),
  ] },
  { name: "notify POST admin: each type and its audience", auth: AUTH.ada, steps: [
    notify({ type: "new_job", jobTitle: "Crusher Retrofit", clientName: "Bolt Mining" }),
    notify({ type: "new_job", jobNumber: "24-120" }),
    notify({ type: "assigned", jobNumber: "24-117", newTeamIds: ["7", 7, 99] }),
    notify({ type: "step", stepLabel: "Verified", panelTitle: "MCC-1", jobTitle: "Lift Station 4", approvedByName: "Ada Admin", jobTeamIds: ["7", "99", "1"] }),
    notify({ type: "step", stepLabel: "Designed", jobNumber: "24-117" }),
    notify({ type: "ready", panelTitle: "MCC-1", jobTitle: "Lift Station 4", jobTeamIds: ["7", "99"] }),
    notify({ type: "completion_resolved", stepLabel: "approved", jobTitle: "MCC-1", jobNumber: "24-117", newTeamIds: ["7"] }),
    notify({ type: "completion_resolved", stepLabel: "declined", jobTitle: "MCC-1", newTeamIds: ["7"], approvedByName: "Ada Admin" }),
    notify({ type: "completion_resolved", stepLabel: "reopen", jobTitle: "MCC-1", newTeamIds: ["7"] }),
    notify({ type: "made_up" }),
  ] },
  { name: "notify POST non-admin engineer / sign-off holder is privileged", auth: AUTH.sam,
    seed: seedWith((s) => { s[K("people.json")][2].canSignOff = true; }),
    steps: [notify({ type: "ready", panelTitle: "RTU", jobTitle: "Lift Station 4", jobTeamIds: ["99"] })] },
  { name: "notify POST refusals: missing type, long field, too many recipients, bad JSON, GET", auth: AUTH.ada, steps: [
    notify({ jobTitle: "x" }),
    notify({ type: "step", stepLabel: "s".repeat(301) }),
    notify({ type: "assigned", newTeamIds: Array.from({ length: 1001 }, (_, i) => i) }),
    { fn: "notify", method: "POST", body: "{bad" },
    { fn: "notify", method: "GET" },
    { ...notify({ type: "step" }), auth: null },
  ] },

  // ══ push-subscribe ═════════════════════════════════════════
  { name: "push-subscribe POST: add, re-add same endpoint replaces it, theme recorded", auth: AUTH.ada, steps: [
    { fn: "push-subscribe", method: "POST", body: { subscription: sub("https://push.example/new"), theme: "dark" } },
    { fn: "push-subscribe", method: "POST", body: { subscription: { ...sub("https://push.example/abc"), keys: { p256dh: "BPub2", auth: "aut2" } } } },
  ] },
  { name: "push-subscribe POST: first subscription for a worker, capped at 10", auth: AUTH.wendy,
    steps: Array.from({ length: 11 }, (_, i) => ({ fn: "push-subscribe", method: "POST", body: { subscription: sub(`https://push.example/w${i}`), theme: i % 2 ? "dark" : "sepia" } })) },
  { name: "push-subscribe DELETE (empties the person; a person with none writes nothing) and refusals", auth: AUTH.ada, steps: [
    { fn: "push-subscribe", method: "DELETE", body: { endpoint: "https://push.example/abc" } },
    { fn: "push-subscribe", method: "DELETE", auth: AUTH.wendy, query: { endpoint: "https://push.example/abc" } },
    { fn: "push-subscribe", method: "POST", auth: AUTH.ada, body: { subscription: { endpoint: "https://push.example/x", keys: { p256dh: "B" } } } },
    { fn: "push-subscribe", method: "DELETE", body: {} },
    { fn: "push-subscribe", method: "POST", auth: OWNER, body: { subscription: sub("https://push.example/o") } },
    { fn: "push-subscribe", method: "POST", auth: AUTH.ada, body: "{bad" },
    { fn: "push-subscribe", method: "GET" },
  ] },

  // ══ ably-token ═════════════════════════════════════════════
  // Order matters: the runner restores only BASE_ENV keys, so an env key a scenario sets
  // (ABLY_ROOT_KEY) stays set for every LATER scenario in the file. Not-configured runs first.
  { name: "ably-token refusals: not configured, GET, no token", auth: AUTH.wendy, steps: [
    { fn: "ably-token", method: "POST" },
    { fn: "ably-token", method: "GET" },
    { fn: "ably-token", method: "POST", auth: null },
  ] },
  { name: "ably-token POST: org-scoped capability, clientId from person", auth: AUTH.wendy, env: { ABLY_ROOT_KEY: "appid.keyid:golden-not-a-secret" },
    steps: [{ fn: "ably-token", method: "POST" }, { fn: "ably-token", method: "POST", auth: OWNER }] },

  // ══ migrate-timeclock ══════════════════════════════════════
  { name: "migrate-timeclock POST: worker refused, admin needs ?confirm=1", auth: AUTH.wendy, seed: legacySeed, steps: [
    { fn: "migrate-timeclock", method: "POST", query: { confirm: "1" } },
    { fn: "migrate-timeclock", method: "POST", auth: AUTH.ada },
    { fn: "migrate-timeclock", method: "POST", auth: AUTH.ada, query: { confirm: "true" } },
    { fn: "migrate-timeclock", method: "GET", auth: AUTH.ada },
  ] },
  { name: "migrate-timeclock POST ?confirm=1: merge (target wins), archive, then already-migrated", auth: AUTH.ada, seed: legacySeed, steps: [
    { fn: "migrate-timeclock", method: "POST", query: { confirm: "1" } },
    { fn: "migrate-timeclock", method: "POST", query: { confirm: "1" }, now: "2026-10-14T16:00:00.000Z" },
  ] },
  { name: "migrate-timeclock POST ?confirm=1 with nothing to migrate", auth: AUTH.ada,
    steps: [{ fn: "migrate-timeclock", method: "POST", query: { confirm: "1" } }] },
  { name: "migrate-timeclock POST ?confirm=1 finishes an interrupted archive", auth: AUTH.ada,
    seed: seedWith(null, { [K("timeclock.json.migrated")]: [{ id: "tc_old" }], [K("jobsessions.json")]: [{ id: "js_left", personId: "7", hours: 1 }] }),
    steps: [{ fn: "migrate-timeclock", method: "POST", query: { confirm: "1" } }] },
  { name: "migrate-timeclock POST ?confirm=1 with no target files yet", auth: AUTH.ada,
    seed: seedWith((s) => { delete s[K("payhours.json")]; delete s[K("productionhours.json")]; },
      { [K("timeclock.json")]: [{ id: "tc_only", personId: "7", date: "2026-09-02", clockIn: "2026-09-02T13:00:00.000Z", clockOut: "2026-09-02T21:00:00.000Z", hours: 8 }] }),
    steps: [{ fn: "migrate-timeclock", method: "POST", query: { confirm: "1" } }] },
];
