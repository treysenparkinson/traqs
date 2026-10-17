# TRAQS relational schema (Postgres) — design

**Status:** draft for review · **Plan:** [2026-10-16-postgres-migration.md](../plans/2026-10-16-postgres-migration.md)

Built from a read of every S3 file, every function that reads or writes it, and the
iOS / Android / web models (2026-10-16). The SQL lives in `db/migrations/`; this page is the
why and the map.

## Five rules that make the migration lossless

The apps depend on details a naive schema would drop. Every table follows these:

1. **Typed columns + `extra json`.** A known field goes to its typed column only when its value
   has the expected type and isn't null. Everything else — unknown keys (iOS and Android pass
   them through on save), custom-column values (`_cc_<id>`), explicit `null`s, values of an
   unexpected type (an `hpd` saved as `"7.5"`) — stays verbatim in `extra`. Reassembly merges
   both, so `decode → encode` returns the same record. `json`, not `jsonb`, so numbers keep
   their text.
2. **Absent ≠ null.** A typed column that is NULL means the key was absent. An explicit `null`
   lives in `extra`. (Tests rely on this: `adminPerms` absent vs present, "a missing field is
   not a cleared field".)
3. **Ids keep their type.** Person ids are mixed number/string in storage. Ids are `text`, plus
   `id_num boolean` where the raw type must come back (people.id, group member ids, personId
   fields stored raw).
4. **Order is data.** People order is the schedule's row order; jobs/panels/ops, messages and
   time rows come back in stored order. Every list table has `position`.
5. **Tombstones are rows.** `deleted_at` stays a column; `/sync` ships tombstones and the
   resurrection guard depends on them. Nothing is hard-deleted by the migration.

Every row also has `org_code` (tenant key, part of every PK and FK), and the app-level
`last_modified_at` is kept as data (it's the delta-sync cursor), separate from DB bookkeeping.

## Tables

`→` = foreign key. **(FK?)** = enforced only if the snapshot profile shows the data is clean
(dangling references are real: team ids of removed people, deps to deleted ops); otherwise an
index and a validator report instead.

### Org
| Table | Key columns | From |
|---|---|---|
| `orgs` | `code` PK, name, domain, admin_email, admin_emails text[], admin_name, industry, company_size, country, currency, connection, identity_providers text[], auth0_org_id (unique), created_at, last_modified_at, deleted_at, extra | `config.json`, `_index/code`, `_index/auth0` |
| `org_billing` | org_code PK → orgs, tier, requested_tier, requested_at, requested_by, last_modified_at | `billing.json` |
| `org_settings` | org_code PK, time_zone, hpd, work_start, work_end, work_days int[], holidays date[], lunch json, breaks json, pay_period_type, pay_period_start, pay_dates int[], pay_mode, pay_anchor, pay_period_hour_cap, track_lunch, track_breaks, ios_pay_clock_enabled, approval_queue_label, approver_label, approval_steps text[], last_modified_at, extra | `settings.json` scalars |
| `org_departments` | (org, position), name | `settings.roles` |
| `org_status_options` | (org, position), name, color, icon, is_finished, is_active, extra | `settings.statusOpts` |
| `org_priority_options` | (org, position), name, color, extra | `settings.priOpts` |
| `org_custom_columns` + `org_custom_column_options` | (org, id), label, type, field_key, position / (org, column_id, position), name, color, icon | `settings.customCols` |
| `org_conditions` | (org, id), name, enabled, trigger_field, trigger_op, trigger_value, apply_to, format_* , position | `settings.conditions` |
| `org_signoff_templates` + `org_signoff_template_steps` | (org, id), name / (org, template_id, position), label | `settings.signOffTemplates` |
| `org_export_templates` | (org, id), name, layout json, position | `settings.exportTemplates` |
| `org_assets` | (org, name), data | `settings.orgLogo` (base64 today; S3 later) |

### People
| Table | Key columns | From |
|---|---|---|
| `people` | (org, id), id_num, position, name, email (citext), phone, image, color, department, role (legacy), secondary_department, cap, team_number, user_role, is_engineer, can_sign_off, can_clock_in_out, no_auto_schedule, auto_schedule, pay_type, pin_secret, push_token, invited_by, joined_at, admin_perms_state ('absent' \| 'null' \| 'map'), last_modified_at, deleted_at, extra | `people.json` |
| `person_admin_perms` | (org, person_id, perm) → people, granted | `adminPerms` map (11 keys) |
| `person_time_off` | (org, person_id, position) → people, start, end, type, reason, status, req_id → time_off_requests **(FK?)**, extra | `person.timeOff[]` |
| `person_reviews` | (org, person_id, id), kind, title, body, rating, date, author, created_at, extra | `person.reviews[]` (web) |
| `person_live_state` | (org, person_id, kind ∈ shift \| job_clock \| break) → people, doc json, plus indexed copies: clock_in, job_id, panel_id, op_id, session_id | `activeClockIn`, `activeJobClock`, `activeBreak` — kept as exact documents (absent vs null `drainCheckpoint` matters) |

### Work tree (jobs → panels → ops)
One table, because node ids share one namespace and every level has the same core fields.

| Table | Key columns | From |
|---|---|---|
| `nodes` | (org, id), kind ∈ job \| panel \| op, parent_id → nodes, job_id → nodes, position, title, status, pri, start, end, start_hour, end_hour, hpd, notes, color, locked, logged_hours (server-owned), pending_finish, finish_request json (iOS legacy), required_department, last_modified_at / deleted_at (jobs only), extra. Job-only: job_number, po_number, job_type, due_date, client_id → clients **(FK?)**, project_manager_id **(FK?)**, scheduled_later, is_reschedule, created_at, archived_at. Panel-only: engineering json, deps_mode, qty, date_overridden json, appr_comments json. Op-only: split_from, pending_session json, finished_at, actual_hours, actual_start, actual_end, planned_* . CHECK constraints keep kind-specific columns on their kind. | `tasks.json` |
| `node_team` | (org, node_id, position), person_id | `team[]` |
| `node_deps` | (org, node_id, position), dep_id (may be `__pending__`) | `deps[]` |
| `node_required_departments` | (org, node_id, position), department | `requiredDepartments[]` |
| `node_move_log` | (org, node_id, seq), date, moved_by (a name today) + moved_by_id (new, nullable), reason, from/to start, end, start_hour, end_hour, hpd, team text[], departments text[], session_id, run_id, reverted, extra. **Append-only** (trigger refuses update/delete). | `moveLog[]` |
| `node_finish_requests` | (org, node_id, id), by, by_name, at, status, resolved_by, resolved_by_name, resolved_at, decline_reason, synthesized, synthesized_from, position, extra | `finishRequests[]` |
| `panel_signoffs` | (org, panel_id, template_id, step), by, by_name, at | `signOffs` |
| `panel_approval_chain` | (org, panel_id, position), label, assignee_id, done, by, by_name, at | `apprChain[]` |
| `panel_approval_log` | (org, panel_id, position), action, step, by, by_name, at | `apprLog[]` |
| `attachments` | (org, id), owner_kind ∈ panel \| message \| person, owner_id, position, s3_key, filename, mime_type, size, uploaded_by_id, uploaded_by_name, uploaded_at, op_id, extra. **Binaries stay in S3**; this is the index. | `panel.attachments[]`, `message.attachments[]` |
| `tasks_archive` | (org, id), archived_at, from_version_id, job json | `tasks-archive.json` |

### Clients, chat
| Table | Key columns | From |
|---|---|---|
| `clients` | (org, id), position, name, contact, email, phone, color, notes, last_modified_at, deleted_at, extra | `clients.json` |
| `chat_groups` + `chat_group_members` | (org, id), name, created_by, created_at, last_modified_at, deleted_at, extra / (org, group_id, position), member_id, member_id_num | `groups.json` |
| `messages` | (org, id), position, thread_key (indexed), scope, job_id, panel_id, op_id, text, author_id, author_name, author_color, type, finish_request_id, time_off_request_id, to_type, to_start, to_end, to_note, to_person_name, timestamp, last_modified_at, deleted_at, extra | `messages.json` |
| `message_participants` | (org, message_id, position), person_id | `participantIds[]` |
| `message_reads` | (org, thread_key, person_id), read_up_to | `reads.json` |

### Time
| Table | Key columns | From |
|---|---|---|
| `time_punches` | (org, id), position (shared ledger order), person_id, person_id_num, date, clock_in, clock_out, hours, note, source, job_refs json, forgot_notified_at, confirmed, confirmed_at, confirmed_by, overnight_ack_at, overnight_ack_by, last_modified_at, deleted_at, extra | `payhours.json` punch rows |
| `time_events` | (org, id), position (same ledger order), person_id, date, event_type, timestamp, punch_id → time_punches (nullable, filled by the profiler where unambiguous), last_modified_at, deleted_at, extra | `payhours.json` event rows |
| `production_sessions` | (org, id), position, person_id, job_id, panel_id, op_id, job_title, panel_title, op_title, clock_in, clock_out, hours (may be negative), date, source, adjustment, entered_by, entered_at, last_modified_at, deleted_at, extra; unique (org, person_id, op_id, clock_in) where not adjustment | `productionhours.json` |
| `time_off_requests` | (org, id), position, person_id, person_name, type, start, end, note, status, created_at, decided_by, decided_by_name, decided_at, denial_reason, group_id, extra | `timeoff.json` |
| `jobclock_alerts` | (org, person_id), clock_in | `jobclock-alerts.json` |

### Accounts, delivery, prefs
| Table | Key columns | From |
|---|---|---|
| `invites` | (org, id), position, token, email, role, invited_by, person_id, name, created_at, expires_at, accepted_at, revoked_at, extra | `invites.json` |
| `push_subscriptions` | (org, person_key, position), endpoint, keys json, expiration_time, theme, extra | `push-subs.json` |
| `user_settings` | (org, email_key), doc json, last_modified_at | `user-settings/*.json` (kept as a document: personal UI prefs, merged, web-only) |
| `auth_cache` | sub PK, email, at | `authcache/*.json` |

### Audit and integration (new)
| Table | Purpose |
|---|---|
| `rule_events` | (org, id bigserial), at, tag, mode, refused, by, is_admin, email, detail json. Replaces `rule-events.json` without its 1500-per-tag cap. |
| `change_log` | **Append-only row-level history of every table.** (id bigserial, org, table_name, row_key json, op I/U/D, before json, after json, actor_person_id, actor_email, source, request_id, at). Written by triggers; the actor comes from `SET LOCAL app.actor_*` that the storage layer sets per request. Answers "who changed this punch and what did it say before" — today the only answer is S3 versioning. |
| `external_links` | (org, entity, entity_id, system, external_id), last_synced_at, etag, extra. One place for Business Central numbers (customer, job, employee/resource) without a column per system. |
| `integration_outbox` | (id bigserial, org, system, entity, entity_id, event, payload json, created_at, sent_at, attempts, last_error). Filled by triggers on the tables BC cares about; a worker sends them. Built empty in phase 1. |

## Where the SQL differs from the tables above (phase 1)

Settled while writing `db/migrations/001-007` against the real snapshot's shapes:

- **Panel approvals** (`signOffs`, `apprChain`, `apprLog`, `apprComments`, `dateOverridden`) and op
  `pendingSession` / `planned*` / `actual*` live in `nodes.extra` for now, not in their own
  tables: web-only, low volume, and nothing queries them yet. Their tables come with the first
  feature that needs them.
- **`person_reviews`, `org_conditions`** keep each entry as a `doc` (free-form UI content).
- **Mixed-type ids inside lists** (`node_team.person_id`, `chat_group_members.member_id`,
  `time_punches.person_id`, ...) are `json`, so a number stays a number; indexes are on `::text`.
- **`time_ledger_order`** records the interleaving of punches and events in `payhours.json`.
- **`*_present` flags** record whether a list key existed at all (absent and `[]` differ).
- **`raw_documents`** holds any S3 key with no table (legacy `timeclock.json`, `*.migrated`, index
  files, future files), and **`store_versions`** is the per-key version that stands in for the ETag.

## What is deliberately not normalized

- **`person_live_state`, `pending_session`, `engineering`, `date_overridden`, `job_refs`**: volatile
  server-owned state or small fixed-shape objects whose exact JSON (absent vs null) is the
  contract. Kept as documents, with indexed copies of the fields queries need.
- **`user_settings`**: personal UI preferences, merged on write, web-only.
- **Derived/duplicated fields stay as they are in phase 1** (`loggedHours` vs session rows,
  `person.timeOff` vs requests, `pendingFinish`, title snapshots). The migration's job is to
  change where data lives without changing what it says; collapsing duplicates is phase 2,
  each one with its own test.

## Integrity the database adds on day one

- Every PK, unique (email per org among live people, invite token, production dedupe key),
  NOT NULLs the data already satisfies, CHECKs on enums (kind, status of requests, event_type,
  user_role, tier).
- FKs wherever the profile of the real snapshot shows the data is clean; the rest get a nightly
  validator report rather than a constraint that would reject today's data.
- `change_log` on every write, `node_move_log` append-only by trigger, and conditional writes
  as real transactions instead of ETag retries.
