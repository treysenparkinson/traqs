# Dynamic Schedule — Handoff / Status

Last updated: 2026-09-18

## What this feature does

Clocking into a job makes a live-updating bar grow in real time on the
Schedule page. It drains a "reservoir" (the op's originally scheduled
block, wherever that is), cascades/pushes other ops on the same
person's row out of the way as needed, and commits or reverts cleanly
when an admin approves/denies a finish request.

Built as **Phases 1-4**, additive-only to the existing Schedule page in
`src/TRAQS.jsx` — no renamed fields, no changed shape of existing UI.

## Where the code lives

- Branch: `feature/dynamic-schedule`
- Worktree: `C:/Users/treysen/traqs-func` on the treysen machine.
  (The paths this doc gave previously — `C:\Users\parki\traqs\.claude\worktrees\schedule-dynamic`
  and a `visual-agent-gantt` sibling — were on a DIFFERENT machine and do
  not exist here. The functionality/visuals split survived the move; see
  "Parallel work — NOT in this branch" below for the current layout.)
- Main files touched:
  - `src/TRAQS.jsx` — all client-side logic (day-mode and week/month-mode
    live bar blocks, reservoir drain mask, cascade/push math, session
    lifecycle handlers)
  - `src/api.js` — added `updateJobSessionAction`
  - `netlify/functions/timeclock.js` — extended `jobClockIn`, added new
    `updateJobSession` action
  - `netlify/functions/people.js` — read only, not modified (already
    passthrough-protects `activeJobClock` via `serverOwnedPersonFields`)

## Session data model

On `person.activeJobClock`:
- `sessionId` — `sess_<personId>_<clockInISO>`
- `reservoirOpId` — the op whose scheduled block is being drained
- `drainCheckpoint` — last persisted point the reservoir has drained to
- `sessionSnapshot` — pre-clock-in state, used to revert on deny
- `frozenAtMs` — set when a finish request is pending; freezes the live
  bar/drain from advancing further until approved/denied

## Key functions (in TRAQS.jsx)

- `findOp(taskList, opId)` — string-coerced op lookup
- `findOpAsBarTask(taskList, opId)` — looks up an op as a renderable bar
  **independent of the clocked-in person's team membership** (needed so
  the live bar is clickable even when admin-testing an unassigned op)
- `opHourRange`, `computeCascadePushes`, `runClockCascade`,
  `buildSessionSnapshot`, `revertSession` — Phase 3/4 core logic
- `applyPushes(taskList, pushes, movedBy, sessionId)` — shared
  application/moveLog-append layer, extended to accept `sessionId` and
  `newStartHour`/`newEndHour`, backward compatible

## Server persistence (why it was needed)

`serverOwnedPersonFields` in `people.js` does a full passthrough of
`activeJobClock`, which silently defeated any client-side `savePeople`
call trying to write session fields. Fixed by extending the **existing
authorized write paths** rather than weakening that protection:
- `jobClockIn` now accepts `sessionId`, `reservoirOpId`,
  `sessionSnapshot` in the request body and persists them (plus a
  server-derived `drainCheckpoint`).
- New `updateJobSession` action validates `personId` + `sessionId`
  against the stored session (409 on mismatch) and merges only
  `drainCheckpoint`/`frozenAtMs`.

This fix landed on `master` as commit `fbdd205` (server is already
deployed) and is also present on `feature/dynamic-schedule` via
`da0c714` (client-side rewire to actually send/use those fields).

## Bugfix history (chronological)

1. **Round 1**: cursor not moving, live bar rendering full-size, reservoir
   not draining, cascade not pushing. Root cause included `.includes()`
   id-type mismatches (missing `String()` coercion).
2. **Round 2**: live bar still rendered as a full-day block instead of a
   growing sliver. Root cause: one teleport formula applied to two
   different cases (covering-now vs. later-today) — fixed by branching
   on whether clock-in hour falls inside the op's current scheduled
   range. Also changed the render tick to a flat 5s interval.
3. **Round 3**: live bar had a hardcoded green gradient/glow. Changed to
   a solid fill matching the real op's color, with a "LIVE" text badge
   as the only differentiator.
4. **Round 4**: reported bug ("live bar renders at reservoir's full
   duration on clock-in") could **not be reproduced** after tracing both
   render blocks — confirmed via live empirical retest. Root cause of
   the report was later found to be a stale build: commit `e868171`
   (see below) existed locally but had never been pushed, so the branch
   the user was testing against was missing fixes.
5. **Clickable live bar** (mid-stream request, commit `e868171`): the
   live bar wasn't clickable/didn't show the real op's color for
   unassigned-team test cases. Fixed with `findOpAsBarTask`, a
   team-independent lookup, used for both color and click/right-click
   targeting.
6. **Round 5 / most recent (commit `4718b7d`)**: live bar was positioned
   at the actual clock-in wall-clock hour, so it rendered floating
   mid-column instead of at the column's left edge (visible in week
   view — reported via screenshot showing the "LIVE" pill sitting
   mid-day-16-column instead of flush left). **User explicitly decided**
   (via clarifying question) that the bar should always render flush to
   the **left edge of today's column**, with width driven by actual
   elapsed session duration (same value that drives the reservoir's
   drain rate), so the two stay in sync. Applied to both the day-mode
   block (~line 15410) and the week/month-mode block (~line 17158).
   **This fix has been pushed but not yet re-tested/confirmed by the
   user.**

## STATE AS OF 2026-09-18 — READ THIS FIRST

### STATE 2026-09-21 — THE GEOMETRY REWRITE, MOSTLY LANDED

The hatch is a RECORD, not an extent: that question is settled and built. `activeBarFill`
takes `[startPct, endPct]` spans, the idle layer is their COMPLEMENT, and so idle can appear
to the left of the hatch (work that started late) and between two hatches (work done in two
sittings). Neither was expressible before. Trey confirmed the fill in a browser.

Landed since: per-op push (unworked work cannot sit left of now, so the remainder starts at
the cursor and the bar's budget grows by the idle gap — the left edge never moves); tails
measured against their own window; cross-row work drawn on the worker's own row (§3a); the
drag/resize refusal while someone is clocked in (§3c, first rule); and the Q7b freeze, so a
forgotten punch stops at the end of the day it started on instead of growing all weekend.

`scripts/worked-spans-test.mjs` is the safety net — 84 assertions, five red proofs, each
rejecting the plausible wrong implementation rather than only confirming the right one. Run
it with `node scripts/worked-spans-test.mjs`. `npm run build` also runs Verifier's
`check-live-hours` guard ahead of vite.

**All eight items are landed.** The split is wired (the original id keeps the history, the
remainder is a new record, and a reassign follows the remainder rather than the history); the
refusal is a dialog carrying the wording the spec fixes; `unclosedAt` is persisted through
`updateJobSession`; and the spanning title carries a halo rather than a scrim.

**What still wants a human rather than more code:**

- **The split has never been dragged.** The rule is table-tested; the tree transform is not. It
  mints an op record on drop, which is the one place in this feature that can write a corrupt
  row. Drag a half-worked op, then a fully-worked one, then one onto another person, and read
  what lands in tasks.json before trusting it.
- **The halo has never been seen at 11px.** A soft halo on small bold text is exactly the thing
  that measures fine and looks cheap. If it reads poorly the fallback is accepting the title as
  contrast-imperfect — NOT a scrim.
- **Two pushes now coexist**, see below.
**Two pre-existing things found while building, neither changed:** Q7a overrun growth was
already implemented (`_overrunPerPerson` feeds `_barHpd`), and `overrunPushH` is a second,
ROW-WIDE push with a different cause — an op that ran long displaces its neighbours. It now
coexists with the per-op push; if they interact badly, that is the first place to look.

### END OF DAY 2026-09-18 — how the day before ended

**Everything is pushed. Nothing is running. All three lane sessions are released.** The next
step is Trey's green light on the hatched-render checkpoint, then the geometry rewrite.

| Lane | Worktree | Branch | SHA on origin |
|---|---|---|---|
| Functionality / integration | `traqs-func` | `feature/dynamic-schedule` | tip is this doc's own commit; last CODE change **`a6330e9`** (2026-09-21) |
| Visuals | `traqs-visual` | `feature/dynamic-schedule-visuals` | **`79cfc75`** |
| Verifier | `traqs-verify` | `feature/dynamic-schedule-verify` | **`e8d5ff5`** |

`feature/dynamic-schedule` already contains both other lanes — visuals merged at `2d44d4d`,
verifier at `c6322f3`. **It is the branch to run.** Every working tree was clean at shutdown and
no lane is mid-anything.

**What works in a browser right now, confirmed by Trey on 2026-09-18:** clock into an op and its
bar renders three regions — 45deg hatched grey to the worked front, flat idle grey to the cursor,
op colour beyond. Restart with `cd traqs-func && npm run dev` (that script is
`rimraf dist && netlify dev`, and the rimraf matters — netlify will otherwise serve a stale
`dist/`, which has twice produced a symptom that looked like a code bug).

**Known-absent, deliberately — do not file these as defects:**
- Tails render as plain blocks. The tail call site is handed the WHOLE bar's percentages over a
  different span, so drawing regions there would put both boundaries in the wrong place.
- The title label's contrast is wrong where it crosses grounds. It is `flex: 1` and spans all
  three regions, so no single colour is right. A halo is the agreed direction; the fallback is
  accepting imperfect contrast, NOT a scrim.
- Cross-row work only renders on the scheduled row. The worker's own row growing its own hatch
  (§3a) is geometry-rewrite work.

**Already fixed, do not go looking for it:** the `isLive` vs `reservoirOpId` mismatch is closed at
`711f190`. It is worth knowing WHY rather than just that it is done, because the same trap is
waiting elsewhere: `isLive` reads `activeJobClock.opId` (what someone is working) while
`liveBadgeFor` reads `reservoirOpId` (whose scheduled block drains) against the ROW's person, and
`deriveJobSession` only sets `reservoirOpId` when the clocked-in person is **on the op's team**.
They therefore diverge exactly in the cross-row case the model is built around. Any future code
asking "is this op being worked" must key on `opId`; anything asking "does this row's person drain
it" must key on `reservoirOpId`. The two are not interchangeable and reading like each other is
the whole problem. `9d6f023` then made `worked` emit, so a hatch survives clock-out.

#### THE ONE OPEN QUESTION, and it gates the geometry rewrite

**Is the hatch an EXTENT or a RECORD?** Currently `_barWorkedPct` is `ws.workedFraction * 100` —
worked hours over the estimate. That is an HOURS RATIO being used as a POSITION, the same class of
bug as the cursor one fixed in `11eb366`. It only looks right when work starts at the planned start
and runs continuously. On an 08:00-16:00 op clocked into at 14:00 for one hour, the ratio is 12.5%
so the hatch is drawn across 08:00-09:00 — reporting work in a window where nobody was working, and
making an idle region before the hatch impossible to draw.

The spec argues for RECORD in three places: §1 defines hatched as "clocked in against **this
span**", §3a says the row "grows hatched **from the cursor leftward**", and §3d justifies deleting
`walkProductiveHoursBack` on the grounds that "the hatch already encodes where the work happened" —
true only under RECORD. Under EXTENT we removed the thing that placed DONE correctly and put
nothing back.

The data supports RECORD: every row in `productionhours.json` carries `clockIn`, `clockOut`,
`opId` and `personId`, so actual worked spans are recoverable per op and per person.

Costs, established with both lanes before shutdown. **Rendering is cheap either way** — the layered
background technique does not care how many spans there are; a record reading is more pairs of hard
stops in the same gradient list, still one CSS property, still no child elements, so the fill
signature goes from a scalar to a list and nothing structural moves. **The expensive half is
verification**: "no hatch right of the worked front" is one boundary, while "no hatch outside any
recorded span" is a stronger check with several edges to get wrong. Do not pick EXTENT to spare the
visuals lane; that is not where the cost is.

#### Rebuilding this environment elsewhere

    git clone https://github.com/treysenparkinson/traqs.git traqs && cd traqs
    git worktree add ../traqs-func   feature/dynamic-schedule
    git worktree add ../traqs-visual feature/dynamic-schedule-visuals
    git worktree add ../traqs-verify feature/dynamic-schedule-verify

`tools/` is fully tracked — `diag-session.mjs`, `diag-teams.mjs`, `diag-findop.mjs` and
`repair-op-hours.mjs` all come down with the clone, nothing to recreate. **`tools/verify/` is now
tracked too** (`e8d5ff5` on the verifier branch): `shot.mjs`, `probe-done-badge.mjs`,
`probe-badge-css.mjs`. `shot.mjs` matters most — it is the only way into the app for DOM
inspection, and it existed as a single untracked file on one machine with no backup. No
credentials are in it: the authenticated browser profile lives outside the repo at
`~/.traqs-verify-profile`, overridable with `TRAQS_VERIFY_PROFILE`, and only the path is in the
file. Its Chrome location is hardcoded for Windows and needs editing elsewhere.

**A trap that outlived its cause:** `.git/info/exclude` still lists `tools/verify/`. It was
force-added rather than un-excluded, deliberately — that file lives in the shared git dir and every
worktree reads it, so removing the line would have changed what the other two lanes saw with no
warning. Tracked files ignore exclude rules, so the line is inert for what exists today, **but any
NEW file added under `tools/verify/` will be silently ignored.** The other excluded path, `shots/`,
is disposable PNGs. Neither exclusion survives a clone, so on a fresh machine both will simply
show as untracked. `.env` / `.env.local` are not in the repo either and have to be copied by hand.

**`INTEGRATION-RECOVERY.patch` in `traqs-verify` is a leftover, not lost work — safe to delete.**
34KB, untracked, dated 2026-09-17, present in every `git status` since before the lanes started,
and nobody could account for it. Established at shutdown: it is a two-file diff whose base blob
for `timeclock.js` dates to `cb03271` ("schedule: lunch/pause session accounting"), and it applies
in NEITHER direction against the current tree because both files moved a long way past it. Its
distinctive content is already in the branch — the `pausedMsAtCheckpoint` handling it adds to
`updateJobSession` is live at `netlify/functions/timeclock.js:1206` and `:1230`. So it was applied
or superseded and the file is an artifact of how it got there.

Android builds on Windows, which is not obvious because `java` is not on PATH:

    export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
    export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"
    cd traqs-android && ./gradlew compileDebugKotlin --console=plain

Do NOT pipe that through `tail` — a pipeline reports the LAST command's status, so a failed build
exits 0 and reads as success. Redirect to a file and check `$?`.

---

*The paragraph below is from earlier in the day and its SHAs are superseded by the table above.*

Branch tip: **`c2b2ad1`** on `feature/dynamic-schedule`. **Pushed through `25aa00b` only** —
`a78e91d`, `1480894` and `c2b2ad1` are LOCAL, origin is 3 behind. Nothing merged to
master. PR #1/#2 do not contain any of this.

Three worktrees, all synced to `c2b2ad1`:

| Worktree | Branch | Owns |
|---|---|---|
| `C:/Users/treysen/traqs-func` | `feature/dynamic-schedule` | geometry, session logic, `timeclock.js` |
| `C:/Users/treysen/traqs-visual` | `…-visuals` | live bar + drain mask appearance, session states |
| `C:/Users/treysen/traqs-verify` | `…-verify` | integration + QA; serves the merged build on **8888** |

`a78e91d` carries the collapse behaviour, the continuous left-edge glide, the clock-in
teleport guard, and the DONE state (planned-position restore on approve + hatched fill +
badge).

> `tzf8ivwbh` was repaired in S3 on 2026-09-17 — its block had been destroyed by the
> teleport bug (`startHour === endHour === 15.5333`) and was rebuilt from its own `hpd`
> to **10:08 → 17:00**. **The repair is LIVE DATA that no commit records.** It exists only
> in `orgs/MTX2026TRAQS/tasks.json`. S3 versioning is enabled, so restoring that object
> from an earlier version silently undoes it and the op goes back to zero width, where the
> next clock-in starts shoving it right again. `tools/repair-op-hours.mjs <opId> --apply`
> re-applies it; run without `--apply` first for a dry run.

### Bug 1 — native clock-ins built no session. FIXED 2026-09-18 (server-side derivation)

**The kiosk diagnosis in the previous revision of this doc was wrong.** Corrected:

iOS (`APIService.swift:598`) and Android (`ApiService.kt:146`) both call the `jobClockIn`
action correctly but post **only the seven job fields** — no `sessionId`, no
`reservoirOpId`, no `sessionSnapshot`. The server stores those only when sent
(`timeclock.js`, conditional spreads), so a phone clock-in produced the 7-key
`activeJobClock` with `drainCheckpoint` **absent**, and the whole feature — live bar,
reservoir drain, cascade — silently did nothing for that worker.

What sent the earlier diagnosis wrong: `activeClockIn.source` read `"kiosk"` on the
affected record, but **that field is the PAY clock's source** (`timeclock.js` `clockIn` /
`payClockIn`). It says nothing about which client made the *job* clock-in. The
absent-vs-null reasoning was sound; the inference from `source` was not.

**Fix:** `jobClockIn` now derives all three fields when the client sends none
(`deriveJobSession`, module scope in `timeclock.js`). Chosen over porting the logic into
Swift and Kotlin because the server has the same data, it needs no native build, and every
future client gets a session for free — extending the principle `drainCheckpoint` already
followed. A client that DOES send them stays authoritative.

Note the asymmetry, and do not collapse it: **absent `reservoirOpId` means "derive";
explicit `null` means a team check ran and said no.** Since this fix, a stored
`reservoirOpId: null` is a decision, not a gap.

Not covered by this fix: the **initial teleport** (`runClockCascade(..., isInitial=true)`,
`TRAQS.jsx`) still only runs in the web clock-in handler. A server-derived session gets the
live bar, the drain mask and the cascade — the 5s tick iterates *all* people with an
`activeJobClock`, so any open web client drives them — but not the teleport-to-clock-in
when the op is scheduled elsewhere. Separate, smaller fix.

**Also fixed in the same pass** (both `TRAQS.jsx`, both missed by `f31ccd2`):
`computeCascadePushes` and `buildSessionSnapshot` compared teams with
`(op.team || []).includes(String(personId))`, which coerces only the *needle* — a team
stored as `[5]` never matches. In `computeCascadePushes` that empties the candidate list,
so **no cascade runs at all**; in `buildSessionSnapshot` it empties the snapshot, so
**revert-on-deny silently restores nothing**. Both now use `onTeam`.

`tools/diag-session.mjs` collapsed absent and null through `?? null` in its verdict and so
reported "REAL BUG" on any record that simply had no session. Corrected, and taught the
post-derivation semantics.

### Bug 2 — DONE badge spacing. UNRESOLVED, not reproducible from any committed state

Reported as "DONEDevelopement" / "DONEPhase 1" — no gap between badge and label.
**Three sessions, four independent routes, agree the committed source is clean:**

- The badge is a **pure addition** in `a78e91d` (`+` lines, no `-` counterpart at either
  site) and has never been committed without `marginRight: 6`.
  `git log --all -S` over the badge markup returns nothing else.
- Measured verbatim in real Chrome: **6.00px** day mode, **18.00px** week/month
  (`marginRight: 6` plus the label's `paddingLeft: 12`).
- Badge is a **direct child** of the `display: flex` bar at both sites (the resize-handle
  div opens and closes before it); React conditionals and fragments emit no DOM nodes, so
  no wrapper can appear at runtime that isn't in the JSX.
- A stale *artifact* renders **no badge at all**, not a glued one — `traqs-visual/dist`
  (built 11:04, before the badge existed) contains zero DONE bar badges.
- The LIVE/HELD/LUNCH badges carry no `marginRight`, but are **not** a defect: `liveBarStyle`
  puts `gap: bare ? 0 : 6` on the container with `bare = widthPx < 44`, and the badges
  render only behind `_livePx >= LIVE_BAR_LABEL_MIN_PX`, which **is the same 44**. One value
  feeds both, so they cannot drift apart and the badge cannot render while bare.

**The distinction that cost the time, worth reading before re-opening this:** "stale build"
was read as a stale *artifact*, and that was eliminated thoroughly. The live case is a
**live dev server compiling an unfinished working tree** — `netlify dev` proxies to vite,
which compiles from disk. That leaves no artifact and `git -S` structurally cannot see it.
Two different failure modes sharing one name. There is an uncommitted window of 5h40m
between `25aa00b` (11:22) and `a78e91d` (17:02) on the day the badge was authored, which
none of the closures above reaches into.

That hypothesis is **falsifiable from the screenshot alone**, because the week/month
label's `paddingLeft: 12` dates to `ddc4ca9` (2026-04-10), four months before the window:

| If the intermediate lacked `marginRight: 6` | day mode | week/month |
|---|---|---|
| resulting gap | **0px — glued** | **12px — still separated** |

So **which view decides it**. Glued in day mode ⇒ the window explains it, nothing to fix.
Glued in week/month ⇒ the window is out, and every suspect is dead — a genuinely open
defect. Deferred pending a fresh hard-refreshed capture; **do not change badge code** until
then.


### THE THREE-REGION MODEL — SPEC OF RECORD (added 2026-09-18)

**Provenance.** Reconstructed 2026-09-18 after the orchestrating session was lost. Authority is
Trey's own wording of the model plus the rulings below. Q1 and Q4 were settled in the lost session
and could not be recovered verbatim — they were **re-derived from principles** on 2026-09-18 and
approved. Treat them as sound but newer than the rest.

**How to read the refs below — symbols are the anchor, line numbers are a hint.** Every line
number here was verified at `7b84676` and is valid only there. The lanes do not share a checkout:
the Verifier's tree runs roughly 60 lines short of these through the session block, and a stale
worktree has already produced two wrong readings in one day (see §5, `isCollapsedReservoir`).
**Re-derive every anchor by symbol name at execution time and cite your own line numbers.** A bare
line number in this document is never evidence about the branch.

#### 1. The invariant

One bar per op per row. A vertical cursor (now) divides every bar:

- **LEFT of cursor — grey only.** Worked or DONE. Never colored.
- **RIGHT of cursor — unworked only.** Active color or scheduled color. Never grey.

Grey carries two textures, and DONE is a third state:

| State | Fill | Meaning |
|---|---|---|
| Actively worked | HATCHED grey | Someone is/was clocked in against this span |
| Idle | FLAT grey | Elapsed but not worked |
| DONE (approved) | SOLID grey, DONE badge | Completed and approved |

The idle region is not special-cased. It is the gap the ordinary push (Q2/Q3) opens after
clock-out: the cursor keeps advancing, the colored remainder is pushed right, and flat grey is
what is left between the hatched region and the pushed remainder.

#### 1b. THE STATE MACHINE OF RECORD — state to treatment

§1 above gives the visual channels and §6d lists the state values; this is the table that
connects them, and its absence is why a screenshot could not be read against the spec. **Six
state values reach the fill.** Everything else people describe as "a state" is a geometry
variation of one of them, which is why the list of situations is longer than the list of
states.

| Situation | `data-state` | Fill treatment |
|---|---|---|
| Not started, dated in the future | `scheduled` | **Plain colour.** Cursor is negative, clamps to 0, early return |
| Not started, today, cursor before its start | `scheduled` | **Plain colour**, same path |
| Not started, cursor INSIDE its window | `scheduled` | **The bar MOVES** — its start slides to the cursor and the row cascades behind it |
| Not started, cursor past its end | `scheduled` | **The bar MOVES** to the cursor. No badge: nothing is stuck |
| Not started but LOCKED, cursor past its end | `scheduled` | **All idle grey, plus the OWED pill.** Pinned, so the hours have nowhere else to be read |
| Partially worked, cursor past its end | `worked` | Hatch where the work happened, idle after it, **plus the OWED pill** for the remainder |
| Actively worked | `running` | Hatch on the worked spans, idle in the gaps, colour past the cursor |
| HELD (finish requested) | `held` | The same three regions, plus the HELD badge |
| On lunch or paused | `paused` | The same three regions, plus the LUNCH badge |
| Clocked out mid-work | `worked` | As `running`; only the worked front stops moving |
| Worked to estimate, not yet submitted | `worked` | All hatch, **no badge** — see the post-ship filing |
| DONE, approved | `done` | Solid `spentBarFill`, DONE badge |
| PTO | `pto` | White 135° hatch over the bar colour |
| Locked segment after an admin split | `worked` | All hatch. `locked` blocks the drag; it does not change the fill |
| Unworked remainder after an admin split | `scheduled` | Whichever of the four `scheduled` rows applies to its dates |

Two things that are NOT states and are regularly mistaken for them:

- **A dashed outline is a continuation TAIL**, not a status. A bar spanning a weekend or a
  holiday renders as a head plus one dashed tail per later run of working days. It predates
  all of this work (`be6a969`).
- **Every element measures against ITS OWN window.** The head covers only the first run of
  working days and the tails cover theirs, so each gets its own spans and cursor. Handing an
  element the whole op's percentages applies them to a width that is not the op — which drew a
  head 40% grey and 60% coloured inside a week that was entirely behind the cursor. The bar
  root reports both: `data-divider-pct` / `data-worked-spans` describe the OP, and
  `data-seg-divider-pct` / `data-seg-worked-spans` describe what that element actually paints.
  An all-grey check wants the second pair; a question about the op wants the first.

#### 2. The rulings

**Q1 — write cadence: persist only at write events.** Clock-in, lunch, pause, drag, clock-out,
approve, day-boundary. **Never per-tick.** Between stored anchors the bar is interpolated at
render time. This matches Q3's cadence bound and every piece of existing session infrastructure.
Already implemented — see the bake-site comment above `shrunkStartH`'s persist path, which also
states the invariant that the caller MUST advance `drainCheckpoint` in the same write.

**Q2 — push scope is PER OP.** Not row-wide, not org-wide. Push is a property of untouched work
on that specific op. Clocking into A says nothing about B. B keeps being pushed because no one is
clocked into B, so a drag error on A never strands B.

**Q3 — retroactive push is SCOPED to ops ending today or later**, with a write cadence of at most
once per op per day boundary. Ops ending before today are locked historical: no push, no
retroactive shifts. This is a documented exclusion zone — the invariant applies to the active
horizon only, and we do not claim it holds for historical data.

**Q4 — drag during active work is not a separate ruling.** It is fully covered by Q2 plus §3c: if
someone is clocked in, the drag raises the error dialog. Recorded here only so a future reader
does not go looking for a missing Q4.

**Q5 — two separable greys plus stripes.** Reuse the existing thresholds, do not invent new ones:
`_thinBar` (`_renderPx < 16`), the border-drop threshold (`_renderPx < 8`), and `_tailPx < 8` on
the tail. **`_thinBar` (< 16) is the texture floor** — below it, fall back to a value step rather
than texture. A 4px/8px period shows about two stripes at 16px and one at 8px, so texture stops
carrying meaning at 16, not 8.

**Q6 — "shrinking" is superseded by "divider advancing."** Same behavior, cleaner model. One bar
per row, no duplicates. Two DONE bars for one worker appear only on an actual split (§3c).

**Q7a — the bar GROWS on overrun.** Hatched keeps growing rightward past planned end; the bar's
right edge extends past the planned window. Truthful width, unambiguous error signal.

**Q7b — one bound for both growth paths: freeze at end of working day**, and flag the session
unclosed. Covers overrun (still clocked in past shop close) and abandoned-op push (job left
untouched into the next day). The unclosed flag is the admin's next-morning resolve queue.
`payPeriodHourCap` (80h) is far too loose and lets forgotten-weekend cases slip.

**Q8 — HELD hours freeze, forced.** Treat `frozenAtMs` like `pausedAt` in the shared live-hours
computation. Consolidated with item 11 — see §7.

#### 3. Scenarios

**3a. Cross-row work.** Trey clocks in on Caleb's scheduled job. Trey's row grows hatched from
the cursor leftward. On Caleb's row the divider advances across the job's bar. Team is unchanged.
On finish: Trey's hatched region becomes DONE in place on his row, and Caleb's row goes empty —
his reservoir is fully consumed. (Zero-width guard applies, §6b.)

**3b. Overrun.** Cursor advances past planned end, hatched keeps growing rightward, right edge
extends past planned end. No clamp until end of working day (Q7b).

**3c. Split — admin drag only, and only when NO ONE is clocked in.**

- Someone clocked in → error dialog, verbatim: *"Someone is currently working on this. They must
  be clocked out before you can edit this."*
- Nobody clocked in and the bar has a hatched portion → the drag splits it. Hatched locks in place
  on the original worker's row; the colored remainder becomes a new op record, movable to any
  day/person.
- **Remainders are themselves splittable.** Recursive splits are expected: each split yields one
  locked historical op record plus one active remainder, and the chain is the trail of who worked
  what and when. The only guard is the one above — never split a bar someone is clocked into.
- No auto-split on clock-out. The one edge case is the cursor about to violate "left of cursor =
  grey only," and that resolves by the ordinary Q3 push, leaving a flat idle gap.

**3d. DONE placement — no reposition, ever.** The DONE bar occupies the hatched extent already
drawn on the worker's row. Same position the hatched region held; only the texture changes,
hatched → solid grey plus the DONE badge. The hatch already encodes where the work happened, so
no backward walk over productive hours is needed or wanted (see §5).

#### 4. KEEP — verified present on the lane

- Server-side session derivation (`deriveJobSession` in `jobClockIn`)
- `sessionId`, `drainCheckpoint`, `sessionElapsedMs`, `pausedMsAtCheckpoint` infrastructure
- `sessionSnapshot` for revert-on-deny
- Session-ID guard on approve — admin drags mid-session stay preserved
- Full drag cascade path (`previewPush` + `applyPushes`)
- Team-check gate on `reservoirOpId`
- Green pulsing dot on the person's row (clocked-in indicator)
- HELD / LUNCH badge rendering (`liveBadgeFor`)
- The DONE styling helper (`spentBarFill` / `SPENT_MUTE_RATIO` / `DONE_MUTE`) — reuse for DONE
  state ONLY, and do not retune it; DONE's value is fixed for this pass

#### 5. REMOVE — with corrections

- **Shrink-from-left rendering** (`shrunkStartH` and its consumers): left edge advancing with the
  cursor while the right edge stays at planned end.
- **`walkProductiveHoursBack` / DONE reposition-to-cursor.** The Verifier lane's two most recent
  commits (`5bbf257`, `35b541d`) implemented precisely this. **Reverted 2026-09-18** by explicit
  decision; that lane restarts from the pre-rewrite state rather than building on removed code.
- **The "5-min overrun clamp"** (`SHRINK_MIN_REMAINDER_H`). *Correction:* it is `5/60` — five
  minutes of *bar width*, not of time. Its comment marks it **structural, not cosmetic**: "A
  zero-width block inverts on the next write and that is the corruption that destroyed tzf8ivwbh
  once already." The visual floor goes away with shrink-from-left; the corruption guard does not.
  See §6b.
- **`isCollapsedReservoir` — ALREADY COMPLETE, no action.** Added by `a78e91d`, removed by
  `c0192b4` ("one bar per op, shrinking from the left"); both are ancestors of `ac75f9f`, and the
  tip has zero hits. An earlier draft of this spec claimed it survived on the visuals lane — that
  was a **stale-checkout misreading**: `traqs-visual` sits nine commits back at `c2b2ad1`, where
  the symbol still exists. Fast-forward the worktree; remove nothing.

#### 6. Carry-forward guards

**6a. The hatch must be COLOR-TINTED, never flat black.** The hatch was retired deliberately — see
the `WORKED_STRIPE` retirement comment and the `spentBarFill` comment block ("flat-black hatch
(rgba(0,0,0,0.28)/0.14) that read as grime on every light ladder"). Reinstating it as-was
reintroduces that defect across the four theme ladders. Base it on the tinted row-background
pattern used for PTO/off-days (`repeating-linear-gradient(135deg, ...)` at low alpha off the bar
colour), **but change a geometry knob** — angle or period — so worked stripes never read as the
in-bar PTO hatch, which is white at a 6px/12px period and will appear on the same screen. After
this change "hatched" alone is no longer a unique signifier; ground colour plus stripe geometry
together must carry it. **Settled: 45deg**, chosen over a period change because all five existing
hatches in the file are 135deg, and because between the texture floor and ~24px only two or three
stripes render, where 4/8 versus 6/12 is nearly indistinguishable but a direction flip is instant.

**Correction, 2026-09-18 — "tinted at low alpha" taken literally produces an invisible hatch.**
The idle ground already carries ~12% of the bar's own hue, so a stripe of the raw bar colour over
it is a hue match with only a small luminance shift: measured at **2.8 L\*** on the worst job
colours. It disappears PER COLOUR, so it would have looked correct on whichever job happened to be
tested — the same failure mode as the flat-black grime this guard was written about, which also
looked fine on the ladder it was tested on. **Step the stripe in VALUE before tinting** so the
delta is independent of hue, at the lowest alpha that clears 10 L\* everywhere: measured 10.5 at
worst, 16.6 at best, tight across all four ladders. Still tinted, still the bar's own hue; only
the value is pushed first.

**The idle grey's two bounds, and the values that satisfy them.** Idle must sit far enough from
DONE to separate and far enough from the row ground to still read as a bar — if it lands too close
to the ground, the bar appears to END at the worked front and the pushed remainder reads as a
detached block, which is the DONE washout failure reappearing one region over. Measured in CIE L\*
across all ten job colours and all four ladders: **idle-to-row 13.1** at worst, **idle-to-DONE
19.8** at worst, both clearing ~10 where a boundary stops being comfortable. The sub-floor value
step measures 11.1 and is deliberately HARDER than the hatch, not softer: that region is a few
pixels tall, so it needs more separation than a full-height bar, not less.

Polarity comes from `wantsLightText(T.surface)`, not `T.colorScheme` — they disagree on custom
themes, which is what the warning above `spentBarFill` is there for.

**And the ordering is by PRESENCE, not luminance.** "Lighter, closer to background" was written
from the light ladder and inverts in dark, where closer to the row ground means darker; taken
literally it would make idle the brightest thing on the row in two of the four ladders. The
binding form: **idle sits nearest the row ground in each theme, DONE sits furthest from it.**

**6b. Zero-width remainder must be an explicit empty state, never a written zero-width block.**
§3a ends with Caleb's row going empty — exactly the fully-consumed-remainder case the
`SHRINK_MIN_REMAINDER_H` comment warns about. Removing the visual floor is correct; writing a
zero-width or inverted block to S3 is what destroyed `tzf8ivwbh`. The record is **deleted
outright** when the remainder reaches zero — not zeroed, not sentinel-valued. Where the work moved
to another row, that row's DONE record is the historical truth. Visually the bar disappears on
delete, with no animation, matching the rest of the schedule.

**6c. `deriveWorkedState` already supports Q7a.** `overrunFraction` exists so the bar "can keep
growing rather than silently pinning at 100%." Do not confuse it with `pctBarWidth` ("Bars stop at
full"), which clamps percentage bars elsewhere and is out of scope.

**6d. The render/verify interface.** The bar root emits `data-worked-pct`, `data-divider-pct`,
`data-raw-worked-pct`, `data-worked-h`, `data-committed-h`, `data-live-h` and `data-state`.

**`data-divider-pct` is the CURSOR — wall-clock now as a fraction of the op's planned span, and
UNCLAMPED**, so past 100 means now is past the planned end, which is the overrun condition in time
terms. It is not an hours ratio. The first cut of this interface emitted `rawFraction` (worked
hours over the estimate) under that name, and the two diverge on any late start or lunch: an
08:00-16:00 op worked one hour by 15:00 puts the cursor at 87.5% and the ratio at 12.5%. That
75-point gap is the divergence this whole model exists to show. Worse, `workedFraction` is
`Math.min(1, rawFraction)`, so the two emitted percentages were one quantity at two clamp levels
and "the worked front never passes the cursor" could not fail. The hours ratio survives as
`data-raw-worked-pct`, which is what it always was. `activeBarFill` takes the cursor as its
`dividerPct` — never pass it a ratio. Functionality
owns and emits them; Visuals stays geometry-neutral; Verifier asserts against them. These values
must stay accurate **below the texture floor**, where the hatch is not drawn — otherwise the
invariant "no hatch right of the worked front" silently stops testing on exactly the dense bars
where errors hide. Fills are composed by a single helper, `activeBarFill(T, bc, W, C, state,
renderPx)`, so the two lanes never edit the same line.

`data-state` carries seven values: `pto | done | held | paused | running | worked | scheduled`.
**`worked` means nobody is clocked in but the bar owns a locked hatched region** (§3a, §3d), and
`scheduled` therefore narrows to genuinely untouched. Without that split the two are
indistinguishable and a hatch cannot survive clock-out, which §3d requires it to.

**Segments get their own numbers.** A continuation tail covers a different span from its parent
bar, so it must never be handed the parent's `workedPct`/`dividerPct` — both boundaries would land
in the wrong place. Until per-segment values exist, a tail renders as a plain block.

#### 7. Sequencing

> **SCOPE, RESET 2026-09-18 — WEB ONLY THIS PASS.** This section is paused after the web half.
> It exists to stop the geometry rewrite creating a fourth live-hours variant, and the web helper
> plus the web `frozenAtMs` commit achieve that. **iOS and Android migration are follow-up work and
> do not block anything.** They were allowed to become the critical path for the feature they were
> only meant to unblock — a preexisting defect class outranking the thing actually being built.
> The priority is the fastest path to a three-region schedule testable in a browser. Anything past
> the web half needs explicit sign-off, not "while we're here" reasoning.

**Item 8+11 — one fix, not two.** A dozen-plus live-hours computations across three platforms in
three variants (guarded open pause / unguarded / no open-pause term), none with a `frozenAtMs`
branch.

**What the variants actually cost, established by executable diff on 2026-09-18 rather than by
reading.** Variant B has THREE defects, not the two recorded here before: no `Math.max(0, …)`
floor, so a future `pausedAt` ADDS time; no validity check on `pausedAt`, so an unparseable value
renders **NaN** rather than degrading to the unpaused number; and the latent one below. Variant C
keeps counting through lunch. And **every** variant carried a 56-year bug: `new Date(null)`
`.getTime()` is `0`, not `NaN`, so `Number.isFinite` passes and a missing `clockIn` reads as
elapsed-since-1970. All three shapes had it, and all three survived only because each caller
guarded first. **A shared helper called from 17 sites cannot inherit its callers' guards** — it
must reject a falsy `clockIn` before parsing. The first draft of the helper had the hole too; the
test caught it, reading did not.

**Both of those are WEB-ONLY, established by porting the grid to the native variants.** Do not
carry either fix across:

- The native B variants already guard their `pausedAt` parse (`if let` on iOS, `?.let` on Android),
  so **the NaN defect does not exist on iOS or Android**. The obvious assumption — that a defect
  found in one platform's copy of an algorithm exists in the others — is wrong here.
- `clockIn` is a **non-optional String** on both native platforms and both parsers return nil on a
  bad value, so the falsy-`clockIn` path cannot be reached there at all. Porting the guard would be
  cargo cult: a branch that cannot execute, justified by a bug from another language's type system.

The general rule this is an instance of: a shared algorithm across three platforms does not imply
shared defects, because the defects come from the type systems and parsers around it rather than
from the algorithm. Establish per-platform rather than porting a finding. Both of these came out of
the grid diff and neither came out of review.

**The guard is per-language and says which languages it covers.** It reads both JS and Kotlin
arithmetic shapes (`?:` is Kotlin's elvis, `0.0` its Double literal) and was proven RED against the
pre-migration Kotlin — exactly four sites, no more, no fewer — before going green. Swift is
**explicitly not scanned** rather than silently skipped, because Swift cannot be built on every
machine this runs on, and a check that quietly covers two platforms while reading as though it
covers three is the failure this whole section is about. **Re-enumerate the sites at execution time rather than trusting a count.** The census run on
2026-09-18 found **17**, not thirteen: 5 web, 8 iOS (including the helper itself), 4 Android. A site using
`curPausedMs` was found uncatalogued after the first census, so "thirteen" is a floor, not a fact.
Land a shared `liveElapsedHours({ clockIn, pausedAt, frozenAtMs, totalPausedMs, now })` in
`statsMath.js` (pure, natural home), migrate every site, add the Android equivalent, and add a
build-time check that no live-hours math exists outside the helper. The argument is an OBJECT:
`totalPausedMs` and the millisecond values beside it are adjacent same-typed numbers, which is
how a transposed argument gets written and never noticed. `now` is injectable so the frozen and
future-`pausedAt` cases are table tests rather than wall-clock races. `pausedMsAtCheckpoint` is
deliberately NOT a parameter — it serves only the two excluded sites, which need a different
origin anyway, so it would be dead weight at every call site that does pass it.

**iOS: FIX THE HELPER BEFORE MIGRATING ONTO IT.** An earlier draft said to migrate the iOS sites
that "route around" `HoursCalculator.liveElapsedHours` — that instruction would have caused a
regression and is withdrawn. The helper takes `(clockIn:totalPausedMs:now:)`, has no `pausedAt`
parameter and no open-pause term: **it is variant C itself.** Four of the sites bypassing it
(`MoreView` x3, `TasksView`) handle the open pause and are therefore MORE correct than the helper;
migrating them onto it would delete working behaviour. Only the genuinely-inline C site improves.
Fix the helper first, then migrate — the same order as web.

Fix its doc comment in the same commit. It claims the helper "returns 0 for a clock that ... is
currently paused out", which it has no way to detect. That sentence is how four separate readers
concluded it was complete and wrote their own instead. The lesson is not that helpers get ignored
— it is that an INSUFFICIENT helper gets routed around and nothing detects the divergence, which
is precisely what the build-time check exists to catch. **That check must be confirmed RED on the
pre-migration tree** — a guard nobody has seen fail is not evidence. That rule paid for itself
immediately: the check's first draft stripped string literals before scanning, a quote-matching
regex derailed on 32k lines of JSX (regex literals, apostrophes in prose, nested templates) and
blanked whole regions. It missed 3 of 9 real occurrences **including the variant-C site the check
exists to catch**, and still printed a confident count and exited 0 on the migrated tree. Only the
RED run exposed it. The fix is to not strip strings at all — comments are the only real
false-positive source, and arithmetic on the field inside a string is not a real shape.

Two more things reading does not catch, both worth budgeting for in the remaining platforms. The
unit test must reproduce A, B and C **verbatim** and diff the helper against each across a grid,
asserting A identical everywhere and B/C differing only on their intended cases — that is what
turns "behaviour unchanged" from an assurance into an artifact. And migrating a site can orphan a
binding its neighbours still use: removing a `const` twenty lines above a surviving reference
leaves a free identifier that **bundlers do not flag**, so the build passes green and the modal
throws on open. That is the same class `scripts/check-function-imports.mjs` exists for.

Split across two commits so each has its own verification point: (1) land the helper and migrate
every site with behaviour unchanged, since nothing has `frozenAtMs` set at that moment; (2) add the
`frozenAtMs` handling. **The helper lands FIRST, before the geometry rewrite**, so new session math
calls it rather than becoming a fourth variant; the migration of existing sites follows the
geometry work.

Two things shift the estimate favourably: the web freeze path is already partly built (frozen
clocks are filtered from `active`, `updateJobSession` is the authorized write path, `liveBadgeFor`
returns `"held"`, and `shrunkStartH` already reads `frozenAtMs || Date.now()`). And
`sessionElapsedMs` and the drag-rebaseline `pausedNow` baseline on `pausedMsAtCheckpoint`
deliberately — they are NOT copies, do not sweep them in.

**Deferred to their own pass, non-blocking:** item 9 (`actualHours ~ 0` from the `jobRefs` join
gap) and item 10 (`applyWorked` swallows downward corrections).

### PROCESS RULE — RED-FIRST VERIFICATION (adopted 2026-09-18, applies beyond this feature)

**A check is not evidence until it has been seen to fail.** Any guard, lint, assertion or test
written anywhere in this codebase must be demonstrated RED against a tree that genuinely violates
it, before its green run is allowed to mean anything. Not a preference for the schedule work — the
standard going forward.

Adopted after four instances of one failure shape in a single day, across every lane:

- **The live-hours build check.** Its first draft stripped string literals before scanning; the
  quote-matching regex derailed on 32k lines of JSX and blanked whole regions. It missed 3 of 9
  real occurrences — **including the variant-C site the check exists to catch** — and still printed
  a confident count and exited 0 on the migrated tree. Only the RED run exposed it.
- **The worked hatch.** "Tinted from the bar colour at low alpha" measured 2.8 L\* against a ground
  already carrying the same hue. Invisible, and invisible PER COLOUR, so it would have looked
  correct on whichever job happened to be tested.
- **`HoursCalculator.liveElapsedHours`.** Its doc comment claimed it returns 0 for a clock "currently
  paused out", which it has no parameter to detect. Four separate readers concluded it was complete
  and wrote their own instead.
- **A doc comment that drifted off its subject.** New helpers were inserted between `activeBarFill`'s
  contract comment and `activeBarFill`, leaving the comment sitting ~75 lines above the function it
  describes and directly above a different one. Nothing broke, the build was green, and the prose
  still read as correct — it had simply come to describe the wrong thing. **No tool can catch this
  one at all**, which is why it belongs on the list: the only control is reading the diff before
  committing instead of treating a green build as evidence the change was right.

Each reported success on work that was not there. A tool, a pixel and a sentence, failing the same
way. The corollary is that "it passes" and "the diff looks deliberate" are not findings — a wrong
call that produces plausible output is the expensive case, because nothing marks it for review.

Two companion practices, both earned the same day: reproduce the shapes you claim to preserve and
**diff against them** rather than asserting equivalence by reading; and remember the build is not a
reference checker — an orphaned binding is a free identifier that bundlers do not flag, so it ships
green and throws at runtime.
### Deferred, by explicit decision

#### Filed 2026-09-21 — post-ship, do not design for these now

- **"Hours complete, awaiting approval" has no signal.** An op worked to (or past) its
  estimate and not yet submitted for completion owes nothing, so no owed badge, and is not
  Finished, so no DONE badge — an all-grey bar with no label. It is the normal state of every
  op between clock-out and approval, so it is common rather than exotic. It is deliberately
  allowed by the never-bare-grey invariant because TEXTURE distinguishes it: all hatch against
  DONE's flat. **Trey's ruling: leave it.** If admins report confusion in real use, add a
  badge; otherwise it stays as it is.
- **`pushedBarRange` is dead code and is not a drop-in for what ships.** It returns a RANGE and
  moves the remainder to the cursor; the running `_pushIdleH` returns extra HOURS, flows into
  `_barHpd` -> `_wBudget` -> width, and never touches the bar's left edge. So the shipped push
  can only LENGTHEN a bar, never translate one — which is why no push setting can satisfy §1
  for an op whose window has entirely passed, and why greying was the available answer rather
  than the preferred one. Reconciling them is a geometry rewrite (option 3, deferred), not a
  substitution.

#### LESSONS — patterns that produced real defects in this feature

- **If you delete a defensive comment, its guard has to survive somehow.** Twice in one day a
  comment was removed and the thing it defended against came straight back. The push comment
  said "a year-old op nobody finished would grow a year of idle and swamp the view"; it was
  deleted with the code it described, the horizon went with it, and 504 past-due ops piled
  onto today and pushed rows months off-screen. A comment explaining why a condition exists is
  part of the condition.
- **A guard that reads as two tests may be one test twice.** `status === "Finished" ||
  isFullyWorked` looked like belt and braces; `isFullyWorked` IS that status, so the second
  clause excluded nothing while implying an hours check that did not exist.
- **Every element measures against its own window.** Handing the head a whole op's percentages
  drew it 40% grey inside a week that was entirely behind the cursor.
- **A tested rule is not a shipped rule.** `pushedBarRange` had ten table tests, a red proof,
  and no call sites, while the code that actually ran had none of the three.
- **A filter on stored dates and a paint on computed ones will disagree.** Bars kept by the
  visibility filter were painted past the window's right edge, which reads as work vanishing
  rather than as work being misplaced.
- **Measure before believing a colour.** A hatch at 2.8 L\*, danger text at 1.75 against its
  ground: both looked reasonable and neither survived being measured.

#### THE INSTRUMENT GAP — permanent, and worth knowing before trusting a green run

The headed `shot.mjs` login is **permanently deferred**: a standing credential that exists
only to let a test log in is a real liability against a workflow convenience, and Trey
screenshots instead. That is a sound trade, and it fixes what the automated checks can say.

**The instrument covers data and source. Screenshots are the only instrument for paint.**
Where they diverge — a badge rendering behind another element, a hatch that does not resolve
at the rendered size, a colour that measures fine and looks cheap — the assertion passes and
the bar is still wrong. `grey-bar-labelled-test.mjs` asserts that a bar NEEDING a badge
reports the number that would feed it; it cannot assert the badge reached the DOM.

Two of this feature's four worst defects were invisible to every check we had: a hatch
measuring 2.8 L\* against its own ground, and a comment that drifted 75 lines from its
subject. Neither had a data signature.

#### Filed 2026-09-18, non-blocking, do NOT fold into the live-hours pass

**Deferred by the 2026-09-18 scope reset — after web geometry ships and has been tested:**

- **iOS helper migration.** The helper fix was written and stopped mid-flight, uncommitted: `pausedAt`
  and `frozenAtMs` added, open pause floored, the false doc comment replaced. `pausedAt` deliberately
  non-optional with no default so the compiler forces all five call sites — the Swift equivalent of
  the build check. **Not verified by anything**: no Swift toolchain exists on the Windows machine, and
  it was written by porting web semantics, which is the move the asymmetry rule above warns against.
  It needs the grid treatment AND a Mac build before it lands.
- **Android `frozenAtMs` (commit 2).** Android migration itself is done and compiled; only the freeze
  branch is outstanding. `ActiveJobClock.frozenAtMs` already exists there, so no call site is revisited.
- **The `Double?` modelling gap.** `liveElapsedHours` returns `Double`, so "zero hours" and "no clock
  at all" are indistinguishable. Two Android sites parse `clockIn` twice per tick to preserve a "—"
  fallback the `0.0` return cannot express. Decided to keep `Double`: "no clock" is knowable from the
  presence of `activeJobClock` at every call site examined. Revisit only with a reason.
- **The three-region model itself on iOS and Android.** Web first, native after it has been tested.
- **Can the callers drop their guards?** The 56-year bug (`new Date(null).getTime()` is `0`, so a
  missing `clockIn` reads as elapsed-since-1970) existed in all three variants and was survived only
  because every caller guarded first. `liveElapsedHours` now rejects a falsy `clockIn` itself, which
  makes some of those caller-side guards redundant. Removing them would make the code more coherent,
  but it is a separate pass — note redundant-looking guards while migrating, change nothing.
- **Free-identifier detection is a gap.** Migrating a site can orphan a `const` its neighbours still
  use; bundlers do not flag free identifiers, so the build passes green and the code throws at
  runtime. Caught once by reading a diff, which is not a control. The real fix is an eslint rule or
  a type-checker upgrade — the same class `scripts/check-function-imports.mjs` exists for.
#### Null-hour class — one pass, not three patches (added 2026-09-18)

These are coupled and are to be fixed TOGETHER, not opportunistically. The approve fix that
landed in the same session writes an explicit `startHour: null` when that was the pre-clock-in
value, which is correct — null is what the plan said, and `opHourRange` reads it as "full
working day" — but it does put more weight on a state the move handlers already mishandle.

- **Move-handler inversion** at `:15269` (day move) and `:11604` (gantt move). Both write
  `startHour` via `updTask` WITHOUT `endHour`, and `updTask` is a shallow merge that never
  recomputes it, so dragging a bar right past its own stored `endHour` inverts the block. This
  is what destroyed `tzf8ivwbh`. The left/right RESIZE handlers already clamp against the
  opposite edge correctly — the fix is to do the same at these two call sites.
- **Defensive normalisation at the write site:** if `endHour < startHour`, or `startHour` is
  null where it should not be, recompute from `hpd`.
- **Is `startHour: null` ever the right stored state?** Probably not. `opHourRange`'s
  `?? workStartH` fallback is doing the work that makes null survivable, and a genuinely
  designed state should not need fallback logic to be read. Worth deciding whether null means
  "full working day" as a first-class value or is simply an absence the app has learned to
  tolerate — the answer changes what the two fixes above should write.

Do not take any of these piecemeal. They share one question.


- **Move-handler inversion source.** `updTask({ startHour })` at `:15269`
  (day-mode move) and `:11604` (gantt move) write `startHour` WITHOUT
  `endHour`, and `updTask` is a shallow merge that never recomputes it — so
  dragging a bar right past its own stored `endHour` inverts the block. This is
  what corrupted `tzf8ivwbh`. The teleport guard in `a78e91d` stops the
  *propagation*, but the inversion can still be created. Fix needs: a clamp
  against the opposite edge at both call sites (the left/right RESIZE handlers
  already do this correctly), and a decision on whether to add
  "if `endHour < startHour`, recompute from `hpd`" as defensive normalisation
  at the write site.
- **Partial completion.** Rejected as a hack into the finish-approval flow. A
  worker who does 3h of an 8h op clocks out normally; the next session picks up
  the remainder; the finish request happens only when the whole op is done.
  A real partial-completion model needs its own design pass.
- **Fix D on the shared scheduled-bar render** was originally deferred, then
  adopted — it is in `a78e91d`.

## Git / deployment state (updated 2026-09-17, treysen machine)

- **`master` is at `0574621`** ("fix: make approveCompletions and
  approveTimeOff actually mean something"). The doc previously said
  `fbdd205`; master moved 17 commits past that.
- **All three sessions' work is now committed and merged.** `origin/master`
  was merged in at `f689465`; everything sits on that merge. The branch is
  **0 behind** master.

  `feature/dynamic-schedule` (branch tip `54ee0c4`):

  | SHA | Commit |
  |---|---|
  | `f31ccd2` | id: fix numeric/string coercion in dynamic-schedule paths |
  | `cb03271` | schedule: lunch/pause session accounting |
  | `6c8adb3` | schedule: live bar geometry + sliver visibility |
  | `25d5d11` | docs: refresh dynamic-schedule handoff |
  | `54ee0c4` | **Merge** branch 'feature/dynamic-schedule-visuals' |

  `feature/dynamic-schedule-visuals` (branch tip `456da1e`):

  | SHA | Commit |
  |---|---|
  | `456da1e` | schedule: live bar and reservoir share one visual grammar |

  Commit `f31ccd2` is foundational — the reservoirOpId id comparisons it
  fixes gate the whole feature, so the rest is meaningless without it.
- **NOT PUSHED.** Everything above is local only.
  `origin/feature/dynamic-schedule` is still at `fa41485` and does not
  contain any of this. `feature/dynamic-schedule-visuals` has no remote.
- **PR #1 is stale** and deliberately left so:
  https://github.com/treysenparkinson/traqs/pull/1 — it predates the master
  merge and every commit above. A fresh PR gets raised from `54ee0c4`. The
  Netlify deploy preview attached to it
  (https://deploy-preview-1--traqs.netlify.app) is equally stale; do not
  test against it.

### How the merge went

Three sessions worked this feature in parallel worktrees on this machine:

| Worktree | Branch | Owns |
|---|---|---|
| `C:/Users/treysen/traqs-func` | `feature/dynamic-schedule` | geometry, session logic, `timeclock.js` |
| `C:/Users/treysen/traqs-visual` | `feature/dynamic-schedule-visuals` | live bar + drain mask appearance, the three session states |
| `C:/Users/treysen/traqs-verify` | `feature/dynamic-schedule-verify` | integration + QA; serves the merged build on **8888** |

Visuals extracted the style objects into helpers (`liveBarStyle`,
`drainMaskStyle`, `spentBarFill`, `spentMixRatio`) and added running /
**HELD** (`frozenAtMs`) / **LUNCH** (`pausedAt`) states.

`git merge` produced **three** conflicts, not one — the two branches edit
the same physical JSX attributes at every live-bar and mask site, one side
owning `left`/`width` and the other owning the style object. All three
resolved the same way: the visual half from the visuals branch, the
geometry and its rationale comments from this one.

| Site | Resolution |
|---|---|
| day live bar | flush, `-4px` (matches THIS view's bar), `minWidth: 2` |
| week/month live bar | flush, `-1px` (matches THIS view's bar), `minWidth: 2` |
| week/month drain mask | flush, `-1px` |

The visuals branch still carried `+ 2px` on the week/month bar and mask.
That inset was sound while the bar was anchored to the COLUMN; the geometry
revert in `6c8adb3` made it positioned by clock-in TIME, so a fixed nudge
draws it later than the moment it represents — about half an hour of
apparent offset at month zoom. The visuals author identified their side as
the stale one and asked for the flush version to win.

Day mode keeps `-4px` and week/month `-1px` **deliberately**: each mask and
bar matches the scheduled bar it overlays, and those differ between views.
Do not sweep them into agreement.

**The structural cause of these conflicts is unfixed.** Style and geometry
still occupy one JSX `style` attribute at each site, so the next round of
parallel work collides identically. See "What's NOT done yet".

## What's NOT done yet

- **Round 5 (left-anchor) was re-tested and REVERSED.** Left-anchoring made
  the bar encode a magnitude while every bar beside it encodes a position in
  time, so a 2pm clock-in drew a block over the morning. `6c8adb3` anchors the
  bar at the clock-in hour again. Do not re-apply `4718b7d`; if the sliver
  reads wrong, the proposed next step is a faint track behind the bar, not
  another change to where it sits.
- **Nothing has been seen running.** The three commits build clean but no
  session has exercised the feature: not the sliver at birth, the growth, the
  drain, the cascade, the LUNCH or HELD states, dark mode, or 400px width. All
  of it needs a human clocked into a job.
- The PR has not been merged to master, and PR #1 is stale (see above).
- No merge/regression testing beyond the one scenario being walked through
  (clock into a job scheduled for a future day/elsewhere, watch the live bar +
  reservoir + cascade).
- **Structural: style and geometry share one JSX attribute.** At each live-bar
  and mask site the `style={{...}}` attribute carries both the visual helper
  spread and the `left`/`width` values, so any two sessions touching
  appearance and geometry collide on the same physical line. This produced
  the same three conflicts every round. Hoisting geometry into the helpers,
  or splitting it onto separate attributes, would remove the collision class
  entirely. Not done — it is a refactor of live render paths that nothing has
  yet been seen running, so it wants its own round with a human watching.
- **iOS parity:** `AppState.swift:2335` and `:2378` still subtract only
  `totalPausedMs`, not an in-flight `pausedAt`, so op-progress % creeps during
  lunch and self-corrects at lunch end. Cosmetic, nothing saved wrong, needs a
  build.
- **Id drift elsewhere:** only the dynamic-schedule paths were converted to
  `sameId`/`onTeam` in `f31ccd2`. Roughly 50 sites across the rest of the app
  still compare ids raw.

## Suggested next steps (when resuming)

1. Pull `feature/dynamic-schedule` on the other machine, `npm install`
   in the worktree (or wherever it's checked out) to get `node_modules`
   (gitignored), start `netlify dev`.
2. Re-test the left-anchor fix: clock into a job scheduled for a future
   day, confirm the live bar sits flush against the left edge of
   today's column in week/month view and grows rightward, while the
   reservoir shrinks at the same rate. Also re-check day view still
   looks right (sliver at "now", growing).
3. If clean, decide whether to keep testing via the Netlify deploy
   preview (https://deploy-preview-1--traqs.netlify.app) or localhost,
   then merge PR #1 to master.
4. If any issues turn up, follow the same "diagnose first, cite exact
   line numbers, confirm the diagnosis before changing code" pattern
   used throughout this feature.
