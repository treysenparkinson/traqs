# Tiers: what is sold, what the code does

**Corrected 2026-10-02**, twice, and the correction is the most useful thing in the document, so
it comes first.

---

## The lesson

This document originally claimed the **code** had drifted from the **promise**. It walked
`TRAQS.jsx`, found eleven tier-gated paths that `src/tiers.js` did not account for, and concluded
nine of them were defects. Acting on that, commit `6257ee3` removed nine gates and rewrote the
table to say Basic was the whole product. That commit has been reverted in full.

**The premise was backwards. The code was right. The promise was incomplete, and `tiers.js` being
silent is what made nine deliberate gates read as defects.**

With the real tier line unwritten, there was nothing for any individual gate to be checked
against, so each one looked arbitrary — and nine arbitrary-looking gates look like drift. One row
did most of the damage:

> **"Scheduling & job management"** — in the Basic column.

Basic has no job layer. Four words sold it one, and that was enough to make a deliberate design
read as a bug list. The second attempt at this table then repeated the mistake in smaller form by
writing **"Flat jobs — one task, one team, one time"** under Basic. A shift is not a small job.
That is the shape to watch for: not a wrong row, an *almost-right* one.

**A silent table cannot defend a deliberate decision.** `scripts/tiers-test.mjs` now asserts the
job layer is absent from the Basic column in ten different wordings, and that is the guard that
matters most in this repository.

---

## The definition

### Basic — shift scheduling and a pay clock. That is the whole product.

- **Schedule**: the same view, drawing **shift bars on person rows**. Start time, end time,
  optional notes and location. **Nothing else on a bar.**
- **No departments**, so no row grouping.
- **New shift modal**: title, day, all-day or specific times, who's on it.
- **Time clock for pay only.**
- **Hours export from pay punches only.**
- **Employees page** in Analytics' slot — name and phone, for quick contact.
- **Dashboard, messages, admin.** Admin shows clocked in or out, with no job log.
- **All manual.**
- **No jobs, panels, ops, PO numbers, job numbers, job clock, or time logged against work — in
  any form.**
- **No hatching, no overdue tray, no cursor.** Those are job-time concepts: hatching is
  worked-vs-estimated, the overdue tray is work past its date, the cursor is progress through an
  estimate. With no time logged against work there is nothing for any of them to draw.

### Business — all of that plus the job layer

Jobs, panels and operations · PO and job numbers · job clock · time logged against work ·
Analytics in the Employees slot · Clients · approval templates · departments · automatic
scheduling · SSO · email-domain allowlist · priority support.

### Basic is not a subset

Business puts **Analytics** in the slot Basic uses for **Employees**, so Business genuinely lacks
a page Basic has. Any comparison rendered as `[...BASIC, ...BUSINESS]` prints a false claim.
`tiers.js` exports `BASIC_ONLY` and `businessColumn()` for exactly this, the upgrade modal uses
them, and the suite asserts a naive concatenation would be caught.

---

## What the code actually implements

**The sold definition is ahead of the code, and the gap is large.** This is not drift — it is a
product definition the implementation has not caught up to. Recorded here so nobody mistakes the
second for the first again.

### Enforced server-side — two checks in the whole codebase

| Where | What |
|---|---|
| `org.js:276` | the email-domain allowlist is Business only |
| `tasks.js:68` | the overlap rule runs for Business orgs only |

`clients.js`, `settings.js`, `user-settings.js`, `timeclock.js` and `_utils/can.js` contain **no
reference to billing tier at all**. Everywhere else the tier exists only in the browser, and
`billingTier` is seeded from `localStorage` before the real value is fetched.

### Gated in the client — the nine, all deliberate, all restored

The `switchView` guard (`:4206`) and `views[]` filter (`:10444`); the mobile tab bar (`:22436`)
and More sheet (`:22449`); client quick-search (`:22405`); `openNew` (`:9856`);
`openJobDetailOrEdit` (`:10056`); approval templates (`:26262`); the Job Clock card (`:21132`).
Plus the context-menu Reschedule-vs-Edit ternary (`:31827`) and four liquid-background sites.

### Sold but NOT implemented

Every row here is a real gap between this document and the product. None is a regression; all are
work not yet done.

| Sold | Today |
|---|---|
| Basic has **no jobs in any form** | Basic creates flat `jobType: "general"` jobs through the simple modal. **There is no shift type.** A Basic bar is a job with one flat sub. |
| Basic bars carry **no job time** | Basic bars carry `hpd`, worked hours and overrun — see the flag below on #119–#123. |
| **No job clock** for Basic | `jobClockIn`, `jobClockOut`, `updateJobSession`, `releaseJobSession` carry **no tier check**. The card is hidden in the UI and the endpoints are wide open. |
| **No departments** for Basic | Departments are ungated — 93 references, no tier check on any of them. |
| **Analytics in the Employees slot** | `employees` is not in the Business-only view filter, so **Business has both** Employees and Analytics. The slot swap does not exist. |
| **No hatching, overdue tray or cursor** for Basic | All three render for Basic today. |
| **PO and job numbers** are Business | No field-level gate; unreachable only because Basic cannot open the wizard. |

`scripts/tiers-test.mjs` pins this as an explicit `NOT_ENFORCED` list rather than leaving it
silent, and asserts every Business row is either gated or on that list. Enforce one and the suite
will tell you to move it.

---

## #125 — tier enforcement, rescoped again

Commit `6257ee3` briefly considered #125 **resolved**, on the reasoning that if nine gates became
Basic there was nothing left to enforce. That followed only from the wrong ruling. Under the real
definition #125 is **substantially larger than first written**: it is no longer "nine client-side
gates want a server check", it is "the sold tier boundary is a job layer that Basic can still
reach through the API and, in several places, through the UI".

Sorted by whether a server could refuse the payload:

**Enforceable — a Basic org sending this is distinguishable:**

- **The job layer itself.** A job with `jobType: "panel"` and nested `subs[].subs[]` is a shape
  Basic's own client cannot produce; `tasks.js` could refuse it outright. Stronger still under
  this definition: if Basic has no jobs at all, *any* task write from a Basic org is refusable
  once a shift type exists to replace it.
- **The job clock.** Four actions, no tier check, action name identifies the feature.
- **Departments, approval templates, Clients** — all land through endpoints with no tier check.

**Not enforceable, independent of any ruling:**

- **Automatic scheduling.** Overlap clearing, reflow serialisation, dependency cascade and
  conflict blocking are things the **client** does on your behalf. No payload says "this was
  reflowed", and a person can drag ops into exactly the arrangement reflow would produce.
  Business here gets more *help*, not more *permission*. The one piece the server owns, the
  overlap rule, is already gated.
- **The view guard.** Navigation over data the org already owns.

`TIER_RULES_MODE` is still **not built** — `log` by default, tier read server-side from
`billing.json` and never from the client, recording to `rule-events.json` under a `tier-rule` tag,
per `org.js:264`. Enforcing a tier against live customer data is a product call.

---

## #333 — granular permissions

**The one row that was never a misreading.** Listed under Business; `_utils/can.js` enforces
`adminPerms` for every org with no tier check. Everywhere else the table *under-described* what
the code did; here the table **sold what the code gives away**. The only row that costs money
rather than goodwill.

Removed from the table rather than left standing as a false claim, with the suite asserting it is
claimed by *neither* tier. That is a holding position, not a resolution. It needs a ruling
between gating `adminPerms` (new orgs only, never a takeaway) and putting it in Basic
deliberately.

---

## Still open

**#336.** `callAI` POSTs to `/.netlify/functions/ai-schedule`, which has no source in this
repository — 25 handlers in `netlify/functions/` and that is not one of them. The live endpoint
answers 401 rather than 404, so it exists and is authenticated but ships from somewhere this
checkout cannot see. Nobody can review it, nobody can fix it, and it writes schedule data.

**#335 is moot.** It logged the Basic simple-edit path as orphaned by `6257ee3`. With that commit
reverted the path is live and is Basic's only edit surface. The #159 and #160 fixes made on it are
back in force.

## Decided 2026-10-02

- The eleven gates are the product design. `6257ee3` reverted in full.
- The table is written from Trey's definition, and the code is behind it, not ahead.
- Basic is **not** a subset of Business.
- **#332** — reverted. The job clock is Business; Basic's clock is for pay only.
- **#333** — off the table, unenforced, open.
- **#125** — larger than first written; the job layer is the boundary.
- **#335** — moot.
