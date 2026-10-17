-- 002: people and what hangs off a person.  docs/db/schema-design.md § People

create table people (
  org_code             text not null references orgs(code) deferrable initially deferred,
  id                   text not null,
  id_num               boolean not null default false,     -- the stored id was a JSON number
  position             int  not null,                      -- roster order = schedule row order
  name                 text,
  email                citext,
  phone                text,
  image                text,
  color                text,
  department           text,
  role                 text,                               -- legacy department; iOS still reads it
  secondary_department text,
  cap                  double precision,
  team_number          double precision,
  user_role            text,
  is_engineer          boolean,
  can_sign_off         boolean,
  can_clock_in_out     boolean,                            -- absent means allowed
  no_auto_schedule     boolean,
  auto_schedule        boolean,
  pay_type             text,
  pin_secret           text,                               -- e1$ AES-GCM / h1$ HMAC / legacy plaintext
  push_token           text,
  invited_by           text,
  joined_at            timestamptz,
  -- adminPerms: absent (unrestricted, legacy) / null (unrestricted) / a map (person_admin_perms)
  admin_perms_state    text not null default 'absent' check (admin_perms_state in ('absent', 'null', 'map')),
  last_modified_at     timestamptz,
  deleted_at           timestamptz,
  extra                json,
  primary key (org_code, id)
);
create index people_email on people (org_code, email);

create table person_admin_perms (
  org_code  text not null,
  person_id text not null,
  position  int  not null,
  perm      text not null,
  granted   json not null,            -- true/false today; kept as json so an odd value round-trips
  primary key (org_code, person_id, perm),
  foreign key (org_code, person_id) references people(org_code, id) on delete cascade deferrable initially deferred
);

create table person_time_off (
  org_code  text not null,
  person_id text not null,
  position  int  not null,
  start     date,
  "end"     date,
  type      text,
  reason    text,
  status    text,
  req_id    text,                     -- -> time_off_requests (validated, not enforced: manual entries have none)
  extra     json,
  primary key (org_code, person_id, position),
  foreign key (org_code, person_id) references people(org_code, id) on delete cascade deferrable initially deferred
);

create table person_reviews (
  org_code   text not null,
  person_id  text not null,
  position   int  not null,
  doc        json not null,           -- {id, kind, title, body, rating, date, author, createdAt}; web-only notes
  primary key (org_code, person_id, position),
  foreign key (org_code, person_id) references people(org_code, id) on delete cascade deferrable initially deferred
);

-- activeClockIn / activeJobClock / activeBreak: server-owned "right now" state. Kept as the exact
-- document (absent vs null drainCheckpoint means different things), with indexed copies of what
-- queries need ("who is clocked in", "who is on op X").
create table person_live_state (
  org_code   text not null,
  person_id  text not null,
  kind       text not null check (kind in ('activeClockIn', 'activeJobClock', 'activeBreak')),
  doc        json,                    -- may be JSON null (key present, value null)
  clock_in   text,
  job_id     text,
  panel_id   text,
  op_id      text,
  session_id text,
  primary key (org_code, person_id, kind),
  foreign key (org_code, person_id) references people(org_code, id) on delete cascade deferrable initially deferred
);
create index person_live_state_op on person_live_state (org_code, op_id) where op_id is not null;
