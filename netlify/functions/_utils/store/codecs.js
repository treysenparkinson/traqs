// One codec per S3 file kind: decode(json) -> rows by table, encode(rows by table) -> json.
// encode(decode(x)) deep-equals x (scripts/codec-roundtrip-test.mjs; tools/db/verify-snapshot.mjs
// on the production snapshot). A codec that can't represent a file exactly (an id twice, an
// unexpected shape) DECLINES with a reason, and the file is stored verbatim in raw_documents —
// never squeezed into tables. Rows use column names; json columns are wrapped as {__json}.
//
// docs/db/schema-design.md has the table map and the rules.

import { split, join, isPlainObject, wrapJson, unwrapJson } from "./fields.js";

const declined = (reason) => ({ declined: reason });
const byPos = (rows) => [...(rows || [])].sort((a, b) => a.position - b.position);
const uniqueIds = (arr) => new Set(arr.map((r) => String(r.id))).size === arr.length;
const idOk = (r) => isPlainObject(r) && (typeof r.id === "string" || (typeof r.id === "number" && Number.isFinite(r.id)));
const extraOf = (row) => (row.extra == null ? null : unwrapJson(row.extra));
const jsonOrNull = (o) => (o == null ? null : wrapJson(o));

// A list of objects becomes child rows only when it is a non-empty array of plain objects;
// otherwise it stays in the parent's extra verbatim ([] included), so absent / [] / odd
// round-trip without flags.
const rowsifiable = (v) => Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
const scalarRowsifiable = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x !== undefined);

function moveExtra(extra, key, value) { const e = { ...(extra || {}) }; e[key] = value; return e; }
const cleanExtra = (e) => (e && Object.keys(e).length ? e : null);

// ── org files ──────────────────────────────────────────────────────────────

const ORG_SPEC = [
  ["name", "name", "text"], ["domain", "domain", "text"], ["adminEmail", "admin_email", "text"],
  ["adminEmails", "admin_emails", "textArr"], ["adminName", "admin_name", "text"], ["industry", "industry", "text"],
  ["companySize", "company_size", "text"], ["country", "country", "text"], ["currency", "currency", "text"],
  ["connection", "connection", "text"], ["identityProviders", "identity_providers", "textArr"],
  ["createdAt", "created_at", "ts"], ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"],
];
const config = {
  file: "config.json",
  tables: ["orgs"],
  decode(org, json) {
    if (!isPlainObject(json)) return declined("config.json is not an object");
    const { cols, extra } = split(json, ORG_SPEC);
    return { orgs: [{ code: org, ...cols, extra: jsonOrNull(extra), has_config: true }] };
  },
  encode(org, t) {
    const row = (t.orgs || []).find((r) => r.code === org);
    if (!row || !row.has_config) return null;
    return join(row, ORG_SPEC, extraOf(row));
  },
};

const BILLING_SPEC = [["tier", "tier", "text"], ["requestedTier", "requested_tier", "text"], ["requestedAt", "requested_at", "ts"],
  ["requestedBy", "requested_by", "text"], ["lastModifiedAt", "last_modified_at", "ts"]];
const billing = {
  file: "billing.json",
  tables: ["org_billing"],
  decode(org, json) {
    if (!isPlainObject(json)) return declined("billing.json is not an object");
    if (json.tier !== undefined && json.tier !== "basic" && json.tier !== "business") return declined("unknown tier");
    const { cols, extra } = split(json, BILLING_SPEC);
    return { org_billing: [{ org_code: org, ...cols, extra: jsonOrNull(extra) }] };
  },
  encode(org, t) { const r = (t.org_billing || [])[0]; return r ? join(r, BILLING_SPEC, extraOf(r)) : null; },
};

const SETTINGS_SPEC = [
  ["timeZone", "time_zone", "text"], ["hpd", "hpd", "num"], ["workStart", "work_start", "text"], ["workEnd", "work_end", "text"],
  ["workDays", "work_days", "intArr"], ["holidays", "holidays", "dateArr"], ["lunch", "lunch", "json"], ["breaks", "breaks", "json"],
  ["payPeriodType", "pay_period_type", "text"], ["payPeriodStart", "pay_period_start", "date"], ["payDates", "pay_dates", "intArr"],
  ["payMode", "pay_mode", "text"], ["payAnchor", "pay_anchor", "date"], ["payPeriodHourCap", "pay_period_hour_cap", "num"],
  ["trackLunch", "track_lunch", "bool"], ["trackBreaks", "track_breaks", "bool"], ["iosPayClockEnabled", "ios_pay_clock_enabled", "bool"],
  ["approvalQueueLabel", "approval_queue_label", "text"], ["approverLabel", "approver_label", "text"],
  ["approvalSteps", "approval_steps", "textArr"], ["lastModifiedAt", "last_modified_at", "ts"],
];
const HHMM = /^\d{2}:\d{2}$/;
const STATUS_SPEC = [["name", "name", "text"], ["color", "color", "text"], ["icon", "icon", "text"], ["isFinished", "is_finished", "bool"], ["isActive", "is_active", "bool"]];
const PRI_SPEC = [["name", "name", "text"], ["color", "color", "text"]];
const CC_SPEC = [["id", "id", "text"], ["label", "label", "text"], ["type", "type", "text"], ["fieldKey", "field_key", "text"]];
const CCOPT_SPEC = [["name", "name", "text"], ["color", "color", "text"], ["icon", "icon", "text"]];
const SO_SPEC = [["id", "id", "text"], ["name", "name", "text"], ["steps", "steps", "textArr"]];
const EXP_SPEC = [["id", "id", "text"], ["name", "name", "text"], ["layout", "layout", "json"]];

const settings = {
  file: "settings.json",
  tables: ["org_settings", "org_departments", "org_status_options", "org_priority_options", "org_custom_columns", "org_custom_column_options", "org_conditions", "org_signoff_templates", "org_export_templates"],
  decode(org, json) {
    if (!isPlainObject(json)) return declined("settings.json is not an object");
    const listKeys = ["roles", "statusOpts", "priOpts", "customCols", "conditions", "signOffTemplates", "exportTemplates"];
    const scalars = Object.fromEntries(Object.entries(json).filter(([k]) => !listKeys.includes(k)));
    // work_start / work_end have a CHECK (HH:MM): any other spelling isn't offered to the
    // column, so split() leaves it in extra verbatim.
    const spec = SETTINGS_SPEC.filter(([k]) => !((k === "workStart" || k === "workEnd") && typeof scalars[k] === "string" && !HHMM.test(scalars[k])));
    const { cols, extra: ex } = split(scalars, spec);
    let extra = ex ? { ...ex } : {};
    const out = { org_settings: [], org_departments: [], org_status_options: [], org_priority_options: [], org_custom_columns: [], org_custom_column_options: [], org_conditions: [], org_signoff_templates: [], org_export_templates: [] };
    const take = (key, ok, fill) => { const v = json[key]; if (v === undefined) return; if (ok(v)) fill(v); else extra[key] = v; };
    take("roles", (v) => scalarRowsifiable(v) && v.every((x) => typeof x === "string"), (v) => v.forEach((name, position) => out.org_departments.push({ org_code: org, position, name })));
    const objs = (spec, table, mapRow) => (v) => v.forEach((o, position) => { const { cols: c, extra: e } = split(o, spec); out[table].push({ org_code: org, position, ...c, extra: jsonOrNull(e), ...(mapRow ? mapRow(o, position) : {}) }); });
    take("statusOpts", rowsifiable, objs(STATUS_SPEC, "org_status_options"));
    take("priOpts", rowsifiable, objs(PRI_SPEC, "org_priority_options"));
    take("customCols", (v) => rowsifiable(v) && v.every((c) => c.options === undefined || (Array.isArray(c.options) && c.options.every(isPlainObject))), (v) => v.forEach((c, position) => {
      const { options, ...rest } = c;
      const { cols: cc, extra: e } = split(rest, CC_SPEC);
      let ce = e;
      if (Array.isArray(options) && options.length === 0) ce = moveExtra(ce, "options", []);
      out.org_custom_columns.push({ org_code: org, position, ...cc, extra: jsonOrNull(cleanExtra(ce)) });
      (options || []).forEach((o, p) => { const { cols: oc, extra: oe } = split(o, CCOPT_SPEC); out.org_custom_column_options.push({ org_code: org, column_position: position, position: p, ...oc, extra: jsonOrNull(oe) }); });
    }));
    take("conditions", rowsifiable, (v) => v.forEach((doc, position) => out.org_conditions.push({ org_code: org, position, id: typeof doc.id === "string" ? doc.id : null, name: typeof doc.name === "string" ? doc.name : null, enabled: typeof doc.enabled === "boolean" ? doc.enabled : null, doc: wrapJson(doc) })));
    take("signOffTemplates", rowsifiable, objs(SO_SPEC, "org_signoff_templates"));
    take("exportTemplates", rowsifiable, objs(EXP_SPEC, "org_export_templates"));
    out.org_settings.push({ org_code: org, ...cols, extra: jsonOrNull(cleanExtra(extra)) });
    return out;
  },
  encode(org, t) {
    const s = (t.org_settings || [])[0];
    if (!s) return null;
    const out = join(s, SETTINGS_SPEC, null);
    const dep = byPos(t.org_departments); if (dep.length) out.roles = dep.map((r) => r.name);
    const list = (table, spec, key, extraFn) => { const rows = byPos(t[table]); if (rows.length) out[key] = rows.map((r) => ({ ...join(r, spec, extraOf(r)), ...(extraFn ? extraFn(r) : {}) })); };
    list("org_status_options", STATUS_SPEC, "statusOpts");
    list("org_priority_options", PRI_SPEC, "priOpts");
    const cc = byPos(t.org_custom_columns);
    if (cc.length) out.customCols = cc.map((r) => {
      const o = join(r, CC_SPEC, extraOf(r));
      const opts = byPos((t.org_custom_column_options || []).filter((x) => x.column_position === r.position));
      if (opts.length) o.options = opts.map((x) => join(x, CCOPT_SPEC, extraOf(x)));
      return o;
    });
    const cond = byPos(t.org_conditions); if (cond.length) out.conditions = cond.map((r) => unwrapJson(r.doc));
    list("org_signoff_templates", SO_SPEC, "signOffTemplates");
    list("org_export_templates", EXP_SPEC, "exportTemplates");
    const e = extraOf(s); if (e) Object.assign(out, e);
    return out;
  },
};

// ── people ─────────────────────────────────────────────────────────────────

const PERSON_SPEC = [
  ["name", "name", "text"], ["email", "email", "text"], ["phone", "phone", "text"], ["image", "image", "text"], ["color", "color", "text"],
  ["department", "department", "text"], ["role", "role", "text"], ["secondaryDepartment", "secondary_department", "text"],
  ["cap", "cap", "num"], ["teamNumber", "team_number", "num"], ["userRole", "user_role", "text"], ["isEngineer", "is_engineer", "bool"],
  ["canSignOff", "can_sign_off", "bool"], ["canClockInOut", "can_clock_in_out", "bool"], ["noAutoSchedule", "no_auto_schedule", "bool"],
  ["autoSchedule", "auto_schedule", "bool"], ["payType", "pay_type", "text"], ["pin", "pin_secret", "text"], ["pushToken", "push_token", "text"],
  ["invitedBy", "invited_by", "text"], ["joinedAt", "joined_at", "ts"], ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"],
];
const TIMEOFF_ENTRY_SPEC = [["start", "start", "date"], ["end", "end", "date"], ["type", "type", "text"], ["reason", "reason", "text"], ["status", "status", "text"], ["reqId", "req_id", "text"]];
const LIVE_KINDS = ["activeClockIn", "activeJobClock", "activeBreak"];
const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);

const people = {
  file: "people.json",
  tables: ["people", "person_admin_perms", "person_time_off", "person_reviews", "person_live_state"],
  decode(org, json) {
    if (!Array.isArray(json)) return declined("people.json is not an array");
    if (!json.every(idOk)) return declined("a person without a string/number id");
    if (!uniqueIds(json)) return declined("a person id appears twice");
    const out = { people: [], person_admin_perms: [], person_time_off: [], person_reviews: [], person_live_state: [] };
    json.forEach((p, position) => {
      const id = String(p.id);
      const { cols, extra: ex } = split(p, PERSON_SPEC, { skip: ["id", "adminPerms", "timeOff", "reviews", ...LIVE_KINDS] });
      let extra = ex ? { ...ex } : {};
      // email is citext: only a plain string goes in the column
      let state = "absent";
      if (p.adminPerms === null) state = "null";
      else if (isPlainObject(p.adminPerms)) {
        state = "map";
        Object.entries(p.adminPerms).forEach(([perm, granted], i) => out.person_admin_perms.push({ org_code: org, person_id: id, position: i, perm, granted: wrapJson(granted) }));
      } else if (p.adminPerms !== undefined) extra.adminPerms = p.adminPerms;
      if (rowsifiable(p.timeOff)) p.timeOff.forEach((e, i) => { const { cols: c, extra: x } = split(e, TIMEOFF_ENTRY_SPEC); out.person_time_off.push({ org_code: org, person_id: id, position: i, ...c, extra: jsonOrNull(x) }); });
      else if (p.timeOff !== undefined) extra.timeOff = p.timeOff;
      if (rowsifiable(p.reviews)) p.reviews.forEach((doc, i) => out.person_reviews.push({ org_code: org, person_id: id, position: i, doc: wrapJson(doc) }));
      else if (p.reviews !== undefined) extra.reviews = p.reviews;
      for (const kind of LIVE_KINDS) {
        if (!(kind in p)) continue;
        const doc = p[kind];
        if (doc !== null && !isPlainObject(doc)) { extra[kind] = doc; continue; }
        out.person_live_state.push({ org_code: org, person_id: id, kind, doc: wrapJson(doc),
          clock_in: str(doc?.clockIn), job_id: str(doc?.jobId), panel_id: str(doc?.panelId), op_id: str(doc?.opId), session_id: str(doc?.sessionId) });
      }
      out.people.push({ org_code: org, id, id_num: typeof p.id === "number", position, ...cols, admin_perms_state: state, extra: jsonOrNull(cleanExtra(extra)) });
    });
    return out;
  },
  encode(org, t) {
    return byPos(t.people).map((r) => {
      const p = { id: r.id_num ? Number(r.id) : r.id, ...join(r, PERSON_SPEC, null) };
      if (r.admin_perms_state === "null") p.adminPerms = null;
      else if (r.admin_perms_state === "map") p.adminPerms = Object.fromEntries(byPos((t.person_admin_perms || []).filter((x) => x.person_id === r.id)).map((x) => [x.perm, unwrapJson(x.granted)]));
      const to = byPos((t.person_time_off || []).filter((x) => x.person_id === r.id));
      if (to.length) p.timeOff = to.map((x) => join(x, TIMEOFF_ENTRY_SPEC, extraOf(x)));
      const rv = byPos((t.person_reviews || []).filter((x) => x.person_id === r.id));
      if (rv.length) p.reviews = rv.map((x) => unwrapJson(x.doc));
      for (const kind of LIVE_KINDS) { const s = (t.person_live_state || []).find((x) => x.person_id === r.id && x.kind === kind); if (s) p[kind] = unwrapJson(s.doc); }
      const e = extraOf(r); if (e) Object.assign(p, e);
      return p;
    });
  },
};

// ── clients ────────────────────────────────────────────────────────────────

const CLIENT_SPEC = [["name", "name", "text"], ["contact", "contact", "text"], ["email", "email", "text"], ["phone", "phone", "text"],
  ["color", "color", "text"], ["notes", "notes", "text"], ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"]];
const flatArray = ({ file, table, spec, idCol = "id" }) => ({
  file, tables: [table],
  decode(org, json) {
    if (!Array.isArray(json)) return declined(`${file} is not an array`);
    if (!json.every((r) => isPlainObject(r) && typeof r.id === "string")) return declined(`a ${file} row without a string id`);
    if (!uniqueIds(json)) return declined(`an id appears twice in ${file}`);
    return { [table]: json.map((r, position) => { const { cols, extra } = split(r, spec, { skip: ["id"] }); return { org_code: org, [idCol]: r.id, position, ...cols, extra: jsonOrNull(extra) }; }) };
  },
  encode(org, t) { return byPos(t[table]).map((r) => ({ id: r[idCol], ...join(r, spec, extraOf(r)) })); },
});
const clients = flatArray({ file: "clients.json", table: "clients", spec: CLIENT_SPEC });

// ── the work tree ──────────────────────────────────────────────────────────

const NODE_SPEC = [
  ["title", "title", "text"], ["status", "status", "text"], ["pri", "pri", "text"], ["start", "start", "date"], ["end", "end", "date"],
  ["startHour", "start_hour", "num"], ["endHour", "end_hour", "num"], ["hpd", "hpd", "num"], ["notes", "notes", "text"], ["color", "color", "text"],
  ["locked", "locked", "bool"], ["loggedHours", "logged_hours", "num"], ["pendingFinish", "pending_finish", "bool"],
  ["requiredDepartment", "required_department", "text"], ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"],
];
const JOB_SPEC = [["jobNumber", "job_number", "text"], ["poNumber", "po_number", "text"], ["jobType", "job_type", "text"], ["dueDate", "due_date", "date"],
  ["clientId", "client_id", "text"], ["projectManagerId", "project_manager_id", "text"], ["scheduledLater", "scheduled_later", "bool"],
  ["isReschedule", "is_reschedule", "bool"], ["createdAt", "created_at", "ts"], ["archivedAt", "archived_at", "ts"]];
const PANEL_SPEC = [["engineering", "engineering", "json"], ["depsMode", "deps_mode", "text"], ["qty", "qty", "num"]];
const OP_SPEC = [["splitFrom", "split_from", "text"], ["finishedAt", "finished_at", "ts"]];
const KIND_SPEC = { job: JOB_SPEC, panel: PANEL_SPEC, op: OP_SPEC };
const MOVE_SPEC = [["date", "date", "text"], ["movedBy", "moved_by", "text"], ["reason", "reason", "text"],
  ["fromStart", "from_start", "text"], ["toStart", "to_start", "text"], ["fromEnd", "from_end", "text"], ["toEnd", "to_end", "text"],
  ["fromStartHour", "from_start_hour", "num"], ["toStartHour", "to_start_hour", "num"], ["fromEndHour", "from_end_hour", "num"], ["toEndHour", "to_end_hour", "num"],
  ["fromHpd", "from_hpd", "num"], ["toHpd", "to_hpd", "num"], ["sessionId", "session_id", "text"], ["runId", "run_id", "text"]];
const FR_SPEC = [["id", "id", "text"], ["by", "by", "text"], ["byName", "by_name", "text"], ["at", "at", "ts"], ["status", "status", "text"],
  ["resolvedBy", "resolved_by", "text"], ["resolvedByName", "resolved_by_name", "text"], ["resolvedAt", "resolved_at", "ts"], ["declineReason", "decline_reason", "text"]];
const ATT_SPEC = [["key", "s3_key", "text"], ["filename", "filename", "text"], ["mimeType", "mime_type", "text"], ["size", "size", "num"],
  ["uploadedById", "uploaded_by_id", "text"], ["uploadedByName", "uploaded_by_name", "text"], ["uploadedAt", "uploaded_at", "ts"], ["opId", "op_id", "text"]];
const NODE_CHILD_KEYS = ["id", "subs", "team", "deps", "requiredDepartments", "moveLog", "finishRequests", "attachments"];
const KIND_AT_DEPTH = ["job", "panel", "op"];

function attachmentRows(org, ownerKind, ownerId, list, out) {
  list.forEach((a, position) => { const { cols, extra } = split(a, ATT_SPEC); out.attachments.push({ org_code: org, owner_kind: ownerKind, owner_id: ownerId, position, ...cols, extra: jsonOrNull(extra) }); });
}
function attachmentsOf(t, ownerKind, ownerId) {
  return byPos((t.attachments || []).filter((a) => a.owner_kind === ownerKind && a.owner_id === ownerId)).map((a) => join(a, ATT_SPEC, extraOf(a)));
}

const tasks = {
  file: "tasks.json",
  tables: ["nodes", "node_team", "node_deps", "node_required_departments", "node_move_log", "node_finish_requests", "attachments"],
  scope: { attachments: "owner_kind = 'node'" },
  decode(org, json) {
    if (!Array.isArray(json)) return declined("tasks.json is not an array");
    const out = { nodes: [], node_team: [], node_deps: [], node_required_departments: [], node_move_log: [], node_finish_requests: [], attachments: [] };
    const seen = new Set();
    let problem = null;
    const walk = (node, depth, parentId, jobId, position) => {
      if (problem) return;
      if (!isPlainObject(node) || typeof node.id !== "string" || node.id === "") { problem = "a node without a string id"; return; }
      if (seen.has(node.id)) { problem = `node id ${node.id} appears twice`; return; }
      seen.add(node.id);
      const kind = KIND_AT_DEPTH[depth];
      const spec = [...NODE_SPEC, ...KIND_SPEC[kind]];
      const { cols, extra: ex } = split(node, spec, { skip: NODE_CHILD_KEYS });
      let extra = ex ? { ...ex } : {};
      // fields of another kind found on this node stay in extra (CHECKs keep columns kind-pure)
      for (const [k, s] of Object.entries(KIND_SPEC)) if (k !== kind) for (const [jk] of s) if (jk in node && !(jk in extra)) extra[jk] = node[jk];
      const id = node.id;
      const list = (key, rowsOk, fill) => { const v = node[key]; if (v === undefined) return; if (rowsOk(v)) fill(v); else extra[key] = v; };
      list("team", scalarRowsifiable, (v) => v.forEach((p, i) => out.node_team.push({ org_code: org, node_id: id, position: i, person_id: wrapJson(p) })));
      list("deps", scalarRowsifiable, (v) => v.forEach((p, i) => out.node_deps.push({ org_code: org, node_id: id, position: i, dep_id: wrapJson(p) })));
      list("requiredDepartments", scalarRowsifiable, (v) => v.forEach((p, i) => out.node_required_departments.push({ org_code: org, node_id: id, position: i, department: wrapJson(p) })));
      list("moveLog", rowsifiable, (v) => v.forEach((e, i) => { const { cols: c, extra: x } = split(e, MOVE_SPEC); out.node_move_log.push({ org_code: org, node_id: id, seq: i, ...c, extra: jsonOrNull(x) }); }));
      list("finishRequests", rowsifiable, (v) => v.forEach((e, i) => { const { cols: c, extra: x } = split(e, FR_SPEC); out.node_finish_requests.push({ org_code: org, node_id: id, position: i, ...c, extra: jsonOrNull(x) }); }));
      list("attachments", rowsifiable, (v) => attachmentRows(org, "node", id, v, out));
      const subs = node.subs;
      const childrenOk = depth < 2 && rowsifiable(subs);
      if (subs !== undefined && !childrenOk) extra.subs = subs;   // ops' template subs, [] and odd shapes stay verbatim
      out.nodes.push({ org_code: org, id, kind, parent_id: parentId, job_id: jobId || id, position, ...cols, extra: jsonOrNull(cleanExtra(extra)) });
      if (childrenOk) subs.forEach((c, i) => walk(c, depth + 1, id, jobId || id, i));
    };
    json.forEach((job, i) => walk(job, 0, null, null, i));
    if (problem) return declined(problem);
    return out;
  },
  encode(org, t) {
    const kids = new Map();
    for (const n of t.nodes || []) { const k = n.parent_id ?? "\u0000root"; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(n); }
    const scal = (table, col, id) => byPos((t[table] || []).filter((x) => x.node_id === id)).map((x) => unwrapJson(x[col]));
    const build = (n) => {
      const o = { id: n.id, ...join(n, [...NODE_SPEC, ...KIND_SPEC[n.kind]], null) };
      const team = scal("node_team", "person_id", n.id); if (team.length) o.team = team;
      const deps = scal("node_deps", "dep_id", n.id); if (deps.length) o.deps = deps;
      const dd = scal("node_required_departments", "department", n.id); if (dd.length) o.requiredDepartments = dd;
      const ml = [...(t.node_move_log || []).filter((x) => x.node_id === n.id)].sort((a, b) => a.seq - b.seq); if (ml.length) o.moveLog = ml.map((x) => join(x, MOVE_SPEC, extraOf(x)));
      const fr = byPos((t.node_finish_requests || []).filter((x) => x.node_id === n.id)); if (fr.length) o.finishRequests = fr.map((x) => join(x, FR_SPEC, extraOf(x)));
      const at = attachmentsOf(t, "node", n.id); if (at.length) o.attachments = at;
      const children = byPos(kids.get(n.id) || []); if (children.length) o.subs = children.map(build);
      const e = extraOf(n); if (e) Object.assign(o, e);
      return o;
    };
    return byPos(kids.get("\u0000root") || []).map(build);
  },
};

const ARCHIVE_SPEC = [["archivedAt", "archived_at", "ts"], ["fromVersionId", "from_version_id", "text"], ["job", "job", "json"]];
const tasksArchive = {
  file: "tasks-archive.json", tables: ["tasks_archive"],
  decode(org, json) {
    if (!Array.isArray(json) || !json.every(isPlainObject)) return declined("tasks-archive.json is not an array of objects");
    return { tasks_archive: json.map((r, position) => { const { cols, extra } = split(r, ARCHIVE_SPEC); return { org_code: org, position, ...cols, extra: jsonOrNull(extra) }; }) };
  },
  encode(org, t) { return byPos(t.tasks_archive).map((r) => join(r, ARCHIVE_SPEC, extraOf(r))); },
};

// ── chat ───────────────────────────────────────────────────────────────────

const GROUP_SPEC = [["name", "name", "text"], ["createdBy", "created_by", "json"], ["createdAt", "created_at", "ts"], ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"]];
const groups = {
  file: "groups.json", tables: ["chat_groups", "chat_group_members"],
  decode(org, json) {
    if (!Array.isArray(json)) return declined("groups.json is not an array");
    if (!json.every((g) => isPlainObject(g) && typeof g.id === "string")) return declined("a group without a string id");
    if (!uniqueIds(json)) return declined("a group id appears twice");
    const out = { chat_groups: [], chat_group_members: [] };
    json.forEach((g, position) => {
      const { cols, extra: ex } = split(g, GROUP_SPEC, { skip: ["id", "memberIds"] });
      let extra = ex ? { ...ex } : {};
      if (scalarRowsifiable(g.memberIds)) g.memberIds.forEach((m, i) => out.chat_group_members.push({ org_code: org, group_id: g.id, position: i, member_id: wrapJson(m) }));
      else if (g.memberIds !== undefined) extra.memberIds = g.memberIds;
      out.chat_groups.push({ org_code: org, id: g.id, position, ...cols, extra: jsonOrNull(cleanExtra(extra)) });
    });
    return out;
  },
  encode(org, t) {
    return byPos(t.chat_groups).map((r) => {
      const g = { id: r.id, ...join(r, GROUP_SPEC, null) };
      const m = byPos((t.chat_group_members || []).filter((x) => x.group_id === r.id)); if (m.length) g.memberIds = m.map((x) => unwrapJson(x.member_id));
      const e = extraOf(r); if (e) Object.assign(g, e);
      return g;
    });
  },
};

const MSG_SPEC = [["threadKey", "thread_key", "text"], ["scope", "scope", "text"], ["jobId", "job_id", "text"], ["panelId", "panel_id", "text"], ["opId", "op_id", "text"],
  ["text", "text", "text"], ["authorId", "author_id", "text"], ["authorName", "author_name", "text"], ["authorColor", "author_color", "text"], ["type", "type", "text"],
  ["finishRequestId", "finish_request_id", "text"], ["timeOffRequestId", "time_off_request_id", "text"], ["timestamp", "timestamp", "ts"],
  ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"]];
const messages = {
  file: "messages.json", tables: ["messages", "message_participants", "attachments"],
  scope: { attachments: "owner_kind = 'message'" },
  decode(org, json) {
    if (!Array.isArray(json)) return declined("messages.json is not an array");
    if (!json.every((m) => isPlainObject(m) && typeof m.id === "string")) return declined("a message without a string id");
    if (!uniqueIds(json)) return declined("a message id appears twice");
    const out = { messages: [], message_participants: [], attachments: [] };
    json.forEach((m, position) => {
      const { cols, extra: ex } = split(m, MSG_SPEC, { skip: ["id", "participantIds", "attachments"] });
      let extra = ex ? { ...ex } : {};
      if (scalarRowsifiable(m.participantIds)) m.participantIds.forEach((p, i) => out.message_participants.push({ org_code: org, message_id: m.id, position: i, person_id: wrapJson(p) }));
      else if (m.participantIds !== undefined) extra.participantIds = m.participantIds;
      if (rowsifiable(m.attachments)) attachmentRows(org, "message", m.id, m.attachments, out);
      else if (m.attachments !== undefined) extra.attachments = m.attachments;
      out.messages.push({ org_code: org, id: m.id, position, ...cols, extra: jsonOrNull(cleanExtra(extra)) });
    });
    return out;
  },
  encode(org, t) {
    return byPos(t.messages).map((r) => {
      const m = { id: r.id, ...join(r, MSG_SPEC, null) };
      const p = byPos((t.message_participants || []).filter((x) => x.message_id === r.id)); if (p.length) m.participantIds = p.map((x) => unwrapJson(x.person_id));
      const at = attachmentsOf(t, "message", r.id); if (at.length) m.attachments = at;
      const e = extraOf(r); if (e) Object.assign(m, e);
      return m;
    });
  },
};

const reads = {
  file: "reads.json", tables: ["message_reads"],
  decode(org, json) {
    if (!isPlainObject(json) || !Object.values(json).every(isPlainObject)) return declined("reads.json is not {thread: {person: at}}");
    const rows = [];
    Object.entries(json).forEach(([thread_key, per], thread_pos) => Object.entries(per).forEach(([person_id, at], person_pos) => rows.push({ org_code: org, thread_key, thread_pos, person_id, person_pos, read_up_to: wrapJson(at) })));
    // an empty thread object would vanish: decline rather than lose it
    if (Object.values(json).some((per) => Object.keys(per).length === 0)) return declined("a thread with no readers");
    return { message_reads: rows };
  },
  encode(org, t) {
    const rows = [...(t.message_reads || [])].sort((a, b) => a.thread_pos - b.thread_pos || a.person_pos - b.person_pos);
    const out = {};
    for (const r of rows) (out[r.thread_key] ??= {})[r.person_id] = unwrapJson(r.read_up_to);
    return out;
  },
};

// ── time ───────────────────────────────────────────────────────────────────

const PUNCH_SPEC = [["personId", "person_id", "json"], ["date", "date", "date"], ["clockIn", "clock_in", "ts"], ["clockOut", "clock_out", "ts"], ["hours", "hours", "num"],
  ["note", "note", "text"], ["source", "source", "text"], ["jobRefs", "job_refs", "json"], ["forgotNotifiedAt", "forgot_notified_at", "ts"], ["confirmed", "confirmed", "bool"],
  ["confirmedAt", "confirmed_at", "ts"], ["confirmedBy", "confirmed_by", "text"], ["overnightAckAt", "overnight_ack_at", "ts"], ["overnightAckBy", "overnight_ack_by", "text"],
  ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"]];
const EVENT_TYPES = ["lunchStart", "lunchEnd", "breakStart", "breakEnd"];
const EVENT_SPEC = [["personId", "person_id", "json"], ["date", "date", "date"], ["eventType", "event_type", "text"], ["timestamp", "timestamp", "ts"],
  ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"]];
const payhours = {
  file: "payhours.json", tables: ["time_punches", "time_events", "time_ledger_order"],
  decode(org, json) {
    if (!Array.isArray(json)) return declined("payhours.json is not an array");
    const out = { time_punches: [], time_events: [], time_ledger_order: [] };
    const ids = { punch: new Set(), event: new Set() };
    let problem = null;
    json.forEach((r, position) => {
      const isRow = isPlainObject(r) && typeof r.id === "string";
      const isEvent = isRow && typeof r.eventType === "string";
      const kind = !isRow ? "other" : isEvent ? "event" : "punch";
      if (kind === "other") { out.time_ledger_order.push({ org_code: org, position, kind, row_id: null, other: wrapJson(r) }); return; }
      if (ids[kind].has(r.id)) { problem = `${kind} id ${r.id} appears twice`; return; }
      ids[kind].add(r.id);
      const spec = isEvent ? EVENT_SPEC.map((s) => (s[0] === "eventType" && !EVENT_TYPES.includes(r.eventType) ? null : s)).filter(Boolean) : PUNCH_SPEC;
      const { cols, extra } = split(r, spec, { skip: ["id"] });
      (isEvent ? out.time_events : out.time_punches).push({ org_code: org, id: r.id, position, ...cols, extra: jsonOrNull(extra) });
      out.time_ledger_order.push({ org_code: org, position, kind, row_id: r.id, other: null });
    });
    if (problem) return declined(problem);
    return out;
  },
  encode(org, t) {
    const punches = new Map((t.time_punches || []).map((r) => [r.id, r]));
    const events = new Map((t.time_events || []).map((r) => [r.id, r]));
    return byPos(t.time_ledger_order).map((o) => {
      if (o.kind === "other") return unwrapJson(o.other);
      const r = o.kind === "event" ? events.get(o.row_id) : punches.get(o.row_id);
      return { id: r.id, ...join(r, o.kind === "event" ? EVENT_SPEC : PUNCH_SPEC, extraOf(r)) };
    });
  },
};

const PROD_SPEC = [["personId", "person_id", "json"], ["jobId", "job_id", "text"], ["panelId", "panel_id", "text"], ["opId", "op_id", "text"],
  ["jobTitle", "job_title", "text"], ["panelTitle", "panel_title", "text"], ["opTitle", "op_title", "text"], ["clockIn", "clock_in", "ts"], ["clockOut", "clock_out", "ts"],
  ["hours", "hours", "num"], ["date", "date", "date"], ["source", "source", "text"], ["adjustment", "adjustment", "bool"], ["enteredBy", "entered_by", "text"],
  ["enteredAt", "entered_at", "ts"], ["lastModifiedAt", "last_modified_at", "ts"], ["deletedAt", "deleted_at", "ts"]];
const productionhours = flatArray({ file: "productionhours.json", table: "production_sessions", spec: PROD_SPEC });

const TO_SPEC = [["personId", "person_id", "text"], ["personName", "person_name", "text"], ["type", "type", "text"], ["start", "start", "date"], ["end", "end", "date"],
  ["note", "note", "text"], ["status", "status", "text"], ["createdAt", "created_at", "ts"], ["decidedBy", "decided_by", "text"], ["decidedByName", "decided_by_name", "text"],
  ["decidedAt", "decided_at", "ts"], ["denialReason", "denial_reason", "text"], ["groupId", "group_id", "text"]];
const timeoffBase = flatArray({ file: "timeoff.json", table: "time_off_requests", spec: TO_SPEC });
const timeoff = {
  ...timeoffBase,
  decode(org, json) {
    const r = timeoffBase.decode(org, json);
    if (r.declined) return r;
    // status has a CHECK; an unknown status stays in extra
    for (const row of r.time_off_requests) if (row.status !== undefined && !["pending", "approved", "denied", "cancelled"].includes(row.status)) {
      row.extra = wrapJson({ ...(unwrapJson(row.extra) || {}), status: row.status }); delete row.status;
    }
    return r;
  },
};

const jobclockAlerts = {
  file: "jobclock-alerts.json", tables: ["jobclock_alerts"],
  decode(org, json) {
    if (!isPlainObject(json)) return declined("jobclock-alerts.json is not an object");
    return { jobclock_alerts: Object.entries(json).map(([person_id, v], position) => ({ org_code: org, position, person_id, clock_in: wrapJson(v) })) };
  },
  encode(org, t) { return Object.fromEntries(byPos(t.jobclock_alerts).map((r) => [r.person_id, unwrapJson(r.clock_in)])); },
};

// ── accounts ───────────────────────────────────────────────────────────────

const INVITE_SPEC = [["token", "token", "text"], ["email", "email", "text"], ["role", "role", "text"], ["invitedBy", "invited_by", "text"], ["personId", "person_id", "json"],
  ["name", "name", "text"], ["createdAt", "created_at", "ts"], ["expiresAt", "expires_at", "ts"], ["acceptedAt", "accepted_at", "ts"], ["revokedAt", "revoked_at", "ts"]];
const invitesBase = flatArray({ file: "invites.json", table: "invites", spec: INVITE_SPEC });
const invites = {
  ...invitesBase,
  decode(org, json) {
    const r = invitesBase.decode(org, json);
    if (r.declined) return r;
    const tokens = r.invites.map((x) => x.token).filter((x) => x != null);
    if (new Set(tokens).size !== tokens.length) return declined("an invite token appears twice");
    return r;
  },
};

const pushSubs = {
  file: "push-subs.json", tables: ["push_subscriptions"],
  decode(org, json) {
    if (!isPlainObject(json) || !Object.values(json).every((v) => Array.isArray(v) && v.length > 0)) return declined("push-subs.json is not {person: [sub, ...]}");
    const rows = [];
    Object.entries(json).forEach(([person_key, subs], person_pos) => subs.forEach((doc, position) => rows.push({ org_code: org, person_key, person_pos, position, endpoint: typeof doc?.endpoint === "string" ? doc.endpoint : null, doc: wrapJson(doc) })));
    return { push_subscriptions: rows };
  },
  encode(org, t) {
    const rows = [...(t.push_subscriptions || [])].sort((a, b) => a.person_pos - b.person_pos || a.position - b.position);
    const out = {};
    for (const r of rows) (out[r.person_key] ??= []).push(unwrapJson(r.doc));
    return out;
  },
};

const ruleEvents = {
  file: "rule-events.json", tables: ["rule_events", "rule_event_drops"],
  decode(org, json) {
    if (!isPlainObject(json) || Object.keys(json).some((k) => k !== "dropped" && k !== "records")) return declined("rule-events.json has unexpected keys");
    if (json.dropped !== undefined && !(isPlainObject(json.dropped) && Object.values(json.dropped).every((n) => typeof n === "number"))) return declined("rule-events dropped is not {tag: n}");
    if (json.records !== undefined && !(Array.isArray(json.records) && json.records.every(isPlainObject))) return declined("rule-events records is not a list");
    if (json.dropped === undefined || json.records === undefined) return declined("rule-events is missing dropped or records");
    return {
      rule_events: json.records.map((doc, i) => ({ org_code: org, id: i + 1, at: typeof doc.at === "string" ? doc.at : null, tag: typeof doc.tag === "string" ? doc.tag : null, doc: wrapJson(doc) })),
      rule_event_drops: Object.entries(json.dropped).map(([tag, dropped]) => ({ org_code: org, tag, dropped })),
    };
  },
  encode(org, t) {
    return { dropped: Object.fromEntries((t.rule_event_drops || []).map((r) => [r.tag, Number(r.dropped)])), records: [...(t.rule_events || [])].sort((a, b) => Number(a.id) - Number(b.id)).map((r) => unwrapJson(r.doc)) };
  },
};

// ── keys outside the org files ─────────────────────────────────────────────

const userSettings = {
  tables: ["user_settings"],
  decode(org, json, emailKey) { return isPlainObject(json) ? { user_settings: [{ org_code: org, email_key: emailKey, doc: wrapJson(json) }] } : declined("user settings is not an object"); },
  encode(org, t) { const r = (t.user_settings || [])[0]; return r ? unwrapJson(r.doc) : null; },
};
const authCache = {
  tables: ["auth_cache"],
  decode(_org, json, key) { return { auth_cache: [{ key, doc: wrapJson(json) }] }; },
  encode(_org, t) { const r = (t.auth_cache || [])[0]; return r ? unwrapJson(r.doc) : null; },
};

export const ORG_FILE_CODECS = {
  "config.json": config, "billing.json": billing, "settings.json": settings, "people.json": people, "clients.json": clients,
  "tasks.json": tasks, "tasks-archive.json": tasksArchive, "groups.json": groups, "messages.json": messages, "reads.json": reads,
  "payhours.json": payhours, "productionhours.json": productionhours, "timeoff.json": timeoff, "jobclock-alerts.json": jobclockAlerts,
  "invites.json": invites, "push-subs.json": pushSubs, "rule-events.json": ruleEvents,
};

const ORG_RE = /^orgs\/([A-Za-z0-9]{3,20}|[A-Z]{3}\.[A-Z0-9]{4}\.[A-Z0-9]{4})\/(.+)$/;

/**
 * Which codec owns a storage key, and the scope its rows live under:
 *   { codec, org, sub }  sub = the user-settings email key / the auth-cache key
 *   null                 -> raw_documents
 */
export function codecFor(key) {
  const m = ORG_RE.exec(key);
  if (m) {
    const [, org, rest] = m;
    if (ORG_FILE_CODECS[rest]) return { codec: ORG_FILE_CODECS[rest], org, sub: null, name: rest };
    const us = /^user-settings\/([^/]+)\.json$/.exec(rest);
    if (us) return { codec: userSettings, org, sub: us[1], name: "user-settings" };
    return null;
  }
  const ac = /^authcache\/([^/]+)\.json$/.exec(key);
  if (ac) return { codec: authCache, org: null, sub: ac[1], name: "authcache" };
  return null;
}

/** decode with the key's codec; { tables } or { declined } or { raw: true } when no codec owns it. */
export function decodeKey(key, json) {
  const c = codecFor(key);
  if (!c) return { raw: true };
  if (json === null || json === undefined) return { declined: "null document" };
  const t = c.codec.decode(c.org, json, c.sub);
  return t.declined ? t : { tables: t, owner: c };
}

export function encodeKey(key, tables) {
  const c = codecFor(key);
  return c.codec.encode(c.org, tables, c.sub);
}
