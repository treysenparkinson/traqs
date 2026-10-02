# Tiers: what is sold, what the code does, and where they disagree

This exists because the two do not match, and the mismatch runs in **both directions** — things
sold to Basic that Basic cannot reach, and things sold as Business that every org already has.

It is a product document, not a defect list. Nothing here should be "fixed" by adding a server
check until the row it belongs to has been decided, because enforcing today's client behaviour
would make the server refuse things the comparison table promises Basic customers.

Written 2026-10-02, from `src/tiers.js`, `src/TRAQS.jsx` and `netlify/functions/`.

---

## The promise

`src/tiers.js` is the sold definition, and it was written carefully: every line was confirmed
against the codebase, and three plausible claims were deliberately cut as untrue (an employee
cap, "advanced analytics", "payroll & HR export"). It is the more trustworthy of the two
sources, and where this document finds a disagreement it treats the table as the intent.

| Basic | Business adds |
|---|---|
| Time tracking & timesheets | Microsoft / SSO sign-in |
| Mobile clock in/out | Granular admin permissions |
| Scheduling & job management | Priority support |
| Pay-period hours export | |

Business is not self-serve. Provisioning is manual (`billing.js`), and the CTA opens a
conversation rather than a purchase.

## What the server actually enforces

**Two checks, in the whole codebase.**

| Where | What |
|---|---|
| `org.js:276` | the email-domain allowlist is Business only |
| `tasks.js:68` | the overlap rule runs for Business orgs only |

`clients.js`, `settings.js`, `user-settings.js`, `timeclock.js` and `_utils/can.js` contain **no
reference to billing tier at all**. (`people.js` mentions "tiering", but that is about PIN
visibility by role, not billing.)

Everywhere else, the tier exists only in the browser — and `billingTier` is seeded from
`localStorage` before the real value is fetched. So for every row below marked "none", a Basic
org that sends Business-shaped data is simply accepted: by an old client, by an edited cache,
or by curl with a valid token.

---

## The eleven write paths

Rendering differences are excluded — lanes, day-view packing, bar layout. Those cannot be
enforced server-side and do not need to be. These are the ones where data leaves the client.

| # | Path | Business | Basic today | Server | Promise | Verdict |
|---|---|---|---|---|---|---|
| 1 | `enforceNoOverlap` J:9077 | clears overlaps, moves ops | returns unchanged | **gated** | silent | **agrees** |
| 2 | `refuseDragMove({business})` J:9090, J:16966 | refuses past + overlapping landings | allows both | none | silent | consistent, unenforced |
| 3 | `reflowJob({overlap})` J:9662 — **#124** | serialises a job's ops | no overlap ctx | none | silent | consistent, unenforced |
| 4 | Simple create/edit J:9850, J:10050 | panel/op tree | one flat `general` sub | none | **"job management" is Basic** | **disagrees** |
| 5 | Group drag with deps J:16816 | cascades siblings | single bar | none | silent | consistent, unenforced |
| 6 | `occupyingUnits` J:8951 | blocks conflicting drags | no check | none | silent | consistent, unenforced |
| 7 | Clients J:22407, J:22420 | full CRUD | page hidden | `manageClients` only | silent | **unclear — see below** |
| 8 | Approval templates J:26233 | editable | hidden | none | silent | **unclear** |
| 9 | `updateOrgDomain` J:26347 | settable | hidden | **gated** | SSO is Business | **agrees** |
| 10 | Job clock card J:21103 | shown | hidden | none | **"Mobile clock in/out" is Basic** | **disagrees** |
| 11 | Liquid background J:27318 etc. | custom colour | fixed | none | silent | **unclear** |

Two of eleven are enforced. Nine are suggestions.

---

## Disagreements, in both directions

### Sold to Basic, withheld from Basic

**#4 — job structure.** Basic is sold "Scheduling & job management" and gets a flat one-sub
job, with the entire Jobs page hidden (`:4206`, `:10438`, `:22407`). It can schedule; it cannot
manage jobs. Either the table is overselling or the gate is overreaching.

**#10 — the job clock.** Basic is sold "Mobile clock in/out" and the Job Clock card is hidden
from it, while `jobClockIn`, `jobClockOut`, `updateJobSession` and `releaseJobSession` have no
tier check whatsoever. So the feature is paid for, hidden in the UI, and fully reachable
through the API. **RULED 2026-10-02: the table is right and the UI is wrong. Basic should see
the job clock card.** Logged as #332 — a missing feature on a tier that paid for it, not a
tier-enforcement question.

**Analytics.** Not in the eleven because it is a view gate rather than a write, but it is the
sharpest case and `tiers.js` predicted it in writing:

> `"advanced analytics"` NOT LISTED. There is one analytics page and no basic/advanced split
> anywhere in the product, so the axis does not exist to sell — and Matrix already uses that
> page. **Gating it would be taking something away, not adding something.**

`TRAQS.jsx:4206` gates it. The comment that says not to do this is in the file that defines the
tiers, and the code does it anyway.

### Sold as Business, given to everyone

**Granular admin permissions.** Listed under Business. `_utils/can.js` enforces `adminPerms`
for every org with no tier check, so every Basic org has had granular permissions the whole
time. This is the only row that costs money rather than goodwill.

**RULED 2026-10-02: log it, change nothing.** It is a pricing leak, but taking a working
capability away from existing Basic orgs is not something to do by flipping a server check.
Logged as #333.

### Unclear in both directions

**#7 clients, #8 approval templates, #11 liquid background.** Hidden from Basic, promised to
nobody, enforced nowhere. Each needs a decision rather than a fix: if they are Business, the
server should say so; if they are not, the client should stop hiding them.

---

## What this means for enforcement

The four consistent-but-unenforced rows (#2, #3, #5, #6) are one coherent behaviour: *Basic does
not rearrange your schedule for you.* They are defensible against the table, which never
promises Basic automatic scheduling, and #1 is already gated the same way.

They are **held** pending a decision on the whole set. Enforcing a coherent four while seven
stay contradictory would harden half a definition and make the other half harder to change —
and a server check that refuses something the comparison table sells is worse than no check.

When the set is decided, the mechanism should follow `org.js:264`:

> The tier is checked HERE and not only in the UI. Hiding a control is a suggestion; this
> endpoint is reachable with a token and a curl.

A `TIER_RULES_MODE` flag defaulting to `log`, tier resolved server-side from `billing.json` and
never from the client, recording what it would refuse to `orgs/{org}/rule-events.json` under a
`tier-rule` tag — the same rollout every other enforcement here has had, and now readable,
since #327.

---

## Open questions

1. Is a panel/op job tree a Business feature, or is "job management" a Basic promise? (#4)
2. Should the Jobs page and Analytics be gated at all? `tiers.js` argues Analytics should not.
3. Are clients, approval templates and the liquid background Business features? (#7, #8, #11)
4. Granular permissions are sold as Business and given to everyone — leave as is indefinitely,
   or change for new orgs only? (#333)

## Decided

- **#332** — Basic should see the job clock card. Missing feature, not an enforcement gap.
- **#333** — granular permissions: logged, unchanged.
