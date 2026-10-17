// Goldens: people, clients, settings, user-settings, billing.
import { AUTH, orgSeed, ORG } from "../fixture-org.mjs";

const people = () => orgSeed()[`orgs/${ORG}/people.json`];
const live = () => people().filter((p) => !p.deletedAt);

export default [
  // ── people GET ─────────────────────────────────────────────
  { name: "people GET as admin: full live list, decrypted pins, hasPin", auth: AUTH.ada, steps: [{ fn: "people", method: "GET" }] },
  { name: "people GET as worker: no pins", auth: AUTH.wendy, steps: [{ fn: "people", method: "GET" }] },
  { name: "people GET with no token: public projection + header", auth: null, steps: [{ fn: "people", method: "GET" }] },
  { name: "people GET with a failing token: an error, never the projection", authFail: { status: 401, message: "Token expired" }, auth: AUTH.wendy, steps: [{ fn: "people", method: "GET" }] },

  // ── people POST (full roster) ──────────────────────────────
  { name: "people POST: admin edits a name, stamps returned", auth: AUTH.ada,
    steps: [{ fn: "people", method: "POST", body: live().map((p) => (p.id === "7" ? { ...p, name: "Wendy W." } : p)) }] },
  { name: "people POST: admin adds a person", auth: AUTH.ada,
    steps: [{ fn: "people", method: "POST", body: [...live(), { id: "t9newbie", name: "New Bie", email: "nb@testpanels.example", role: "Wiring", userRole: "user", cap: 8, color: "#123456", timeOff: [] }] }] },
  { name: "people POST: omission deletes nobody", auth: AUTH.ada,
    steps: [{ fn: "people", method: "POST", body: live().filter((p) => p.id !== 99) }] },
  { name: "people POST: empty array refused", auth: AUTH.ada, steps: [{ fn: "people", method: "POST", body: [] }] },
  { name: "people POST: worker edits own color only", auth: AUTH.wendy,
    steps: [{ fn: "people", method: "POST", body: live().map((p) => (p.id === "7" ? { ...p, color: "#000000" } : p)) }] },
  { name: "people POST: worker tries to make self admin", auth: AUTH.wendy,
    steps: [{ fn: "people", method: "POST", body: live().map((p) => (p.id === "7" ? { ...p, userRole: "admin" } : p)) }] },
  { name: "people POST: server-owned activeClockIn is pinned", auth: AUTH.ada,
    steps: [{ fn: "people", method: "POST", body: live().map((p) => (p.id === "7" ? { ...p, activeClockIn: { clockIn: "2026-10-14T13:00:00.000Z", jobRefs: [], events: [], source: "kiosk" } } : p)) }] },

  // ── people ?action=fields / PATCH / DELETE ─────────────────
  { name: "people fields: set canClockInOut and a pin", auth: AUTH.ada,
    steps: [{ fn: "people", method: "POST", query: { action: "fields" }, body: { edits: [{ id: "99", fields: { canClockInOut: true, pin: "9090" } }] } }] },
  { name: "people fields: restricted admin without manageTeam refused", auth: AUTH.rita,
    steps: [{ fn: "people", method: "POST", query: { action: "fields" }, body: { edits: [{ id: "7", fields: { payType: "salary" } }] } }] },
  { name: "people PATCH: worker sets own phone (null clears)", auth: AUTH.wendy,
    steps: [{ fn: "people", method: "PATCH", body: { personId: "7", fields: { phone: "555-0199", image: null } } }] },
  { name: "people PATCH: worker cannot patch someone else", auth: AUTH.wendy,
    steps: [{ fn: "people", method: "PATCH", body: { personId: "99", fields: { color: "#ffffff" } } }] },
  { name: "people DELETE ?id: admin soft-deletes", auth: AUTH.ada, steps: [{ fn: "people", method: "DELETE", query: { id: "99" } }] },
  { name: "people DELETE: self-delete", auth: AUTH.wendy, steps: [{ fn: "people", method: "DELETE" }] },

  // ── clients ────────────────────────────────────────────────
  { name: "clients GET", auth: AUTH.wendy, steps: [{ fn: "clients", method: "GET" }] },
  { name: "clients POST: admin adds one", auth: AUTH.ada, steps: [{ fn: "clients", method: "POST",
    body: [...orgSeed()[`orgs/${ORG}/clients.json`], { id: "c_new", name: "New Co", contact: "", email: "", phone: "", color: "#111111", notes: "" }] }] },
  { name: "clients POST: omission tombstones", auth: AUTH.ada, steps: [{ fn: "clients", method: "POST", body: orgSeed()[`orgs/${ORG}/clients.json`].slice(0, 1) }] },
  { name: "clients POST: worker refused", auth: AUTH.wendy, steps: [{ fn: "clients", method: "POST", body: [{ id: "c_x", name: "X" }] }] },
  { name: "clients POST: empty refused unless force", auth: AUTH.ada, steps: [{ fn: "clients", method: "POST", body: [] }, { fn: "clients", method: "POST", query: { force: "1" }, body: [] }] },

  // ── settings / user-settings / billing ─────────────────────
  { name: "settings GET", auth: AUTH.wendy, steps: [{ fn: "settings", method: "GET" }] },
  { name: "settings POST: admin replaces, keys omitted are dropped", auth: AUTH.ada, steps: [{ fn: "settings", method: "POST", body: { timeZone: "America/Denver", workDays: [1, 2, 3, 4], hpd: 9 } }] },
  { name: "settings POST: empty work week refused", auth: AUTH.ada, steps: [{ fn: "settings", method: "POST", body: { timeZone: "America/Denver", workDays: [] } }] },
  { name: "settings POST: restricted admin refused", auth: AUTH.rita, steps: [{ fn: "settings", method: "POST", body: { timeZone: "UTC", workDays: [1] } }] },
  { name: "user-settings GET and merge POST", auth: AUTH.ada, steps: [
    { fn: "user-settings", method: "GET" },
    { fn: "user-settings", method: "POST", body: { tMode: "month", colSort: { title: "asc" } } },
    { fn: "user-settings", method: "GET" },
  ] },
  { name: "user-settings for a user with none yet", auth: AUTH.wendy, steps: [{ fn: "user-settings", method: "GET" }, { fn: "user-settings", method: "POST", body: { themeMode: "light" } }] },
  { name: "billing GET and an upgrade request", auth: AUTH.ada, steps: [{ fn: "billing", method: "GET" }, { fn: "billing", method: "POST", body: {} }] },
];
