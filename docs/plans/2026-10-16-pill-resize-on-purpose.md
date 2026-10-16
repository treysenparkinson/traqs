# Moving a pill never changes its length unless you meant it to

**Status:** Agreed, building
**Source:** [PRD](2026-10-16-pill-resize-PRD.md) (Treysen, 2026-10-16)
**Where:** `traqs-func` on `master` · **Platforms:** web only. iOS and Android don't drag-resize pills and aren't touched. · **Size:** S
**Last updated:** 2026-10-16 16:55, step 3 done

## In one breath
Grabbing a pill anywhere but a thin strip at its very end will always move it. After every
resize, a notice names the op and shows old vs. new hours and end date, with an Undo button
that reverses only that resize. Esc cancels a resize mid-drag. The thing most likely to go
wrong: short pills lose resize entirely (see D1).

## Done means
- [ ] A drag that starts in the body of a pill changes dates only. Hours and `hpd` stay the same **(said)**
- [ ] The grip is a fixed thin strip, not a share of the pill's width. Short pills have no grip **(inferred)**
- [ ] Every committed resize, in both the week/month and day views, shows a notice: op, person, old → new hours and end date, and Undo **(said)**
- [ ] Undo restores that op's dates and hours only if nothing changed it since. Otherwise the button is gone **(inferred)**
- [ ] The pill shows its new hours while you resize **(inferred)**. Already true today: the bar's hours label reads the preview ([TRAQS.jsx:16622](src/TRAQS.jsx:16622)), and a tooltip shows the edge date. Nothing to build.
- [ ] Esc mid-resize: nothing saved, no undo step **(assumed)**

## How it works today
- Each week/month pill has a left and a right grip, each `max(3, min(10, width / 3))` px wide ([TRAQS.jsx:16870](src/TRAQS.jsx:16870)). Pills under 12px get none. So a 30px pill is two-thirds grip, with a 10px middle that moves. The grip is invisible until the mouse is on the grip itself ([TRAQS.jsx:17876](src/TRAQS.jsx:17876)). The overrun "tail" has its own right grip, also a third of its width ([TRAQS.jsx:17970](src/TRAQS.jsx:17970)).
- Pressing a grip runs `handleTeamResize` ([TRAQS.jsx:17435](src/TRAQS.jsx:17435)). That opens a `resizeSession` ([dragMove.js:390](src/dragMove.js:390)): mouse moves only preview, and release runs the refusal checks and commits once. The commit goes through `applyDragMove`, which writes new dates **and a new `hpd`** (the op's total planned hours) plus a "Resized in schedule" moveLog entry, then saves. No confirm and no notice.
- The day view has its own grips, a fixed 12px ([TRAQS.jsx:16127](src/TRAQS.jsx:16127)), and its own commit in `handleTeamDayBarDrag` ([TRAQS.jsx:15813](src/TRAQS.jsx:15813)). Same silent save.
- Undo is one global stack of whole-schedule snapshots, 50 deep, this session only ([TRAQS.jsx:5283](src/TRAQS.jsx:5283)). Undoing a resize from earlier also undoes everything done after it.
- The only notice the app has is `toast()` ([TRAQS.jsx:7887](src/TRAQS.jsx:7887)): text only, 1.8s, can't be clicked. The autosave's generic "Changes saved" stands down if a specific toast spoke in the last 1.5s.
- Neither mouse handler listens for Esc.

## The approach
Pull the grip-width rule into a small pure function in [dragMove.js](src/dragMove.js), next to `resizeSession`, so a suite can pin it, and have all three week/month grips read it. Give `resizeSession` a cancel and wire Esc to it in both views. Add two pure helpers: one turns a committed resize plan into the notice's text, and one builds the reverse plan for Undo, or returns nothing if the op has changed since. Both resize commit paths then raise one new notice, a clickable cousin of the toast, whose Undo runs the reverse plan through the same `applyDragMove` + save path.

**Other ways considered:**
- Notice Undo calls the global `undo()`: it restores a whole-schedule snapshot, so a realtime edit from someone else that arrived after the resize would be wiped.
- Hold Alt to resize: the PRD parked it for later.
- Extend `toast()` with a button: every toast is click-through and 1.8s by design, and changing that touches 40+ call sites' behavior.

## Decisions

**Needs you**
- **D1.** Grips are a fixed 6px, and only pills at least 36px wide get them, so the move area is always at least two-thirds of the pill. Narrower pills are move-only. (Treysen, 2026-10-16)

**Calls I made** (veto any)
- **C1.** Grips show when hovering anywhere on the pill, not only on the grip, so you can see where the edge is before pressing. *Why:* today you can't see the grip until you're already on it.
- **C2.** The notice sits at the bottom center, stays 6s and holds while hovered (3s after the mouse leaves), and a new one replaces the old. *Why:* it never covers a toast at the top. (Changed in step 3, see Log.)
- **C3.** Undo from the notice writes its own moveLog entry ("Resize undone") rather than deleting the resize entry. *Why:* history stays append-only, the same as every other move.
- **C4.** Undo from the notice needs `moveJobs`, the same right as the resize, not `undoHistory`. *Why:* it's reversing a move you just made, not rolling back history.
- **C5.** Day-view grips keep their fixed 12px. Day-view resizes get the notice and Esc. *Why:* day-view pills are hour-scaled and wide, and the PRD's complaint is the week/month rows.
- **C6.** The finding goes into [SCHEDULE_MAP.md](SCHEDULE_MAP.md) as #550, per its rule R1.

## Steps
- [x] **1. Grips are a thin fixed strip, and the middle always moves**: [dragMove.js](src/dragMove.js), [TRAQS.jsx](src/TRAQS.jsx) (three grips), [SCHEDULE_MAP.md](SCHEDULE_MAP.md)
  *Why:* this is the accident itself, so it goes first.
  *Proof:* a new `resize-grip-test` (red first, in `npm run build`) pins the grip width and the no-grip cutoff for 10, 30, 36 and 200px, and checks the three grips read the rule. Then `npm run build` → `✓ built in`. A mutant on the cutoff fails an assertion.
- [x] **2. Esc cancels a resize with nothing written**: [dragMove.js](src/dragMove.js), both handlers in [TRAQS.jsx](src/TRAQS.jsx)
  *Why:* a cheap way out of a resize you notice mid-drag.
  *Proof:* [resize-test.mjs](scripts/resize-test.mjs) drives the real handler: three steps, Esc, release → zero writes, zero undo frames, zero saves.
- [x] **3. Every resize shows a notice with before and after**: [dragMove.js](src/dragMove.js), [TRAQS.jsx](src/TRAQS.jsx)
  *Why:* "it just does it and i dont always know." This half matters most.
  *Proof:* suite cases for the notice text: solo op, crew op (team total hours), an end date that moves. Both commit paths raise it (asserted against the source). `npm run build` passes.
- [ ] **4. Undo in the notice reverses only that resize**: [dragMove.js](src/dragMove.js), [TRAQS.jsx](src/TRAQS.jsx)
  *Why:* one click instead of Ctrl+Z through every later move.
  *Proof:* suite: unchanged op → dates and `hpd` restored exactly, plus one "Resize undone" log entry; op moved since → no reverse plan; a sibling op edited since → left alone. `npm run build` passes.
- [ ] **5. Seen working in the browser**: localhost:8888, only if your dev server is already running
  *Why:* the suites can't see hover, the grip, or the notice.
  *Proof:* screenshots: a short pill with no grip, a resize notice, the pill back to its old length after Undo.

## Won't touch / must keep working
- From the PRD: no removing resize. Moving is unchanged: snapping, reassigning by dropping on another row, multi-select and group moves. No changes to undo in general. No confirm dialog before a resize.
- From the PRD: every refusal still runs on resize (time off, a live clock on the op, overlap, the past). One resize = one save and one undo step (#31 #32). PTO bar resizing (its own path) works as today. Pills with worked hours keep their hidden left grip.
- Technical: no change to stored data shape (the moveLog entry is the existing shape). iOS and Android untouched. The global Ctrl+Z still works on a resize, and on a notice Undo.

## Risks and how I'll catch them
| Risk | How I'll catch it |
|---|---|
| A grip change makes pills harder to move (event order, `stopPropagation`) | existing `drag-move-test`, `person-row-drag-test`, `overrun-drag-test` inside the build, plus step 5 |
| Notice Undo overwrites an edit that arrived after the resize | step 4 suite case for "moved since"; the reverse plan only applies when the op still matches the resize's result |
| A toast lands on top of the notice | the notice sits at the bottom and toasts sit at the top; checked in step 5 |
| Esc also closes a modal or clears a selection mid-resize | the Esc listener lives only while a resize is in progress and stops the event |

## How you'll test it
1. localhost:8888 as admin, Schedule, week view. Drag a short pill (a few hours) sideways from near its end: it moves and keeps its length.
2. On a wide pill, hover it and the end grips show. Drag the right grip out a day. A notice reads "Resized … 8h → 16h, ends … instead of …".
3. Click Undo in the notice: the pill is back to its old length, and the job's history shows "Resize undone".
4. Resize again, then move that pill before clicking Undo: the Undo button is gone.
5. Start a resize and press Esc before letting go: nothing changes.

## Log
- **2026-10-16 16:05 · step 1 · Found:** `npm run build` was red on this Windows checkout before any change here. Four suites read files in ways that only work on LF/POSIX: `clock-access-test` and `lunch-default-test` (CRLF, #376's trap again), plus `status-meaning-test`, and `clock-shift-test` through it (`URL.pathname` gives `C:\C:\`). Test-only fixes, committed on their own ahead of step 1. Production builds on Linux, so nothing deployed was affected. `eol-safety-test` didn't catch the two CRLF ones, so its detector has a gap (not fixed here).
- **2026-10-16 16:05 · step 1 · Decided:** the overrun tail on a PTO bar keeps its old grip rule too (12px and up, a third of its width), the same as the PTO head.
- **2026-10-16 16:30 · step 2 · Found:** nothing tested the day view's resize through its real handler. [resize-test.mjs](scripts/resize-test.mjs) now drives `handleTeamDayBarDrag` too, the same way it already drove the week/month one. Esc applies to resizes only, so a day-view move adds no key listener.
- **2026-10-16 16:55 · step 3 · Changed:** C2's premise was wrong. No "Changes saved" toast fires after a drag (the only generic toast is org settings), so there was nothing to suppress. The notice moved to the bottom center instead, where it can never sit on a top-center toast.
- **2026-10-16 16:55 · step 3 · Decided:** the notice names the edge that was dragged, not whichever date field differs. A pill drawn pushed (a cursor push or an overrun) lands at its painted start, which would otherwise read as "starts … instead of …" on a right-edge resize.

## Outcome
