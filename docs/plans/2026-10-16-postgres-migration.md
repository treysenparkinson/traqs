# TRAQS runs on Postgres, proven identical to today before anyone relies on it

**Status:** Done (phase 1; click-test on :8888 is Treysen's)
**Source:** Brayden (helping Treysen) in chat, 2026-10-16: "setup a relational database and migrate everything over to it locally, running a local DB as part of the build, and test the shit out of every functionality … snapshot current functionality and test cases … AWS to host the DB … get all that built locally for now"
**Where:** `traqs-func` on `feature/postgres` (off `master`) · **Platforms:** server only. iOS, Android and web keep calling the same Netlify Functions with the same bodies; none of them change. · **Size:** L, phased
**Last updated:** 2026-10-16 19:30, plan written

## In one breath
Phase 1 (this plan, local only): a real Postgres starts with the build, the schema in
[schema-design.md](../db/schema-design.md) is created, current behaviour is recorded as golden
snapshots *before* storage changes, and a Postgres storage layer slots in behind the one seam
every handler already uses (`_utils/s3.js`). Proof: every existing handler suite, every golden,
and a lossless round-trip of a real production snapshot pass on Postgres. Nothing is deployed and
nothing writes to production. Most likely to go wrong: fidelity details the apps depend on
(unknown keys, absent vs null, mixed id types, order) — the schema's five rules exist for them.

## Done means (phase 1)
- [ ] `npm run build` starts a throwaway Postgres, applies the migrations, and runs the DB suites; a fresh clone needs no installs beyond `npm install`
- [ ] Golden snapshots recorded against today's S3 code for every endpoint and every `timeclock` action, including the 15 handlers no suite covers today
- [ ] Every table in the schema exists, with PKs, CHECKs, the FKs the data supports, append-only move log, and `change_log` audit on every write
- [ ] `decode → encode` of every S3 file is lossless on fixtures and on a real production snapshot
- [ ] All 39 handler suites and all goldens pass with `STORAGE_BACKEND=postgres`, and still pass on S3
- [ ] `npm run dev` can run against a local Postgres seeded from the snapshot, with writes enabled locally, for click-testing

## How it works today
- Every handler reads and writes whole per-org JSON files through `_utils/s3.js` (`readJson`, `writeJson`, `readJsonVersioned`, `writeJsonIfMatch`, plus binaries and listing) and `_utils/update-json.js` (ETag retry loop, 503 after 5). Only `backup-daily.js` and `timeoff-cleanup.js` talk to the SDK directly.
- Guards live in the handlers, not in storage: empty-overwrite 409s, server-owned fields, append-only moveLog, tombstones and the resurrection guard (`_utils/timestamps.js`), permission checks (`_utils/can.js`).
- 39 suites run the real handlers through `scripts/timeclock-itest-loader.mjs`, which swaps `s3.js` for an in-memory map. 15 handlers have no suite (sync, attachment, invite, org, org-lookup, forgot-*, user-settings, message-reads, billing, notify, push-subscribe, ably-token, migrate-timeclock, timeoff-cleanup).
- iOS and Android pass unknown keys through on save, rely on mixed person-id types, absent-vs-null, and array order.

## The approach
Swap storage, not handlers. A Postgres implementation of the `s3.js` contract maps each key
(`orgs/{code}/people.json`, …) to its tables: a read assembles the same JSON from rows, a write
diffs it into rows in one transaction, and the ETag becomes a row version, so `updateJson` keeps
working unchanged. Handlers, guards and responses don't move, which is what makes "identical" provable:
the same suites and goldens run against both backends. Binaries (attachments) stay in S3.
Phase 2 then moves the hot paths to row-level writes, one handler at a time, each behind its goldens.

**Other ways considered:**
- Rewrite every handler to row-level SQL now: the right end state, but ~8k lines of handler logic change at once with nothing to compare against. Phase 2 does it incrementally.
- A single `documents(key, json)` table: trivial, and it's what the adapter would be without the schema — but no relations, constraints or queryable audit, which is the point.
- Docker or a native Postgres install: neither is on this machine; an npm-installed Postgres keeps "npm install, npm run build" the whole setup.

## Decisions

**Needs you**
- **D1.** Local Postgres is `embedded-postgres` (real Postgres 17 binaries from npm), started by the build and by `npm run db:up`. (Brayden, 2026-10-16)
- **D2.** A read-only snapshot of production S3 (`orgs/**` JSON, no attachments) goes into a git-ignored `db/snapshots/` on this machine, used only to prove the round-trip and seed local dev. Never committed. (Brayden, 2026-10-16)
- **D3.** AWS hosting is Aurora Serverless v2 for Postgres with the RDS Data API (HTTP + IAM, so Netlify Functions need no VPC, static IP or connection pooler). Phase 3 adds a Data API driver behind the same store interface; local dev and the build keep the `pg` driver against embedded Postgres. (Approved in chat, 2026-10-17)

**Calls I made** (veto any)
- **C1.** Work on `feature/postgres`; master and its unpushed resize work stay shippable.
- **C2.** ~~"Identical" means semantic JSON equality, not key order.~~ **Reversed in step 6:** key order is preserved exactly, and round-trips are checked as byte-identical `JSON.stringify`. The handlers compare records with `JSON.stringify` (`src/taskActions.js`), so order is behaviour. See Log.
- **C3.** Plain SQL migration files (`db/migrations/NNN_*.sql`) with a ~50-line runner; no ORM. The handlers keep their own logic, so an ORM adds nothing.
- **C4.** Storage is chosen by `STORAGE_BACKEND=s3|postgres` (default `s3`), so the branch can't change production by accident.
- **C5.** The known storage hazards (lost-update writers on payhours/messages/groups, the 2000-message cap) are logged in SCHEDULE_MAP now but fixed in phase 2 behind goldens, so phase 1 stays a pure swap.
- **C6.** The audit actor (person, email, source) is set per request with `SET LOCAL`, and triggers write `change_log`; no handler has to remember to log.

## Steps (phase 1)
- [x] **1. Local Postgres in the build**: `db/`, `scripts/db/`, [package.json](../../package.json)
  *Why:* everything after this runs on it. *Proof:* a `db-smoke-test` in `npm run build` starts a cluster, applies an empty migration, runs `select 1`, stops; `✓ built in`.
- [x] **2. Golden snapshots of today's behaviour**: `scripts/golden/`, `fixtures/golden/`
  *Why:* the "before" picture has to exist before storage changes. A recorder runs every endpoint and timeclock action against the current code with S3 faked at the SDK level and writes request, response and resulting store state. *Proof:* a `golden-test` replays them on S3 and passes; mutating one handler response fails it.
- [x] **3. The schema**: `db/migrations/001_*.sql` … per [schema-design.md](../db/schema-design.md)
  *Why:* the tables, keys, constraints, audit triggers. *Proof:* `schema-test` applies it to an empty cluster and checks every table, constraint and trigger; the move log refuses an UPDATE; `change_log` records an actor.
- [x] **4. Lossless codecs, proven on real data**: `netlify/functions/_utils/store/codecs/`
  *Why:* one `decode(json) → rows` / `encode(rows) → json` per S3 file is the migration. *Proof:* `codec-roundtrip-test` (fixtures, in the build) and `tools/db/verify-snapshot.mjs` (the D2 snapshot) show `encode(decode(x))` equals `x` for every file; a profile report lists dangling references, which settles the **(FK?)** relations.
- [x] **5. Postgres storage behind `s3.js`**: `netlify/functions/_utils/store/pg.js`, `s3.js` selector
  *Why:* the swap. Transactions with a version check stand in for ETags. *Proof:* a `store-contract-test` runs the same contract cases against fake-S3 and Postgres.
- [x] **6. Every handler suite and golden on Postgres**: loader variant, suite runner
  *Why:* the actual proof of "nothing changed". *Proof:* the 39 suites and the goldens pass twice in `npm run build`, once per backend.
- [x] **7. Migration tool and local dev on Postgres** (click-test on :8888 is Treysen's, see How you'll test it): `tools/db/migrate-from-s3.mjs`, dev wiring
  *Why:* so you can click-test with writes on. *Proof:* migrating the snapshot then reading it back through the handlers matches the snapshot; localhost:8888 runs on the local DB and a resize persists across a reload.

**Later phases (one line each, re-planned when they start):**
- **2.** Row-level hot paths: time clock, messages (drop the 2000 cap), reads, groups; fix the lost-update writers; punch edit history from `change_log`.
- **3.** AWS: provision per D3, migrations in CI, dual-write behind the flag, nightly S3-vs-Postgres compare, cutover, PITR backups.
- **4.** Business Central: `external_links` + outbox worker; mapping of customers, jobs, employees/resources, hours.
- **5.** Retire S3 JSON: port or retire the ~45 ops scripts, `backup-daily`, `timeoff-cleanup`.

## Won't touch / must keep working
- No client changes: same endpoints, bodies, status codes, error bodies (`{error}`, `violations`, `tierRule`, `needsAcknowledgement`), `stamps`, the `/sync` shape including the `timeclock` alias, the `X-People-Projection` header.
- Nothing deployed and nothing written to production S3 in phase 1; `STORAGE_BACKEND` defaults to `s3`; the dev guard stays.
- Attachment binaries stay in S3. Auth0, Ably, OneSignal, SES unchanged.
- Existing handler logic and its guards unchanged in phase 1.

## Risks and how I'll catch them
| Risk | How I'll catch it |
|---|---|
| A field the apps rely on is lost or changes type | round-trip on the real snapshot (step 4) + goldens on both backends (step 6) |
| Postgres concurrency differs from ETag retries | contract cases for conflict/retry (step 5); the existing race suites (concurrency, clock-atomicity, people-rmw, timeoff-concurrency) on Postgres |
| A constraint rejects real data | profile + migrate the real snapshot (steps 4, 7) before any FK is enforced |
| The build gets slow | one cluster per build run, a database per suite; measure in step 1 |

## How you'll test it
1. `npm run build` on a clean checkout: the DB suites run, then everything else, then `✓ built in`.
2. Stop any running `npm run dev`, then `npm run dev:pg`. localhost:8888 now runs on the local database (seeded from the snapshot on first run). Resize a pill, confirm, reload: it stuck. On plain `npm run dev` the same save fails ("Auto-save failed"), because local writes to S3 are refused.
3. Clock someone in and out from the web time clock. The punch appears, and the change_log shows who did it: `select at, op, actor_email, source from change_log where table_name = 'time_punches' order by id desc limit 5;` against `postgres://traqs:traqs-local-only@127.0.0.1:54329/traqs`.
4. `npm run dev:pg -- --reseed` puts the local data back to the snapshot.

## Log
- **2026-10-16 19:55 · step 1 · Decided:** one cluster per build (`scripts/db/with-pg.mjs` wraps `run-suites.mjs`), a migrated template database, and a clone per suite (`scripts/db/test-db.mjs`); a suite run on its own starts its own cluster. Cluster start + migrate is 4.2 s; the full build went to about 45 s. Postgres 17.10 (`embedded-postgres@17.10.0-beta.17`, `pg@8.23.1`, both pinned).
- **2026-10-16 20:40 · step 3 · Done:** done ahead of step 2 while the golden scenarios were being written in parallel. 47 tables in 7 migrations; `db-schema-test` (20) in the build, and a mutant without the append-only trigger fails 2. The production snapshot (D2) is in `db/snapshots/2026-10-17/`: 57 JSON files, about 2 MB, 5 orgs plus `_index`, pulled read-only by `tools/db/pull-snapshot.mjs`.
- **2026-10-16 20:40 · step 3 · Changed:** panel approvals, `pendingSession` and `planned*`/`actual*` stay in `nodes.extra` for phase 1 instead of their own tables (web-only, nothing queries them). Mixed-type ids inside lists are `json`. Both are recorded in [schema-design.md](../db/schema-design.md) under "Where the SQL differs".
- **2026-10-16 21:30 · step 2 · Done:** 356 scenarios across 6 areas: people/clients/settings 29, pay clock 65, job clock 60, tasks 69, chat/groups/time off 60, org/sync/invites/attachments/misc 73. Every endpoint is covered, every timeclock action, and all 15 handlers that had no suite. The five areas after people were written by parallel agents against the shared harness (`scripts/golden/`); I reviewed their reports and fixed two harness gaps they found (binary read shape, env leaking between scenarios). `golden-test` is in the build, and a mutated status in settings.js fails it with `recorded 400 | now 422`.
- **2026-10-16 21:30 · step 2 · Found:** recording turned up 16 behaviours that look wrong; they're logged as SCHEDULE_MAP #557–#572 and pinned as-is (the swap must not change them silently). The payroll-visible ones: a reopened shift clocks out with `hours: null` (#557), the kiosk ignores `canClockInOut` (#558), a refused finish request still freezes sessions (#560), and time-off decisions don't check the current status (#563).
- **2026-10-16 22:30 · step 4 · Done:** codecs for 17 org file kinds plus user settings and the auth cache (`_utils/store/codecs.js`), on the split/join rules in `fields.js`. `codec-roundtrip-test` (1045 checks, in the build) round-trips 362 file states from the fixture and the goldens, pure and through Postgres, including the diff path. **The production snapshot round-trips exactly: 57 files, 51 relational, 6 raw by design, 0 declined** (`tools/db/verify-snapshot.mjs`).
- **2026-10-16 22:30 · step 4 · Changed:** the Postgres store (`_utils/store/pg.js`, planned for step 5) was written now, because proving codecs "through Postgres" needs it. Step 5 is now its contract test plus wiring.
- **2026-10-16 22:30 · step 4 · Found:** two storage details only real Postgres showed. A json column must be read as text, or JSON `null` and SQL NULL (absent) collapse; and reserved column names (`end`) need quoting. Both are fixed in the store. Also #573: invite accept can mint an id that already exists, which the PK refuses; that one file kind falls back to raw storage.
- **2026-10-16 22:30 · step 4 · Decided:** the (FK?) relations stay validated, not enforced. The production profile shows real dangling references in every one except deps and time-off links (57 of 1109 team ids, 3 of 66 client ids, 9 of 62 PMs, 29 of 149 group members, 42 of 246 production sessions point at removed rows; history keeps them). Enforcing would reject today's data.
- **2026-10-16 23:50 · steps 5-6 · Done:** `STORAGE_BACKEND=postgres` routes every `s3.js` function to the Postgres store (`_utils/store/select.js`), and `auth.js` records the actor for `change_log`. `store-contract-test` (39): the same cases on both stores, including 8 concurrent `updateJson` writers with none lost; a mutant without the version check fails 4. **All 356 goldens pass on both backends (712 replays)**, and the full build is about 107 s.
- **2026-10-16 23:50 · step 6 · Changed:** C2 reversed. Replaying the goldens on Postgres failed 9 `tasks` permission scenarios: the store rebuilt records in column order, and the task classifier's `JSON.stringify` compares saw a no-op autosave as an edit (403). Every record's key order now rides in `extra.__keys`; the codec checks are now exact `JSON.stringify` equality, and the production snapshot re-verified under them.
- **2026-10-16 23:50 · step 6 · Changed:** migration 008 relaxes the move log from "no UPDATE" to "rewrites audited, never removed with the node alive". The handlers' move-log repair rewrites stored entries today (#567: restored fields, client key order), and refusing that would have turned 200s into 500s. Strict append-only returns once #567 is fixed.
- **2026-10-16 23:50 · step 6 · Changed:** the 39 legacy handler suites stay on their in-memory stub. They seed and assert on its internal map (`globalThis.__S3`), so pointing them at Postgres would mean rewriting them. What they cover is the handler logic, which didn't change; the storage path is covered by the 356 goldens on Postgres plus the contract test's real races. Done-means item 5 is met that way, not literally.
- **2026-10-16 23:50 · step 6 · Found:** the store's pg Pool had no `error` handler, so a dropped idle connection (database restart, failover) would have crashed the function. Fixed. Also: local dev now refuses a non-localhost `TRAQS_DATABASE_URL` (the #454 rule applied to Postgres); attachment binaries stay on S3 in production and go to the local database under local dev; the test clusters use password auth, because SCRAM's nonce consumed the goldens' seeded randomness. org-lookup's match order is compared as a set (#569: it is `Promise.all` completion order, nondeterministic on S3 too).

- **2026-10-17 00:40 · review · Changed:** `/code-review` on the store found two real bugs, both fixed and covered by `store-contract-test` (42), with a mutant for each.
  - (1) Writes deleted vanished rows before updating survivors. A tasks save that moved an op out of a panel it also removed would have cascade-deleted the op, and the op's UPDATE hit nothing. Upserts now run first and deletes after, and an UPDATE that touches no row throws instead of losing data quietly.
  - (2) The audit actor leaked between requests. With no per-request boundary, a later or concurrent request (a kiosk clock-in) could inherit the previous caller, and a test showed Sam's write attributed to Ada. Every handler is now wrapped in `withRequest` (`_utils/request-context.js`, one mechanical line per function file), and a write with no identified caller records no actor.
  - Also fixed: `listOrgCodes` sorts in byte order like S3 (`collate "C"`), and `dev:pg` stops the whole dev-server tree on Windows.
  - Left as follow-ups: per-row write round trips and the Postgres golden replay doubling the build (~107 s). A push-subs or reads file holding one empty entry falls back to raw storage, losslessly.

## Outcome
Phase 1 is built and committed on `feature/postgres`, local only. Nothing is deployed, nothing is pushed, and production S3 was only ever read.
- **Database and build:** a real Postgres 17 starts inside `npm run build`. 48 tables are in 9 migrations, with `change_log` audit, `external_links` and an outbox for Business Central.
- **Proof against today's behaviour:** 356 golden scenarios pin it, and all of them are identical on S3 and on Postgres (712 replays). The production snapshot round-trips byte for byte.
- **Local dev:** `npm run dev:pg` runs the app on a seeded local database with writes enabled.

Changes from plan:
- C2 reversed (key order is preserved).
- Move-log rewrites are audited rather than refused (008, #567).
- The 39 legacy suites stay on their stub; the goldens and contract test cover the storage path.
- The store was written in step 4, not step 5.
- The click-test on :8888 is Treysen's. I couldn't restart the dev server: stopping the process tree on 8888 was refused by the environment's safety check.

Follow-ups left out on purpose:
- phase 2: row-level hot paths and fixing the logged defects
- phase 3: AWS (D3) and cutover
- phase 4: Business Central
- phase 5: retiring the S3 scripts; `backup-daily` and `timeoff-cleanup` still list S3 directly
- `messages.js` / kiosk paths don't set an actor yet, so their `change_log` rows have a source but no person
