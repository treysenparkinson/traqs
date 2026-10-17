-- 003: the work tree (jobs -> panels -> ops) and clients.  docs/db/schema-design.md § Work tree
--
-- One `nodes` table: job, panel and op ids share one namespace (handlers look an id up at any
-- level), and every level has the same core fields. Kind-specific fields are plain columns that
-- are only ever set on their kind (CHECKs below).

create table clients (
  org_code         text not null references orgs(code) deferrable initially deferred,
  id               text not null,
  position         int  not null,
  name             text,
  contact          text,
  email            text,
  phone            text,
  color            text,
  notes            text,
  last_modified_at timestamptz,
  deleted_at       timestamptz,
  extra            json,
  primary key (org_code, id)
);

create table nodes (
  org_code           text not null references orgs(code) deferrable initially deferred,
  id                 text not null,
  kind               text not null check (kind in ('job', 'panel', 'op')),
  parent_id          text,                 -- null for jobs
  job_id             text not null,        -- the job this node belongs to (itself for a job)
  position           int  not null,        -- order among siblings
  title              text,
  status             text,
  pri                text,
  start              date,
  "end"              date,
  start_hour         double precision,
  end_hour           double precision,
  hpd                double precision,     -- the TEAM's total estimated hours
  notes              text,
  color              text,
  locked             boolean,
  logged_hours       double precision,     -- server-owned counter
  pending_finish     boolean,
  required_department text,
  -- job only
  job_number         text,
  po_number          text,
  job_type           text,
  due_date           date,
  client_id          text,                 -- -> clients (validated; dangling ids exist)
  project_manager_id text,                 -- -> people  (validated)
  scheduled_later    boolean,
  is_reschedule      boolean,
  created_at         timestamptz,
  archived_at        timestamptz,
  -- panel only
  engineering        json,
  deps_mode          text,
  qty                double precision,
  -- op only
  split_from         text,
  finished_at        timestamptz,
  -- every level (top-level stamps only appear on jobs today)
  last_modified_at   timestamptz,
  deleted_at         timestamptz,
  extra              json,                 -- custom columns (_cc_*), pendingSession, signOffs, planned*/actual*, ...
  primary key (org_code, id),
  foreign key (org_code, parent_id) references nodes(org_code, id) on delete cascade deferrable initially deferred,
  foreign key (org_code, job_id) references nodes(org_code, id) on delete cascade deferrable initially deferred,
  check ((kind = 'job') = (parent_id is null)),
  check (kind = 'job' or (job_number is null and po_number is null and job_type is null and due_date is null and client_id is null and project_manager_id is null)),
  check (kind = 'panel' or (engineering is null and deps_mode is null and qty is null)),
  check (kind = 'op' or (split_from is null and finished_at is null))
);
create index nodes_tree on nodes (org_code, parent_id, position);
create index nodes_job on nodes (org_code, job_id);
create index nodes_client on nodes (org_code, client_id) where client_id is not null;

create table node_team (
  org_code  text not null,
  node_id   text not null,
  position  int  not null,
  person_id json not null,                 -- stringified on write today; json keeps an odd value as sent
  primary key (org_code, node_id, position),
  foreign key (org_code, node_id) references nodes(org_code, id) on delete cascade deferrable initially deferred
);
create index node_team_person on node_team (org_code, (person_id::text));

create table node_deps (
  org_code text not null,
  node_id  text not null,
  position int  not null,
  dep_id   json not null,                  -- sibling op id, or the "__pending__" sentinel
  primary key (org_code, node_id, position),
  foreign key (org_code, node_id) references nodes(org_code, id) on delete cascade deferrable initially deferred
);

create table node_required_departments (
  org_code   text not null,
  node_id    text not null,
  position   int  not null,
  department json not null,
  primary key (org_code, node_id, position),
  foreign key (org_code, node_id) references nodes(org_code, id) on delete cascade deferrable initially deferred
);

create table node_move_log (
  org_code     text not null,
  node_id      text not null,
  seq          int  not null,              -- position in the log; entries have no id
  date         text,
  moved_by     text,                       -- a display name today
  reason       text,
  from_start   text, to_start   text,
  from_end     text, to_end     text,
  from_start_hour double precision, to_start_hour double precision,
  from_end_hour   double precision, to_end_hour   double precision,
  from_hpd     double precision, to_hpd double precision,
  session_id   text,
  run_id       text,
  extra        json,                       -- fromTeam/toTeam, departments, reverted, anything else
  primary key (org_code, node_id, seq),
  foreign key (org_code, node_id) references nodes(org_code, id) on delete cascade deferrable initially deferred
);

create table node_finish_requests (
  org_code         text not null,
  node_id          text not null,
  position         int  not null,
  id               text,
  by               text,
  by_name          text,
  at               timestamptz,
  status           text,
  resolved_by      text,
  resolved_by_name text,
  resolved_at      timestamptz,
  decline_reason   text,
  extra            json,
  primary key (org_code, node_id, position),
  foreign key (org_code, node_id) references nodes(org_code, id) on delete cascade deferrable initially deferred
);

-- The index of uploaded files. Binaries stay in S3 under s3_key.
create table attachments (
  org_code         text not null,
  owner_kind       text not null check (owner_kind in ('node', 'message')),
  owner_id         text not null,
  position         int  not null,
  s3_key           text,
  filename         text,
  mime_type        text,
  size             double precision,
  uploaded_by_id   text,
  uploaded_by_name text,
  uploaded_at      timestamptz,
  op_id            text,
  extra            json,
  primary key (org_code, owner_kind, owner_id, position)
);

create table tasks_archive (
  org_code        text not null references orgs(code) deferrable initially deferred,
  position        int  not null,
  archived_at     timestamptz,
  from_version_id text,
  job             json,
  extra           json,
  primary key (org_code, position)
);
