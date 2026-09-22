# ORG ONBOARDING — signup, multi-tenancy, Matrix migration

Plan of record. Written before code, from a survey of the repo and the live
bucket on 2026-09-22. Nothing here is built yet.

---

## 0. WHAT THE SURVEY CHANGED

The brief describes TRAQS as single-tenant, going multi-tenant. **It is already
multi-tenant.** That is not a quibble — it moves most of build step 2 from "to
do" to "done", and it changes what step 3 actually is.

Verified, not assumed:

| Claim | Evidence |
| --- | --- |
| Every S3 read/write is already org-scoped | No non-org `readJson("x.json")` anywhere in `netlify/functions/`. Grep returns nothing. |
| `X-Org-Code` already threads request → membership check | `_utils/auth.js:254`, used by every authenticated function |
| Org create already exists | `functions/org.js` POST, gated behind `SIGNUPS_ENABLED` |
| Background jobs already enumerate orgs | `backup-daily.js` and `timeoff-cleanup.js` list by `orgs/` prefix |
| No legacy single-tenant path survives | No root-level `traqs/*.json` reads remain |

So **build step 2 (multi-tenancy plumbing) is substantially already done.** What
is genuinely new is: the org-code *format*, Auth0 Organizations, multi-org
membership and switching, the 5-step signup wizard, invites, and the tier CTA.

And **build step 3 is not a single→multi migration.** Matrix already lives at
`orgs/MTX2026TRAQS/`. The only migration in play is a *re-key* of that prefix
to a new-format code — which, per §6, I recommend against doing at all.

---

## 1. THE ORG CODE FORMAT — 6 enforcement points, not 1

Target format `PREFIX.XXXX.XXXX` (e.g. `MTX.7K2P.9QX4`). The current format is
enforced by **five independent copies of the same regex plus one user-facing
string**, all of which reject a dot:

| Location | What it guards | Breaks how |
| --- | --- | --- |
| `_utils/auth.js:255` | `^[a-zA-Z0-9]{3,20}$` on the header | **Every authenticated request 400s** |
| `_utils/org.js:9` | same regex, normalisation | org resolves to `null` |
| `functions/org.js:10` | same regex, create + lookup | cannot create or look up |
| `functions/attachment.js:144` | `^orgs/[a-zA-Z0-9]{3,20}/attachments/...$` | **every attachment download 400s** |
| `functions/forgot-org.js:61` | comment only | doc drift |
| `src/App.jsx:584` | `"Org code must be 3–20 letters and numbers only."` | wrong error text |

`attachment.js:144` is the one that would be missed: the org-code pattern is
embedded inside an S3 **key-path** validator, so it does not look like org-code
validation when grepping for one.

### Decision

One shared validator, one place. New `_utils/orgcode.js` exporting:

```
isValidOrgCode(code)   accepts BOTH the new dotted format and the existing
                       alphanumeric one, so codes issued before this change
                       stay valid without a special-case branch anywhere
generateOrgCode(name)  PREFIX.XXXX.XXXX, prefix from the org name,
                       alphabet excludes 0 O 1 I L
orgKeyPattern()        the regex fragment attachment.js needs, so the key
                       validator and the code validator cannot drift
```

All six sites import from it. Accepting both formats is not a legacy fallback —
it is one validator with one rule ("a valid code looks like either of these"),
which is what lets Matrix live under the same rules without being special-cased.

### Codes become generated, not chosen

Today `org.js` POST takes `{ code, name, domain, adminEmail }` — **the caller
picks the code**. That inverts: POST takes the org name, the server generates
the code, checks `orgs/{code}/config.json` for collision, retries on clash, and
returns the code for the confirmation screen. The client must stop sending one.

---

## 2. AUTH0 ORGANIZATIONS → THE PREFIX

**Today there is no Auth0 org concept at all.** Membership is: the user's email
appears in `orgs/{code}/people.json`, plus a domain check (`_utils/auth.js:243`,
`:288`). The org code arrives as a *client-supplied header*, and the server
trusts it only because it then verifies membership against that org's people
file.

That is the security property to preserve. Auth0 Organizations changes where the
claim comes from, not whether it is checked.

### Mapping

```
Auth0 org_id  (org_xxxxxxxx, opaque, Auth0-issued)
     │
     │  stored on the org's config.json as auth0OrgId
     ▼
TRAQS org code  (MTX.7K2P.9QX4)  ── is the S3 prefix ──►  orgs/MTX.7K2P.9QX4/
```

The Auth0 `org_id` is **not** the prefix. It is opaque, Auth0 controls its
format, and binding our key space to a vendor identifier means we can never
leave Auth0 without a full re-key. The code is ours; the `org_id` is a claim we
map through.

Resolution order in `requireMember`:

1. Read `org_id` from the verified access token.
2. Resolve `org_id → orgCode` via a lookup (`orgs/_index/auth0/{org_id}.json`,
   written at org creation).
3. If the request also carries `X-Org-Code`, it **must equal** the resolved
   code, else 403. The header becomes a cross-check, not a source of truth.
4. Then the existing people.json membership check runs unchanged.

Step 3 is the point of the exercise: today a user in org A can send org B's
code, and is stopped only by B's people file. With the token carrying the org,
the claim and the header must agree.

### Multi-org membership

A user in several orgs gets several Auth0 org memberships. Switching orgs means
re-authenticating for the target org (Auth0 issues a token per org) — so the
switcher triggers a silent `loginWithRedirect({ organization })`, not a local
state flip. `tq_org_code` in localStorage becomes `tq_org_codes` (list) plus
`tq_active_org`.

---

## 3. EVERY S3 KEY

Current layout, all under one bucket:

```
orgs/{code}/config.json          tasks.json      people.json     clients.json
            settings.json        messages.json   reads.json      groups.json
            timeoff.json         payhours.json   productionhours.json
            attachments/{id}-{filename}
backups/{YYYY-MM-DD}/orgs/...    written by backup-daily.js
```

**Keys whose *shape* changes: none.** The `orgs/{code}/...` layout is already
correct and already what the brief asks for.

**New keys:**

```
orgs/_index/auth0/{org_id}.json      → { orgCode }     auth0 org → our code
orgs/_index/code/{code}.json         → { auth0OrgId }  reverse, for collision
orgs/{code}/invites.json             → pending invite tokens
```

`orgs/_index/` sits under the same prefix the background jobs enumerate, so
`backup-daily.js` and `timeoff-cleanup.js` must skip a leading `_` segment or
they will treat the index as an org. **This is a named test case**, not a note.

---

## 4. EVERY FUNCTION PATH TOUCHED

| Function | Change |
| --- | --- |
| `_utils/auth.js` | resolve org from token claim; header becomes cross-check; new 403 path |
| `_utils/org.js` | use shared validator |
| `functions/org.js` | generate code server-side; write both index keys; stop accepting a caller code |
| `functions/attachment.js` | key regex from shared helper |
| `functions/backup-daily.js` | skip `orgs/_index/` |
| `functions/timeoff-cleanup.js` | skip `orgs/_index/` |
| `functions/org-lookup.js`, `forgot-org.js` | shared validator |
| **new** `functions/invite.js` | create / accept / revoke invites |
| `src/api.js` | send active org; handle 403 org-mismatch by clearing active org |
| `src/App.jsx` | 5-step wizard; org switcher; new error copy |

Everything else (`tasks.js`, `people.js`, `clients.js`, `timeclock.js`,
`timeoff.js`, `messages.js`, `settings.js`, `groups.js`, `message-reads.js`,
`user-settings.js`, `sync.js`, `ably-token.js`, `notify.js`, `push-subscribe.js`)
already goes through `requireMember` and needs **no change** — they receive the
resolved `orgCode` exactly as they do now.

---

## 5. MATRIX MIGRATION — measured

Live bucket, 2026-09-22:

```
orgs/  98 objects, 42.9 MB
  orgs/MTX2026TRAQS/    96 objects   ← the live org, 80 of them attachments
  orgs/MATRIX/           1 object    ← stray, from the earlier plan
  orgs/MTX2025TRAQS/     1 object    ← stray
```

### THE RE-KEY PATH ALREADY EXISTS, AND IT IS LIVE

`functions/org.js` PATCH takes `{ newCode }`, calls `copyPrefix()` and moves
the whole org prefix. Any user with the `orgSettings` permission can trigger it
from Settings today. So the migration tooling is not being written from nothing
— it is being **corrected**.

It does not rewrite embedded references. `copyPrefix` copies objects verbatim,
so after a rename every `orgs/OLD/attachments/...` string inside `messages.json`
and `tasks.json` still points at the old prefix.

**And the breakage is deferred, which makes it worse.** `attachment.js` GET
validates only the key's SHAPE — there is no ownership check, by design (the
key is documented as an unguessable bearer, with presigned URLs noted as the
long-term fix). So the stale keys keep resolving while the old prefix exists.
Nothing appears wrong. The photos break only when the old prefix is deleted,
which in §5's plan is seven days later — by which time nobody connects the two.

A rename done today therefore looks successful and silently arms a failure for
next week. That is the strongest argument for §6: not re-keying Matrix avoids
the whole class.

### The hazard that makes this non-trivial

Attachment keys are stored **inside the data**, org prefix and all.
`attachment.js:124` returns the full key to the client and it is persisted:

```
orgs/MTX2026TRAQS/attachments/pXTWWEOPLHEb-photo_2026-07-03_225240.jpg
```

**25 such keys in `messages.json` alone**, plus panel attachments in
`tasks.json`. So a re-key is not "copy the objects". It is:

1. copy 96 objects to the new prefix
2. rewrite every embedded `orgs/OLD/attachments/...` string inside
   `messages.json` and `tasks.json`
3. only then delete the old prefix

Miss step 2 and every photo in the app 404s, silently, with no error anywhere —
the key is well-formed, it just points at nothing.

### Steps, if we do it

Dry-run first, always, output reviewed before execute:

1. **Freeze** — `SIGNUPS_ENABLED=false`, announce, confirm no active job clocks
   (a clock-in mid-migration writes to the old prefix after it is copied).
2. **Snapshot** — force a `backup-daily` run; record the backup date key.
3. **Dry run** — list every source key, its destination, and every embedded
   reference that would be rewritten, with counts. Show it.
4. **Copy** — server-side `CopyObject` for all 96. Never download/re-upload.
5. **Rewrite** — embedded attachment keys in `messages.json`, `tasks.json`.
6. **Verify** — object count matches; zero `orgs/MTX2026TRAQS/` strings remain
   in the new prefix's JSON; every referenced attachment key resolves with a
   `HeadObject`. **This last check is the one that catches step 5 being missed.**
7. **Switch** — update the Auth0 org mapping and `config.json`.
8. **Leave the old prefix in place** for 7 days. Do not delete on the day.

### Rollback

Because step 8 leaves the source intact, rollback is: point the Auth0 mapping
back at `MTX2026TRAQS` and delete the new prefix. No data movement, no restore.

That only holds while nothing has been *written* to the new prefix — so the
freeze in step 1 is what makes rollback cheap, and the window closes the moment
the org is unfrozen. After that, rollback is a restore from the step-2 backup
and loses anything written since.

---

## 6. RECOMMENDATION: do not re-key Matrix

Every stated ruling is satisfied without moving a single object.

"No special-case branch, no legacy-path fallback. Matrix lives under the same
rules as every other org" is a statement about **code**, not about the literal
value of Matrix's code. If `MTX2026TRAQS` simply *is* Matrix's org code:

- no branch anywhere tests for it
- no legacy path exists — it resolves through the same `orgs/{code}/` rule
- the shared validator accepts it as one of two valid shapes
- new orgs all get `PREFIX.XXXX.XXXX`

The cost is cosmetic: one org's code looks unlike the others. The cost of the
alternative is a 96-object copy plus an embedded-reference rewrite across two
JSON files, where the failure mode is 80 photos silently 404ing.

I will build the migration tooling either way — §5 stands as written. **But I
would not run it, and the reason is that it buys consistency in a value nobody
sees and risks the one thing in the bucket we cannot regenerate.**

Your call. If you want the re-key, say so and it runs dry-run-first per §5.

---

## 7. RED-FIRST ON THE MIGRATION

The brief asks specifically for a test that catches a *missed path* before it
goes green. Three, all of which must fail first:

1. **Missed embedded reference.** Fixture: an org with an attachment whose key
   is stored in `messages.json`. Migrate with step 5 disabled. The test asserts
   every referenced key resolves — it must FAIL, proving it detects the exact
   defect that would silently 404 the photos.
2. **Missed function path.** Enumerate every `readJson`/`writeJson` call in
   `netlify/functions/`, assert each key is `orgs/`-prefixed. Add a deliberate
   unprefixed read; the test must catch it.
3. **Index mistaken for an org.** Add `orgs/_index/...` to a fixture bucket and
   assert `backup-daily`'s enumeration skips it. Without the skip it must fail.

---

## 8. OPEN QUESTIONS

1. **Re-key Matrix, or grandfather the code?** §6. Blocks step 3 only.
2. **Invite acceptance for a user with no Auth0 account** — does the invite link
   create the Auth0 org membership before or after first login? Affects whether
   `invite.js` needs Auth0 Management API credentials, which is a new secret.
3. **Does the 7-day-old prefix get deleted by hand or on a timer?** A timer that
   deletes an org prefix is a dangerous thing to own.
4. **Tier field location** — `config.json` or a separate `billing.json`?
   `config.json` is public-read via `org-lookup.js`; tier probably should not be.

---

## RULINGS — signed off 2026-09-22, do not relitigate

- **§6 accepted. Matrix is NOT re-keyed.** `MTX2026TRAQS` is its org code.
  "Same rules" meant the same code path, not the same string shape, and that
  is already satisfied. The re-key tooling in §5 gets **built, not run**.
- **The validator accepts two shapes**: legacy alphanumeric 3–20, and the new
  `PREFIX.XXXX.XXXX`. All six enforcement points in §1, including the embedded
  one at `attachment.js:144`.
- **Auth0 `org_id` maps to the code through an index; it is not the prefix.**
- **`X-Org-Code` becomes a cross-check against the token claim.** The hole in
  §2 — where a user can present another org's code and is stopped only by that
  org's people file — gets closed.
- **Codes are server-generated only.** The `org.js` POST contract inverts: it
  takes the org name and returns the code.
- §8's open questions are re-raised **before step 5 (invites)** begins.

## STATUS

Plan signed off. Step 2 (multi-tenancy plumbing) in progress.
Steps 3–6 not started. Nothing committed.
