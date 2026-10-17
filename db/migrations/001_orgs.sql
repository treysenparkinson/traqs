-- 001: orgs, billing, settings and their option lists.  docs/db/schema-design.md § Org
--
-- Conventions for every table from here on (schema-design "five rules"):
--   * org_code is part of every key; intra-org FKs are DEFERRABLE INITIALLY DEFERRED so a whole
--     file can be written in any row order inside one transaction.
--   * a typed column holds a value only when it has the expected type and isn't null; anything
--     else (unknown keys, explicit nulls, odd types) is kept verbatim in `extra` (json, not jsonb).
--   * app timestamps (last_modified_at, deleted_at, ...) are timestamptz and hold only canonical
--     toISOString() values; other spellings stay in `extra`. Hours and estimates are double
--     precision, which is exactly a JS number.
--   * `position` is the stored array order.

create table orgs (
  code               text primary key,
  name               text,
  domain             text,
  admin_email        text,
  admin_emails       text[],
  admin_name         text,
  industry           text,
  company_size       text,
  country            text,
  currency           text,
  connection         text,
  identity_providers text[],
  created_at         timestamptz,
  last_modified_at   timestamptz,
  deleted_at         timestamptz,
  extra              json,
  auth0_org_id       text unique,                      -- future: the _index/auth0 binding (index files themselves stay in raw_documents)
  has_config         boolean not null default false,   -- config.json existed (an org row can exist for its other files alone)
  constraint orgs_code_format check (code ~ '^[A-Za-z0-9]{3,20}$' or code ~ '^[A-Z]{3}\.[A-Z0-9]{4}\.[A-Z0-9]{4}$')
);

create table org_billing (
  org_code          text primary key references orgs(code) deferrable initially deferred,
  tier              text check (tier in ('basic', 'business')),
  requested_tier    text,
  requested_at      timestamptz,
  requested_by      text,
  last_modified_at  timestamptz,
  extra             json
);

create table org_settings (
  org_code              text primary key references orgs(code) deferrable initially deferred,
  time_zone             text,
  hpd                   double precision,
  work_start            text check (work_start ~ '^\d{2}:\d{2}$'),
  work_end              text check (work_end ~ '^\d{2}:\d{2}$'),
  work_days             int[],
  holidays              date[],
  lunch                 json,
  breaks                json,
  pay_period_type       text,
  pay_period_start      date,
  pay_dates             int[],
  pay_mode              text,
  pay_anchor            date,
  pay_period_hour_cap   double precision,
  track_lunch           boolean,
  track_breaks          boolean,
  ios_pay_clock_enabled boolean,
  approval_queue_label  text,
  approver_label        text,
  approval_steps        text[],
  last_modified_at      timestamptz,
  extra                 json
);

create table org_departments (
  org_code text not null references orgs(code) deferrable initially deferred,
  position int  not null,
  name     text not null,
  primary key (org_code, position)
);

create table org_status_options (
  org_code    text not null references orgs(code) deferrable initially deferred,
  position    int  not null,
  name        text,
  color       text,
  icon        text,
  is_finished boolean,
  is_active   boolean,
  extra       json,
  primary key (org_code, position)
);

create table org_priority_options (
  org_code text not null references orgs(code) deferrable initially deferred,
  position int  not null,
  name     text,
  color    text,
  extra    json,
  primary key (org_code, position)
);

create table org_custom_columns (
  org_code  text not null references orgs(code) deferrable initially deferred,
  position  int  not null,
  id        text,
  label     text,
  type      text,
  field_key text,
  extra     json,
  primary key (org_code, position)
);

create table org_custom_column_options (
  org_code        text not null,
  column_position int  not null,
  position        int  not null,
  name            text,
  color           text,
  icon            text,
  extra           json,
  primary key (org_code, column_position, position),
  foreign key (org_code, column_position) references org_custom_columns(org_code, position) on delete cascade deferrable initially deferred
);

create table org_conditions (
  org_code text not null references orgs(code) deferrable initially deferred,
  position int  not null,
  id       text,
  name     text,
  enabled  boolean,
  doc      json not null,          -- trigger/format fields are free-form UI config
  primary key (org_code, position)
);

create table org_signoff_templates (
  org_code text not null references orgs(code) deferrable initially deferred,
  position int  not null,
  id       text,
  name     text,
  steps    text[],
  extra    json,
  primary key (org_code, position)
);

create table org_export_templates (
  org_code text not null references orgs(code) deferrable initially deferred,
  position int  not null,
  id       text,
  name     text,
  layout   json,
  extra    json,
  primary key (org_code, position)
);
