# TRAQS runs on Postgres, proven identical to today before anyone relies on it

**Status:** Planning
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
- **D1. Local Postgres.** **My pick:** `embedded-postgres` (real Postgres 17 binaries from npm, the same engine as AWS RDS), started by the build and by `npm run db:up`. **Other:** PGlite (Postgres compiled to WASM, in-process, no ports: fastest tests, but not the exact engine production runs, and one connection only); or install Postgres/Docker yourself.
- **D2. Real data for migration testing.** **My pick:** pull a read-only snapshot of production S3 (`orgs/**` JSON, no attachments) into a git-ignored `db/snapshots/` on this machine, used only to prove the round-trip and seed local dev. It has emails, encrypted PINs and pay hours, and stays on this machine. **Other:** synthetic fixtures only (no production data leaves S3, but the migration is never tested against what it will actually move).
- **D3. AWS hosting (decide before phase 3, not now).** **My pick:** Aurora Serverless v2 for Postgres with the RDS Data API (HTTP + IAM, so Netlify Functions need no VPC, static IP or connection pooler). **Other:** RDS Postgres + RDS Proxy (more conventional, but Netlify's changing IPs mean a public endpoint or a VPC bridge).

**Calls I made** (veto any)
- **C1.** Work on `feature/postgres`; master and its unpushed resize work stay shippable.
- **C2.** "Identical" means semantic JSON equality (same keys, values, types, order of arrays), not byte-identical key order. Every client parses JSON; none compares bytes.
- **C3.** Plain SQL migration files (`db/migrations/NNN_*.sql`) with a ~50-line runner; no ORM. The handlers keep their own logic, so an ORM adds nothing.
- **C4.** Storage is chosen by `STORAGE_BACKEND=s3|postgres` (default `s3`), so the branch can't change production by accident.
- **C5.** The known storage hazards (lost-update writers on payhours/messages/groups, the 2000-message cap) are logged in SCHEDULE_MAP now but fixed in phase 2 behind goldens, so phase 1 stays a pure swap.
- **C6.** The audit actor (person, email, source) is set per request with `SET LOCAL`, and triggers write `change_log`; no handler has to remember to log.

## Steps (phase 1)
- [ ] **1. Local Postgres in the build**: `db/`, `scripts/db/`, [package.json](../../package.json)
  *Why:* everything after this runs on it. *Proof:* a `db-smoke-test` in `npm run build` starts a cluster, applies an empty migration, runs `select 1`, stops; `✓ built in`.
- [ ] **2. Golden snapshots of today's behaviour**: `scripts/golden/`, `fixtures/golden/`
  *Why:* the "before" picture has to exist before storage changes. A recorder runs every endpoint and timeclock action against the current code with S3 faked at the SDK level and writes request, response and resulting store state. *Proof:* a `golden-test` replays them on S3 and passes; mutating one handler response fails it.
- [ ] **3. The schema**: `db/migrations/001_*.sql` … per [schema-design.md](../db/schema-design.md)
  *Why:* the tables, keys, constraints, audit triggers. *Proof:* `schema-test` applies it to an empty cluster and checks every table, constraint and trigger; the move log refuses an UPDATE; `change_log` records an actor.
- [ ] **4. Lossless codecs, proven on real data**: `netlify/functions/_utils/store/codecs/`
  *Why:* one `decode(json) → rows` / `encode(rows) → json` per S3 file is the migration. *Proof:* `codec-roundtrip-test` (fixtures, in the build) and `tools/db/verify-snapshot.mjs` (the D2 snapshot) show `encode(decode(x))` equals `x` for every file; a profile report lists dangling references, which settles the **(FK?)** relations.
- [ ] **5. Postgres storage behind `s3.js`**: `netlify/functions/_utils/store/pg.js`, `s3.js` selector
  *Why:* the swap. Transactions with a version check stand in for ETags. *Proof:* a `store-contract-test` runs the same contract cases against fake-S3 and Postgres.
- [ ] **6. Every handler suite and golden on Postgres**: loader variant, suite runner
  *Why:* the actual proof of "nothing changed". *Proof:* the 39 suites and the goldens pass twice in `npm run build`, once per backend.
- [ ] **7. Migration tool and local dev on Postgres**: `tools/db/migrate-from-s3.mjs`, dev wiring
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
2. `npm run dev:pg` (after step 7): localhost:8888 on the local DB. Resize a pill, confirm, reload: it stuck.
3. Clock someone in and out from the web time clock; the punch appears, and `npm run db:audit -- --table time_punches` shows who did it.

## Log

## Outcome
