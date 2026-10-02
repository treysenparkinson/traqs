# Tiers: what is sold, what the code does

**Reconciled 2026-10-02.** This document existed because the two did not match, in both
directions. They match now, and the history is kept below because the way they drifted is the
part worth not repeating.

---

## The principle

> Basic is the whole product minus what genuinely costs more to provide — SSO, support, and
> automatic scheduling. Everything else is Basic. Gating features to make Basic feel thin
> loses the customer before they ever consider upgrading, and a one-shop panel builder is
> exactly who I'm selling to.

## The table

| Basic | Business adds |
|---|---|
| Scheduling, jobs, panels & operations | **Automatic scheduling** — overlap clearing, reflow, dependency cascade |
| Time tracking, job clock & timesheets | Microsoft / SSO sign-in |
| Mobile clock in/out | Email-domain allowlist |
| Clients, analytics & approval templates | Priority support |
| Pay-period hours export | |

One line: **Basic shows you your schedule. Business rearranges it for you.**

`src/tiers.js` is the sold definition and `scripts/tiers-test.mjs` guards it. Both now state the
automatic-scheduling line explicitly. It used to be absent, and that silence is what let the
code drift: with nothing written down, every gate looked as defensible as every other.

---

## What changed

**Nine of the eleven write paths became Basic.** Gates removed:

| Was gated | Now |
|---|---|
| Jobs page, Analytics, Clients (view guard + 3 nav filters) | Basic |
| Panel/op job structure — Basic got a flat one-sub job | Basic gets the real wizard |
| Job Details on a bar click — Basic got a reduced edit modal | Basic gets Job Details |
| Context-menu Reschedule — Basic got a reduced Edit | Basic gets Reschedule |
| Job Clock card (#332) | Basic |
| Approval templates | Basic |
| Liquid background (4 sites) | Basic |
| Client quick-search | Basic |

**Two stay Business:** the email-domain allowlist, and automatic scheduling.

**Granular admin permissions were removed from the table entirely.** They were listed under
Business and `_utils/can.js` has always enforced them for every org with no tier check — the
claim was false the whole time it was printed. Ruled: left working for everyone; if ever
reclaimed, new orgs only, never taken from an org that has it. `tiers-test` now asserts they
are claimed by *neither* tier, so the false claim cannot come back while the code gives them
away.

---

## Why there is no server enforcement to build

The plan was a `TIER_RULES_MODE` flag in `log`, tier read from `billing.json`, following
`org.js:264`. **It is not built, because after the ruling there is nothing for it to refuse.**

- The nine unhidden rows are Basic. Nothing to enforce.
- The email-domain allowlist is already gated at `org.js:276`.
- **Automatic scheduling is not server-enforceable.** Overlap clearing, reflow serialisation,
  dependency cascade and conflict blocking are all things the CLIENT does on your behalf.
  There is no payload that says "this was reflowed" — a person can drag ops into exactly the
  arrangement reflow would produce, and the server cannot tell the difference, nor should it
  try. The one piece the server does own, the overlap RULE, is already Business-only
  (`tasks.js:68`).

Worth being precise about a framing I had wrong earlier: I described these four as cases where
"a server can refuse their output". It can't. In all four, Business is the tier that gets
*more help* and, for the rule checks, *more restriction* — a Basic org gains nothing by
sending the same data, because it had to do the work itself to produce it.

Building the flag anyway would have created something that can never fire: the same shape as a
log nobody reads (#327) and a suite nobody runs (check-suites-wired). Logged in #125.

**One open thread (#336):** `callAI` POSTs to `/.netlify/functions/ai-schedule`, which has no
source in this repository. The live endpoint answers 401, so it exists and is authenticated,
but it is deployed from somewhere this checkout cannot see. AI scheduling is the one piece of
automatic scheduling that IS a server endpoint, and therefore the one place a tier gate could
actually be enforced — whether it has one cannot be determined from here.

---

## How it drifted (kept deliberately)

The code and the table disagreed in **both directions** for months, and nothing reported it:

- **Sold to Basic, withheld from Basic.** "Scheduling & job management" with the Jobs page
  hidden and a job that could not hold a panel. "Mobile clock in/out" with the Job Clock card
  hidden — while the four job-clock endpoints had no tier check at all, so the feature was
  paid for, hidden in the UI, and fully reachable through the API.
- **Sold as Business, given to everyone.** Granular permissions, enforced for every org.
- **Argued against in writing, done anyway.** `src/tiers.js` said gating analytics "would be
  taking something away, not adding something". `TRAQS.jsx:4206` gated it. The comment saying
  not to do this lived in the file that defined the tiers.

The common cause: the table was silent on the one real difference, so there was nothing to
check any individual gate against. Each was locally plausible. `tiers-test.mjs` guarded the
claims that were written down and could not guard the one that wasn't.

## Ruled 2026-10-02

1. #4 panel/op tree — **Basic**. A flat one-sub job is a worse product, not a cheaper tier.
2. Analytics — **not gated**. tiers.js was right, the code was wrong.
3. #7 clients — **Basic**. A shop with customers needs a client list.
4. #8 approval templates — **Basic**.
5. #11 liquid background — **Basic**. Cosmetics are not a tier.
6. #2/#3/#5/#6 automatic scheduling — **Business**, and stated in the table.
7. #332 job clock — **Basic**. Already ruled; now shown.
8. #333 granular permissions — left as is. If reclaimed: new orgs only, never a takeaway.
