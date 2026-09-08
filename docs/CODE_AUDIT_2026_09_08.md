# Code Audit — 2026-09-08

**Scope:** `src/` (35,149 lines) + `netlify/functions/` (6,844 lines)
**Status:** Findings only. Nothing in this document has been fixed.
**Trigger:** Full-codebase sweep for dead code and critical bugs, deferred so
other feature work could land first.

> **Line numbers will drift.** Every finding below is anchored to a **symbol
> name and a code snippet** as well as a line number. If the line is wrong,
> grep the snippet — that still resolves. Do not trust the numbers after any
> substantial edit to `TRAQS.jsx`.

---

## 1. Critical — confirmed defects

### 1.1 `AssigneeSelect` throws on every dropdown click

**Where:** `src/TRAQS.jsx` ~3612, inside `function AssigneeSelect(...)` (~3591)

```js
onClick={() => { if (!open) onOpen?.(); setOpen(o => !o); }}
```

`onOpen` is never declared in this component. Its props are
`{ value, onChange, personOptions, people, extraStyle, compact }`. Optional
chaining guards a null *value*, not an undeclared *identifier*, so this is a
`ReferenceError` — and because it throws before `setOpen`, the dropdown cannot
open at all.

The name exists only as a prop on `EmployeeCard` and `GroupingSelect`; this
reads as a copy-paste from the latter, which does declare it.

Live at three call sites (~29326, ~29339, ~29347) — the Assignee fields on
job / panel / op.

**Fix:** add `onOpen` to the destructured props, or drop the call. Prefer
dropping it unless a caller actually needs the hook — no current caller passes one.

**Not yet verified:** that those three views are reachable at runtime. One click
confirms it before touching anything.

### 1.2 `onBreakNow` read before declaration (temporal dead zone)

**Where:** `src/TRAQS.jsx` — read at ~19826, declared at ~20246

```js
const onBreakNow = !!loggedInUser.activeBreak;   // ~20246
{onBreakNow && <span ...>}                       // ~19826, 420 lines EARLIER
```

TypeScript resolved both to the same scope (it emitted TS2448 "used before its
declaration", not TS2304 "cannot find name"), so this is a genuine TDZ
`ReferenceError` — *"Cannot access 'onBreakNow' before initialization"* — when
that branch renders. It sits in the active-job-clock panel, which is likely why
it has not surfaced constantly.

**Fix:** hoist the declaration above its first use.

### 1.3 Person id type drift — the founding admin is the victim

Three id generators disagree:

| Source | Value | Type |
|---|---|---|
| `netlify/functions/org.js` seed admin (~91) | `1` | **Number** |
| `src/TRAQS.jsx` `uid()` (~675) | `"t3k9dk2a"` | String |
| iOS `Person.id` | — | String |

Every **newly created** org therefore gets one person — the founding admin —
with a **numeric** id. This is not merely legacy data: `org.js` still mints
`id: 1` on every org creation today, so the drift is actively reproduced.

`MTX2026TRAQS` specifically carries two *different* numeric records from before
this — Trey (`99`) and Max (`100`) — per
[[project-person-id-type-drift]]. Same class of bug, different values; do not
assume `1` when testing against production data.

The plan-assign popover normalizes to strings and writes them straight back:

```js
const team = (live.team || []).map(String);            // ~27986
const next = on ? team.filter(...) : [...team, String(pp.id)];
updTask(planAssign.id, { team: next }, ...);           // ~27988 — persists STRINGS
```

Once a numeric-id person is assigned that way, `task.team` holds `"99"`, and
every `people.find(x => x.id === pid)` misses because `99 !== "99"`.

Silent downstream degradation — no error, just wrong output:

| Symbol | Effect when the lookup misses |
|---|---|
| `taskOwner` (~7837) | returns `null`, no owner name renders |
| filtered-task color map (~7954) | falls back to accent, loses their color |
| `getOffReason` (~7963) | their time off is ignored |
| availability filter (~7927) | `if (!person) return false` — dropped |
| overlap errors (~24085–24107) | prints the raw id instead of a name |

`sameId` / `onTeam` (~2815–2816) are the correct comparison helpers and already
exist. **436** raw `.id ===` comparisons exist in the file; ~37 match the
person-lookup shape.

iOS is already defended — `Person.init(from:)` uses `decodeFlexID`, which
coerces a numeric id to `String`.

**Two fix options, and this one needs a decision:**

- **Cheap:** mint the seed admin as a `String` in `org.js`. Fixes all new orgs;
  leaves existing orgs needing a one-off data touch-up.
- **Thorough:** sweep the ~37 person-lookup sites onto `sameId`. Fixes existing
  data too, and is robust against the next generator that disagrees.

Doing both is the real answer. See `project_person_id_type_drift` in memory.

---

## 2. Medium

### 2.1 `settingsNavLayer` ignores its argument

**Where:** `src/TRAQS.jsx` — defined ~24943, called ~26293 and ~26352

```js
const settingsNavLayer = () => ({ display: "flex", flexDirection: "column", gap: 8 });
// called as settingsNavLayer(false) and settingsNavLayer(true)
```

No parameters, so both nav layers render identically and whatever the flag was
meant to distinguish does nothing. Leftover from the full-page Settings rebuild.

**Fix:** either honour the flag or demote it to a plain constant object.

### 2.2 The three empty-overwrite guards disagree

| File | Status | Condition |
|---|---|---|
| `tasks.js` (~65) | **409** | only if existing data is non-empty |
| `clients.js` (~55) | **409** | only if existing data is non-empty |
| `people.js` (~96) | **400** | refuses *any* empty array |

Same intent, three implementations, two status codes. `people.js` is strictly
stricter — a legitimately empty roster can never be saved.

**Fix:** consolidate into one shared helper in `_utils/`. Decide deliberately
whether an empty roster is ever legal.

### 2.3 Event-listener cleanup imbalance

96 `addEventListener` vs 73 `removeEventListener` in `TRAQS.jsx`.
`setInterval`/`clearInterval` is balanced (16/18).

The 23-listener gap is **a category to review, not a confirmed leak** — some
window-level listeners are deliberately permanent for the app's lifetime.

---

## 3. Consolidation / dead code

### 3.1 Dead exports (definition is the only occurrence in `src/`)

| Symbol | File |
|---|---|
| `uploadAndProcess` | `api.js` ~492 — only forwards to `callAI` |
| `finishRequestAction` | `api.js` ~546 |
| `jobPauseAction` | `api.js` ~717 |
| `jobResumeAction` | `api.js` ~726 |
| `unsubscribePush` | `push.js` ~116 |
| `OBJECT_ENTITIES` | `db/index.js` |

**Do not remove the backend endpoints.** `timeclock.js` `jobPause` (~1085) and
`jobResume` (~1111) are live and serve iOS. Only the unused **web wrappers** go.

`finishRequestAction` also builds its request with **no `authHeaders`** — org
code only, no Bearer. Harmless while dead; must not be revived as-is.

### 3.2 Stale root-level scripts (~330 lines)

`check-admins.cjs`, `fix-admins.cjs`, `make-logos.cjs`, `make-ul-logo.cjs`

`make-logos.cjs` is **already broken** — it reads `TRAQS Logo Black.png` and
only the `.jpg` remains in that folder. It also rewrites `src/logo.js` wholesale,
which would drop the `UL_LOGO_WHITE` export. Do not run it. The Windows icon
work deliberately lives in a separate `scripts/make-app-icons.mjs` for this reason.

### 3.3 Redundant export

`FadeOnClose` is `export`ed from `TRAQS.jsx` but only ever used inside it
(249 uses). Harmless; the keyword is noise.

---

## 4. Standards

14 genuine emoji in user-facing UI, against the project's no-emoji rule
(see `feedback_no_emojis_in_app`):

`~9135` 🗑 · `~12134` 🏢 · `~20932` 🔧 · `~21000` 👤 · `~21002` 📞 ·
`~22041` 👁 · `~23443` 👤/👥 · `~24700` · `~29223` 📁 · `~29229` 📷 ·
`~29491` 📷 · `~29621` · `~29664` · `~30222` 🔧

The `✕` / `✓` glyphs are dingbats, not emoji — leave those.

---

## 5. Verified clean — do not re-audit these

Recording the negatives so the next pass does not repeat the work:

- **No S3 path traversal.** `orgCode` is regex-gated
  (`/^[a-zA-Z0-9]{3,20}$/`, `_utils/auth.js` ~255). The three public endpoints
  (`org.js`, `org-lookup.js`, `forgot-org.js`) derive codes from server-side
  `listOrgCodes()`, never from request input.
- **Zero loose-equality (`==`) bugs** across `src/` and `netlify/functions/`.
- **esbuild parses clean** — no duplicate object keys, no unreachable code.
- **All three post-incident data guards intact** — `dataLoadedRef` gating
  `doSave`, the backend empty-overwrite refusals, and `mergeFullSlice` fold-back.
  See `incident_2026_06_03_empty_tasks_overwrite`.
- **`validTs` is properly wired** at 7 sites in `timeclock.js`, so the
  NaN-payroll corruption path is closed.

### False positives already cleared

Do not re-report these:

- `val === "true" || val === true` (`TRAQS.jsx` ~12620) — TS2367 flags it as a
  no-overlap comparison. It is **deliberate** mixed-storage defense. Correct as-is.
- `lunchOpen` (`statsMath.js` ~179) — TS18047 "possibly null". It is guarded by
  `lunchOpen != null` on the same line; TS cannot narrow across the `forEach`
  closure. Correct as-is.
- All `new Date(a) - new Date(b)` arithmetic (TS2362/2363, ~6 sites in
  `timeclock.js`) — standard JS idiom, correct at runtime.

---

## 6. Not covered by this audit

- The Mac Swift shell (`TRAQS MacBook Native/`, ~7,490 lines) and the iOS app
  beyond the `Person` model.
- ~35 `TS2339` property errors, triaged as untyped-object noise without
  individually checking each.
- **React hook dependency correctness.** Requires `eslint-plugin-react-hooks`,
  which is not installed. Install it to the scratchpad, never to the repo.
- **Runtime behavior.** This was a static audit. None of the three critical
  findings in §1 has a runtime repro yet.

---

## 7. Recommended order

1. **§1.1 and §1.2** — one-line fixes to genuine `ReferenceError`s. Do these first.
2. **§1.3** — needs the cheap-vs-thorough decision above before starting.
3. **§3** — mechanical deletions, safe once §3.1's iOS caveat is respected.
4. **§2.2** — worth doing while the three guards are fresh in mind.
5. **§4** — cosmetic sweep, batch it with other UI work.

## How to reproduce this audit

```bash
# type-check src/ with a scratchpad tsconfig (never add one to the repo)
node_modules/.bin/tsc -p <scratchpad>/tsconfig.audit.json

# high-signal codes only; the rest is untyped-React noise
grep -E "error TS(2304|2448|2552|2554|2367|18047)" tsc-raw.txt

# parser-level checks (duplicate keys, unreachable code)
npx esbuild src/TRAQS.jsx --loader:.jsx=jsx --outdir=<tmp> --log-limit=0
```
