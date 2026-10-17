-- 007: audit, storage bookkeeping, Business Central integration.

-- rule-events.json without its 1500-per-tag cap.
create table rule_events (
  org_code text not null references orgs(code) deferrable initially deferred,
  id       bigserial,
  at       text,
  tag      text,
  doc      json not null,                -- the record as written ({at, tag, mode, refused, by, ...})
  primary key (org_code, id)
);
create index rule_events_tag on rule_events (org_code, tag, id);
create table rule_event_drops (
  org_code text not null references orgs(code) deferrable initially deferred,
  tag      text not null,
  dropped  double precision not null,
  primary key (org_code, tag)
);

-- Any S3 key with no table of its own (legacy timeclock.json / jobsessions.json, *.migrated,
-- index files, files added later), stored as it was. Nothing is ever lost for lack of a codec.
create table raw_documents (
  key              text primary key,
  doc              json,
  content_type     text,
  binary_body      bytea,
  last_written_at  timestamptz not null default now()
);

-- One version counter per storage key: the ETag of the S3 contract. writeJsonIfMatch locks this
-- row, compares, writes, bumps — the same per-file serialisation S3's If-Match gives today.
create table store_versions (
  key     text primary key,
  version bigint not null default 1
);

-- Append-only history of every change, with who made it. The storage layer sets
--   set local app.actor_person_id / app.actor_email / app.source / app.request_id
-- per request; the trigger reads them, so no handler has to remember to log.
create table change_log (
  id              bigserial primary key,
  at              timestamptz not null default clock_timestamp(),
  org_code        text,
  table_name      text not null,
  op              char(1) not null check (op in ('I', 'U', 'D')),
  row_key         json,
  before          json,
  after           json,
  actor_person_id text,
  actor_email     text,
  source          text,
  request_id      text
);
create index change_log_row on change_log (org_code, table_name, ((row_key->>'id')), id);

create or replace function traqs_change_log() returns trigger language plpgsql as $$
declare
  o json := case when tg_op in ('UPDATE', 'DELETE') then to_json(old) end;
  n json := case when tg_op in ('INSERT', 'UPDATE') then to_json(new) end;
  r json := coalesce(n, o);
begin
  if tg_op = 'UPDATE' and o::text = n::text then return null; end if;
  insert into change_log (org_code, table_name, op, row_key, before, after, actor_person_id, actor_email, source, request_id)
  values (
    coalesce(r->>'org_code', r->>'code'), tg_table_name, left(tg_op, 1),
    json_strip_nulls(json_build_object('id', coalesce(r->>'id', r->>'person_id', r->>'node_id', r->>'group_id', r->>'message_id'),
      'position', r->'position', 'kind', r->'kind', 'perm', r->'perm')),
    o, n,
    nullif(current_setting('app.actor_person_id', true), ''),
    nullif(current_setting('app.actor_email', true), ''),
    nullif(current_setting('app.source', true), ''),
    nullif(current_setting('app.request_id', true), '')
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'orgs', 'org_billing', 'org_settings', 'people', 'person_admin_perms', 'person_time_off', 'person_live_state',
    'clients', 'nodes', 'node_team', 'node_deps', 'node_required_departments', 'node_finish_requests', 'attachments',
    'chat_groups', 'chat_group_members', 'messages', 'time_punches', 'time_events', 'production_sessions',
    'time_off_requests', 'invites'
  ] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function traqs_change_log()', t || '_change_log', t);
  end loop;
end $$;

-- The move log is history: an entry can be added, never rewritten. A DELETE is allowed only as
-- part of removing the node itself (the node row is already gone when the cascade reaches here).
create or replace function traqs_move_log_append_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'node_move_log is append-only (% / % seq %)', old.org_code, old.node_id, old.seq using errcode = 'check_violation';
  end if;
  if exists (select 1 from nodes where org_code = old.org_code and id = old.node_id) then
    raise exception 'node_move_log entries are only removed with their node (% / % seq %)', old.org_code, old.node_id, old.seq using errcode = 'check_violation';
  end if;
  return old;
end $$;
create trigger node_move_log_append_only before update or delete on node_move_log
  for each row execute function traqs_move_log_append_only();

-- Business Central (and any other system): one place for external numbers, one outbox.
create table external_links (
  org_code       text not null references orgs(code) deferrable initially deferred,
  entity         text not null,          -- client | job | person | ...
  entity_id      text not null,
  system         text not null,          -- business_central
  external_id    text not null,
  last_synced_at timestamptz,
  etag           text,
  extra          json,
  primary key (org_code, entity, entity_id, system),
  unique (org_code, system, entity, external_id)
);

create table integration_outbox (
  id         bigserial primary key,
  org_code   text not null references orgs(code) deferrable initially deferred,
  system     text not null,
  entity     text not null,
  entity_id  text not null,
  event      text not null,
  payload    json,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   int not null default 0,
  last_error text
);
create index integration_outbox_pending on integration_outbox (system, id) where sent_at is null;
