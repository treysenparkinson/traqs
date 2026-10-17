// The relational schema exists and enforces what it claims (Postgres migration plan, step 3).
//
// Every table in docs/db/schema-design.md is created by db/migrations/; the integrity the
// database adds on day one actually bites: tenant-scoped keys, kind CHECKs on the work tree,
// enum CHECKs, cascades, an append-only move log, and a change_log row (with its actor) for
// every write to an audited table.

import { openTestDb } from "./db/test-db.mjs";

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};
const refuses = async (c, sql, params, pattern) => {
  await c.query("savepoint s");
  try { await c.query(sql, params); await c.query("rollback to savepoint s"); return "accepted"; }
  catch (e) { await c.query("rollback to savepoint s"); return pattern.test(e.message) ? true : e.message; }
};

const TABLES = [
  "orgs", "org_billing", "org_settings", "org_departments", "org_status_options", "org_priority_options",
  "org_custom_columns", "org_custom_column_options", "org_conditions", "org_signoff_templates", "org_export_templates",
  "people", "person_admin_perms", "person_time_off", "person_reviews", "person_live_state",
  "clients", "nodes", "node_team", "node_deps", "node_required_departments", "node_move_log", "node_finish_requests",
  "attachments", "tasks_archive",
  "chat_groups", "chat_group_members", "messages", "message_participants", "message_reads",
  "time_punches", "time_events", "time_ledger_order", "production_sessions", "time_off_requests", "jobclock_alerts",
  "invites", "push_subscriptions", "user_settings", "auth_cache",
  "rule_events", "rule_event_drops", "raw_documents", "store_versions", "change_log", "external_links", "integration_outbox",
];

const db = await openTestDb();
const c = db.client;
try {
  console.log("db-schema: tables");
  const have = new Set((await c.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name));
  ok("every designed table exists", TABLES.filter((t) => !have.has(t)), []);
  ok("no undesigned table snuck in", [...have].filter((t) => !TABLES.includes(t) && t !== "schema_migrations").sort(), []);
  const noPk = (await c.query(`select t.table_name from information_schema.tables t where t.table_schema = 'public'
    and not exists (select 1 from information_schema.table_constraints k where k.table_name = t.table_name and k.constraint_type = 'PRIMARY KEY')`)).rows.map((r) => r.table_name);
  ok("every table has a primary key", noPk, []);
  const tenantless = (await c.query(`select table_name from information_schema.tables t where table_schema = 'public'
    and table_name not in ('schema_migrations', 'orgs', 'raw_documents', 'store_versions', 'auth_cache', 'change_log')
    and not exists (select 1 from information_schema.columns k where k.table_name = t.table_name and k.column_name = 'org_code')`)).rows.map((r) => r.table_name);
  ok("every tenant table carries org_code", tenantless, []);

  console.log("db-schema: integrity");
  await c.query("begin");
  await c.query("insert into orgs (code, name, has_config) values ('TESTORG', 'T', true), ('MAT.CEPE.3A96', 'M', true)");
  ok("an org code outside both formats is refused", await refuses(c, "insert into orgs (code) values ($1)", ["bad code!"], /orgs_code_format/));
  await c.query("insert into nodes (org_code, id, kind, parent_id, job_id, position) values ('TESTORG', 'j1', 'job', null, 'j1', 0), ('TESTORG', 'p1', 'panel', 'j1', 'j1', 0), ('TESTORG', 'o1', 'op', 'p1', 'j1', 0)");
  ok("a job with a parent is refused", await refuses(c, "insert into nodes (org_code, id, kind, parent_id, job_id, position) values ('TESTORG', 'jx', 'job', 'j1', 'j1', 1)", [], /check/));
  ok("an op carrying a job number is refused", await refuses(c, "insert into nodes (org_code, id, kind, parent_id, job_id, position, job_number) values ('TESTORG', 'ox', 'op', 'p1', 'j1', 1, '24-1')", [], /check/));
  ok("a panel carrying split_from is refused", await refuses(c, "insert into nodes (org_code, id, kind, parent_id, job_id, position, split_from) values ('TESTORG', 'px', 'panel', 'j1', 'j1', 1, 'o1')", [], /check/));
  ok("the same node id may exist in another org", await refuses(c, "insert into nodes (org_code, id, kind, parent_id, job_id, position) values ('MAT.CEPE.3A96', 'j1', 'job', null, 'j1', 0)", [], /never/), "accepted");
  ok("an unknown time event type is refused", await refuses(c, "insert into time_events (org_code, id, position, event_type) values ('TESTORG', 'e1', 0, 'nap')", [], /check/));
  ok("an unknown request status is refused", await refuses(c, "insert into time_off_requests (org_code, id, position, status) values ('TESTORG', 'r1', 0, 'maybe')", [], /check/));
  ok("a deferred FK to a missing org fails at commit, not at insert", await refuses(c, "insert into clients (org_code, id, position) values ('NOPE1', 'c1', 0); set constraints all immediate", [], /foreign key/));

  console.log("db-schema: the move log (migration 008: rewrites audited, never silently removed)");
  await c.query("insert into node_move_log (org_code, node_id, seq, moved_by, reason) values ('TESTORG', 'o1', 0, 'Ada', 'Moved')");
  // Handlers rewrite stored entries today (#567: repaired fields, client key order), so phase 1
  // allows the rewrite — and records it, before and after.
  ok("a move log rewrite is allowed (today's handlers do it, #567)", (await c.query("update node_move_log set reason = 'edited' where node_id = 'o1'")).rowCount, 1);
  ok("...and recorded with before and after", (await c.query("select before->>'reason' b, after->>'reason' a from change_log where table_name = 'node_move_log' and op = 'U'")).rows[0], { b: "Moved", a: "edited" });
  ok("a move log entry can't be deleted while its node exists", await refuses(c, "delete from node_move_log where node_id = 'o1'", [], /only removed with their node/));
  await c.query("delete from nodes where org_code = 'TESTORG' and id = 'p1'");
  ok("removing the panel cascades to its op and the op's log", (await c.query("select count(*)::int n from node_move_log where node_id = 'o1'")).rows[0].n, 0);

  console.log("db-schema: change_log");
  await c.query("set local app.actor_person_id = '7'; set local app.actor_email = 'wendy@testpanels.example'; set local app.source = 'timeclock:jobClockOut'");
  await c.query("insert into time_punches (org_code, id, position, person_id, hours) values ('TESTORG', 'tc_x', 0, '\"7\"', 8)");
  await c.query("update time_punches set hours = 7.5 where id = 'tc_x'");
  await c.query("update time_punches set hours = 7.5 where id = 'tc_x'");   // no-op: no row
  await c.query("delete from time_punches where id = 'tc_x'");
  const log = (await c.query("select op, actor_person_id, actor_email, source, row_key->>'id' as id, before->>'hours' as b, after->>'hours' as a from change_log where table_name = 'time_punches' order by id")).rows;
  ok("insert, update and delete are logged; a no-op update is not", log.map((r) => r.op), ["I", "U", "D"]);
  ok("with before and after", log.map((r) => [r.b, r.a]), [[null, "8"], ["8", "7.5"], ["7.5", null]]);
  ok("and the actor the request set", log.map((r) => [r.actor_person_id, r.actor_email, r.source, r.id])[1], ["7", "wendy@testpanels.example", "timeclock:jobClockOut", "tc_x"]);
  await c.query("update orgs set name = 'T2' where code = 'TESTORG'");
  ok("an org's own changes are logged under its code", (await c.query("select org_code from change_log where table_name = 'orgs' and op = 'U'")).rows.map((r) => r.org_code), ["TESTORG"]);
  ok("history itself is not audited (no recursion)", (await c.query("select count(*)::int n from change_log where table_name = 'change_log'")).rows[0].n, 0);
  await c.query("rollback");
} finally {
  await db.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : pass ? 0 : 2);
