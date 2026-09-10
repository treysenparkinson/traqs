# Code Audit — 2026-09-10

**Scope:** follow-up pass over `src/` + `netlify/functions/`, covering the three
areas `CODE_AUDIT_2026_09_08.md` §6 listed as *not covered*: React hook
correctness, the iOS ↔ backend contract, and date/timezone handling.

**Status:** fixes APPLIED (uncommitted). See §3 for the fix log and §4 for what
was deliberately left open.

> Line numbers drift. Every finding is anchored to a symbol name and a snippet;
> grep the snippet, not the number.

---

## 1. New findings

### 1.1 Critical — conditional `useState` crashes the app at the 768px breakpoint

**Where:** `src/TRAQS.jsx`, inside `const renderMobileApp = () => {`

```js
const renderMobileApp = () => {
  const [moreOpen, setMoreOpen] = useState(false);   // hook in a plain function
```

`renderMobileApp` is not a component — it is a plain function called
conditionally from App's returned JSX:

```js
{isMobile ? renderMobileApp() : (() => { ... })()}
```

`isMobile` is real state, driven by a `resize` listener
(`useState(window.innerWidth < 768)` + `setIsMobile` in a resize effect). So App
renders **one extra hook while narrow**. Crossing 768px changes App's hook count
between renders, and React throws *"Rendered fewer hooks than expected"* /
*"Rendered more hooks than expected"*, unmounting the tree to the ErrorBoundary.

Repro: drag a desktop window across 768px, or toggle device mode in devtools. A
fixed-width phone never crosses the boundary, which is why it survived.

This was the only `react-hooks/rules-of-hooks` violation in the file.

### 1.2 High — `people.js` indexed the stored roster by RAW id, so iOS missed every numeric-id person

**Where:** `netlify/functions/people.js`, `const existingMap = new Map(existing.map(p => [p.id, p]));`

Swift `Person.id` is a `String`, decoded with `decodeFlexID` (which coerces a
numeric id) and encoded by the **synthesized** encoder — `Person` has no custom
`encode(to:)`. So iOS `savePeople` posts `"id": "1"` for a record stored as `1`.

Every `existingMap.get(p.id)` then missed, and `stored` came back `undefined`
for exactly those people, silently defeating four guards in the same function:

| Guard | Effect when `stored` is undefined |
|---|---|
| PIN carry-forward (`stored?.pin && !pIn.pin`) | **PIN dropped from the record** |
| server-authoritative clock pin (`activeClockIn` / `activeJobClock`) | the stale-roster clobber the comment above it warns about becomes possible again |
| `withBreakStart(np, stored)` | break start time not anchored |
| non-admin protected-field block (`if (!can(...) && stored)`) | skipped entirely |

Then `safeMerged = merged.filter(p => existingMap.has(p.id))` dropped the record
for a non-admin caller, and `reconcileDeletions` saw it missing from `next` and
**tombstoned them**. That last path is gated by the `hasRoleChange` 403 only when
the numeric-id person is an admin — a numeric-id *non-admin* gets soft-deleted.

`stampArray` and `reconcileDeletions` already key on `String(rec.id)`. This was
the **only** type-unsafe id map in the whole `netlify/functions/` tree.

Per `project_person_id_type_drift`, `MTX2026TRAQS` carries Trey (`99`) and Max
(`100`) as numerics, so this was live in production. **Confirmed by code reading
only — never run against live data.**

### 1.3 Medium — `TD` ("today") was frozen at module load

**Where:** `src/TRAQS.jsx`, `const NOW = new Date(); const TD = toDS(NOW);`

Module scope, **203 use sites**, never recomputed, and no midnight-rollover
handler anywhere in the file. A shop-floor board left open, or a phone resumed
the next morning, kept "today" pinned to the day the tab was opened.

Not only cosmetic — `TD` is *written into persisted records*: move-log entries
(`date: TD`, five sites) and new-job `start` / `end` defaults.

### 1.4 Medium — three "today" sites read a UTC timestamp instead of the local/org day

`new Date().toISOString().slice(0, 10)` — the exact bug `src/localDay.js`'s
header documents and exists to kill.

| Site | Impact |
|---|---|
| break-start row lookup (`breakStartTs`) | filters `timeclock` by `e.date === today`, but the server stamps `date` via `orgLocalDay`. At UTC-6, from 18:00 local the UTC date has already rolled, the filter matches nothing, and the break timer silently loses its start time. |
| overload filter (`fOverloaded`) | today's time-off and booked hours skew to tomorrow each evening. |
| attachment filename | cosmetic. |

### 1.5 Medium — client and server disagreed on email matching

Client: `person.email.toLowerCase() === auth0User.email.toLowerCase()`.
Server (`_utils/auth.js`): `String(p.email || "").toLowerCase().trim()`.

A person record with a trailing space in `email` authenticates fine server-side
but fails to match client-side. The client then falls back to
`setLoggedInUser(resolvedPeople[0])` — silently running the UI as whoever is
first in the roster, including their role, their colour and their clock, with
any write keyed on a person id landing on that person's record.

The trim was the bug that *reached* the fallback; the fallback itself is the
hazard. Its one genuinely reachable case is the **bootstrap admin**: someone in
`config.adminEmail(s)` with no `people.json` entry, whom `requireOrgMember`
admits with `personId: null`. A non-member can't reach it at all — their very
first data fetch 403s.

### 1.6 Low — `filtered` gated on `isAdmin` / `loggedInUser` without depending on them

The `filtered` useMemo's first line is the non-admin visibility gate
(`if (!isAdmin && loggedInUser && !sameId(t.projectManagerId, loggedInUser.id)) return false;`),
but neither identifier was in its dependency array. Latent rather than live:
every `setLoggedInUser` call is batched with a `setPeople`, and `people` *is* a
dep. Fixed anyway — the coupling is invisible and one refactor away from biting.

---

## 2. Verified clean this pass — do not re-audit

- `npm run build` exits 0; `scripts/check-function-imports.mjs` clears all 23
  functions; esbuild parses `TRAQS.jsx` with no errors.
- **No secrets tracked.** `.env` / `.env.local` are gitignored and absent from
  `git ls-files`; only `.env.example` and `keystore.properties.example` are in.
- **Every HTTP endpoint is authenticated.** All 23 functions either call
  `requireOrgMember` or (`messages.js`, `org-lookup.js`) `validateToken` plus
  their own membership resolution. The four with no auth
  (`backup-daily`, `forgot-clockout`, `timeoff-cleanup`, `forgot-org`) are
  scheduled sweeps or the deliberate public recovery path.
- **`stampArray` and `reconcileDeletions` are id-type-safe** — both key on
  `String(rec.id)`. Only `people.js`'s local map was not (§1.2).
- **`idKey` is not a drift fix and was not meant to be.** `typeof v + ":" + v`
  is documented as deliberately type-preserving so the index reproduces the
  `===` scan it replaces. `sameId` / `onTeam` remain the tools for treating `99`
  and `"99"` as one person. Do not "fix" `idKey`.
- `copyPrefix`'s fully-encoded `CopySource` is fine — S3 URL-decodes it.

---

## 3. Fix log — applied 2026-09-10, uncommitted

| # | File | Change |
|---|---|---|
| §1.1 | `TRAQS.jsx` | `moreOpen` state hoisted out of `renderMobileApp` into App's hook block |
| §1.2 | `people.js` | `existingMap` keyed on `String(p.id)`; added `storedFor(p)` helper; `safeMerged` filter String-keyed |
| §1.3 | `TRAQS.jsx` | `TD` / `NOW` are now `let`, with `refreshToday()` + a `useTodayKey()` hook (60s interval plus `focus` / `visibilitychange` catch-up) |
| §1.4 | `TRAQS.jsx` | break-start lookup → `localDay(now, statsTimeZone)`; other two → `TD` |
| §1.5 | `TRAQS.jsx` | `.trim()` added to both client-side email matches |
| §1.5 | `TRAQS.jsx` | the `resolvedPeople[0]` / `np[0]` impersonation fallback replaced with `bootstrapPerson(email, isAdmin)` — a synthetic identity with `id: null` and `isBootstrap: true`. A null id is the honest answer: every person lookup misses, correctly, because they are not on the roster, and `sameId` already returns false for null. The no-Auth0-email branch now sets `null` rather than picking someone arbitrary. |
| §1.6 | `TRAQS.jsx` | `isAdmin`, `loggedInUser` added to the `filtered` dep array |
| 09-08 §1.1 | `TRAQS.jsx` | `AssigneeSelect`'s undeclared `onOpen?.()` call dropped — no caller passes one |
| 09-08 §1.2 | `TRAQS.jsx` | `onBreakNow` → `onBreak`. **Not** a hoist: the enclosing IIFE already declares `const onBreak = !!loggedInUser.activeBreak;` nine lines above and uses it correctly right below. It was a typo. |
| 09-08 §1.3 | `org.js` | seed admin `id: 1` → `id: "1"` |
| 09-08 §2.1 | `TRAQS.jsx` | `settingsNavLayer` demoted to a plain constant; both call sites drop their dead argument |
| 09-08 §2.2 | `_utils/entities.js`, ×3 | one shared `emptyOverwriteError` helper; `people.js`'s blanket 400 became the same 409 rule as tasks/clients, including `?force=1` |
| 09-08 §3.1 | `api.js`, `push.js`, `db/index.js` | dead web wrappers removed: `uploadAndProcess`, `finishRequestAction`, `jobPauseAction`, `jobResumeAction`, `unsubscribePush`, `removePushSubscription`, `OBJECT_ENTITIES`. Backend endpoints untouched. |
| 09-08 §3.2 | repo root | `check-admins.cjs`, `fix-admins.cjs`, `make-logos.cjs`, `make-ul-logo.cjs` deleted |
| 09-08 §4 | `TRAQS.jsx` | all 19 colour-emoji sites plus the 10 pictograph stand-ins (`⚠` `✎` `✉`) replaced with inline SVG from a new `Ico` set in the file's existing Feather stroke language. Plain text where the glyph sat inside a string literal. |
| §1.5b | `App.jsx` | the roster membership re-check had the same missing `.trim()` |

**§3.3 was WRONG and is not applied.** The 09-08 audit called `FadeOnClose`'s
`export` redundant; `App.jsx` imports it (`import TRAQS, { FadeOnClose }`). The
build caught it. That finding only looked for uses inside `TRAQS.jsx`.

**Glyph census after the sweep** — nothing pictographic left in `src/`. What
remains is box-drawing in comment banners (`─` `═`), arrows (`→` `←` `↳`),
geometric UI marks (`▼` `▲` `●` `○`), maths (`≤` `≥` `≠` `∈`) and the
`✕`/`✓` dingbats the 09-08 audit said to leave.


**Verification:** `tsc` high-signal errors went 4 → 0 (TS2552, TS2448, TS2554×2
all cleared); `react-hooks/rules-of-hooks` 1 → 0; `exhaustive-deps` set
unchanged except the intended `filtered` entry. Build passes. **No runtime
testing was done** — the breakpoint crash, the midnight rollover and the iOS
roster write all still want one manual pass each.

---

## 4. Still open

- **Concurrency — `_utils/s3.js` writes with no `IfMatch`/ETag.** Deliberately
  NOT patched, because an ETag does not fix this. Two admins both read V0; A
  writes V1; B writes V2 and A's edits are gone. Add `IfMatch` and B gets a 412
  instead — but B's retry re-runs `reconcileDeletions(B_snapshot, V1)`, which
  now *tombstones* A's new job. Strictly worse. The real fix is a delta write
  (the `PATCH /people` shape) for `tasks`, or surfacing the collision to the
  user as a 409 through the existing save-failure banner — and that second
  option makes every concurrent autosave in a two-admin shop raise a scary
  banner, which is a product call, on the write path that caused the
  2026-06-03 incident. Needs a decision plus a runtime test, not a quick patch.
- 20 remaining `exhaustive-deps` warnings and 5 `eslint-disable` directives that
  no longer suppress anything. `eslint-plugin-react-hooks` is still not a repo
  dependency — this pass installed it to the scratchpad only.
- `~35` `TS2339` property errors and the React prop-shape noise
  (`TS2739`/`TS2741`/`TS2345`), triaged as untyped-object noise. Spot-checked
  the `TS2345` cluster this pass: the `GridRow` ones are level-0 rows where
  `jobId`/`panelId` are undefined by design. Not bugs.
- The Mac Swift shell (`TRAQS MacBook Native/`) and the iOS app beyond the
  `Person` model.
