-- 006: invites, push subscriptions, personal settings, the auth cache.

create table invites (
  org_code    text not null references orgs(code) deferrable initially deferred,
  id          text not null,
  position    int  not null,
  token       text unique,             -- a live credential; never returned by list endpoints
  email       citext,
  role        text,
  invited_by  text,
  person_id   json,
  name        text,
  created_at  timestamptz,
  expires_at  timestamptz,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  extra       json,
  primary key (org_code, id)
);

create table push_subscriptions (
  org_code   text not null references orgs(code) deferrable initially deferred,
  person_key text not null,            -- the JSON object key (a person id as text)
  person_pos int  not null,
  position   int  not null,
  endpoint   text,
  doc        json not null,            -- {endpoint, keys, expirationTime, theme}
  primary key (org_code, person_key, position)
);

-- Personal UI preferences, merged on write and only used by the web: kept as one document.
create table user_settings (
  org_code         text not null references orgs(code) deferrable initially deferred,
  email_key        text not null,      -- the sanitised email in the S3 key
  doc              json not null,
  last_modified_at timestamptz,
  primary key (org_code, email_key)
);

create table auth_cache (
  key  text primary key,               -- base64url(sub), as in the S3 key
  doc  json not null                   -- {sub, email, at}
);
