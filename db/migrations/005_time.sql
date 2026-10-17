-- 005: the time clock, production hours, time off.  docs/db/schema-design.md § Time
--
-- payhours.json holds punches and lunch/break events in one array; they become two tables that
-- share `position`, so the original interleaving comes back exactly.

create table time_punches (
  org_code           text not null references orgs(code) deferrable initially deferred,
  id                 text not null,
  position           int  not null,
  person_id          json,             -- raw on some paths, String() on others (mixed today)
  date               date,
  clock_in           timestamptz,
  clock_out          timestamptz,
  hours              double precision,
  note               text,
  source             text,
  job_refs           json,             -- three shapes in the wild (web/Android/iOS)
  forgot_notified_at timestamptz,
  confirmed          boolean,
  confirmed_at       timestamptz,
  confirmed_by       text,
  overnight_ack_at   timestamptz,
  overnight_ack_by   text,
  last_modified_at   timestamptz,
  deleted_at         timestamptz,
  extra              json,
  primary key (org_code, id)
);
create index time_punches_person on time_punches (org_code, (person_id::text), date);

create table time_events (
  org_code         text not null references orgs(code) deferrable initially deferred,
  id               text not null,
  position         int  not null,
  person_id        json,
  date             date,
  event_type       text check (event_type in ('lunchStart', 'lunchEnd', 'breakStart', 'breakEnd')),
  timestamp        timestamptz,
  punch_id         text,               -- ownership is inferred by time window today; filled where unambiguous
  last_modified_at timestamptz,
  deleted_at       timestamptz,
  extra            json,
  primary key (org_code, id)
);
create index time_events_person on time_events (org_code, (person_id::text), date);

-- One ledger order across both tables.
create table time_ledger_order (
  org_code text not null references orgs(code) deferrable initially deferred,
  position int  not null,
  kind     text not null check (kind in ('punch', 'event', 'other')),
  row_id   text,
  other    json,                       -- a row that is neither shape, kept as is
  primary key (org_code, position)
);

create table production_sessions (
  org_code         text not null references orgs(code) deferrable initially deferred,
  id               text not null,
  position         int  not null,
  person_id        json,
  job_id           text,
  panel_id         text,
  op_id            text,
  job_title        text,
  panel_title      text,
  op_title         text,
  clock_in         timestamptz,
  clock_out        timestamptz,
  hours            double precision,   -- negative for a walk-back adjustment
  date             date,
  source           text,
  adjustment       boolean,
  entered_by       text,
  entered_at       timestamptz,
  last_modified_at timestamptz,
  deleted_at       timestamptz,
  extra            json,
  primary key (org_code, id)
);
create index production_sessions_op on production_sessions (org_code, op_id);
create index production_sessions_person on production_sessions (org_code, (person_id::text), date);

create table time_off_requests (
  org_code        text not null references orgs(code) deferrable initially deferred,
  id              text not null,
  position        int  not null,
  person_id       text,
  person_name     text,
  type            text,
  start           date,
  "end"           date,
  note            text,
  status          text check (status in ('pending', 'approved', 'denied', 'cancelled')),
  created_at      timestamptz,
  decided_by      text,
  decided_by_name text,
  decided_at      timestamptz,
  denial_reason   text,
  group_id        text,
  extra           json,
  primary key (org_code, id)
);

create table jobclock_alerts (
  org_code  text not null references orgs(code) deferrable initially deferred,
  position  int  not null,
  person_id text not null,
  clock_in  json,
  primary key (org_code, person_id)
);
