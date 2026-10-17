-- 004: chat groups, messages, read receipts.  docs/db/schema-design.md § Clients, chat

create table chat_groups (
  org_code         text not null references orgs(code) deferrable initially deferred,
  id               text not null,
  position         int  not null,
  name             text,
  created_by       json,               -- raw roster id type (number or string), as stored
  created_at       timestamptz,
  last_modified_at timestamptz,
  deleted_at       timestamptz,
  extra            json,
  primary key (org_code, id)
);

create table chat_group_members (
  org_code  text not null,
  group_id  text not null,
  position  int  not null,
  member_id json not null,             -- mixed number/string on purpose (groups.js:65-69)
  primary key (org_code, group_id, position),
  foreign key (org_code, group_id) references chat_groups(org_code, id) on delete cascade deferrable initially deferred
);
create index chat_group_members_person on chat_group_members (org_code, (member_id::text));

create table messages (
  org_code            text not null references orgs(code) deferrable initially deferred,
  id                  text not null,
  position            int  not null,
  thread_key          text,
  scope               text,
  job_id              text,
  panel_id            text,
  op_id               text,
  text                text,
  author_id           text,
  author_name         text,
  author_color        text,
  type                text,
  finish_request_id   text,
  time_off_request_id text,
  timestamp           timestamptz,
  last_modified_at    timestamptz,
  deleted_at          timestamptz,
  extra               json,           -- toType/toStart/... bubble fields and anything else
  primary key (org_code, id)
);
create index messages_thread on messages (org_code, thread_key, position);

create table message_participants (
  org_code   text not null,
  message_id text not null,
  position   int  not null,
  person_id  json not null,
  primary key (org_code, message_id, position),
  foreign key (org_code, message_id) references messages(org_code, id) on delete cascade deferrable initially deferred
);

create table message_reads (
  org_code     text not null references orgs(code) deferrable initially deferred,
  thread_key   text not null,
  thread_pos   int  not null,
  person_id    text not null,
  person_pos   int  not null,
  read_up_to   json,                   -- an ISO string today; json keeps anything else as stored
  primary key (org_code, thread_key, person_id)
);
