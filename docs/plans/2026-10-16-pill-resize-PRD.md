# Moving a pill never changes its length unless you meant it to

**From:** Treysen (owner / builder) · **Date:** 2026-10-16
**Type:** Improvement
**Size guess:** S (a day or two)
**Urgency (theirs):** not stated. It happens "too often."
**Status:** Ready, with assumptions (see below)

## TL;DR
When Treysen drags a person's schedule pill left or right to move it, he sometimes grabs the
pill's end by accident and stretches or shrinks it instead. TRAQS saves that with no notice,
so he often doesn't catch it until later. By then, finding the original dates means undoing
everything he did after it. He wants to keep resizing. Recommendation: keep it, but make it
hard to do by accident, and make it impossible to miss when it does happen.

## PM's take
What he literally asked for was to turn off pill dragging. In the same breath he says "I
technically like the option of being able to do it." So removing resize is the wrong fix:
it trades an occasional accident for losing a tool he uses. There are really two problems:
(1) the resize zone is easy to hit while you're trying to move the pill, and (2) the
resize is silent. Fixing (2) matters more, because "I don't always know" is what makes
this painful. An accident you see right away costs you one Ctrl+Z. One you don't see costs
you an afternoon of undoing. So build both. Make the middle of the pill always move it and
the resize grip a thin strip at the very edge. Then put a visible notice after every resize
that shows before and after and has an Undo button. If accidents keep happening after that,
the next step is making resize need a held key. That's listed under Later, not v1.

## Asked for vs. needed

| They asked for | What's actually going on | What they need |
|---|---|---|
| "stop allowing me to drag the schedule pills" (resize) | A move drag sometimes starts on the resize edge. The resize saves silently and changes the op's hours. | Moves never change length by accident, and any length change is obvious the moment it happens |

**Job story:** When he's sliding someone's work a day or two left or right, he wants the
pill to keep its length unless he deliberately grabbed the end, so he can rearrange the week
without auditing every pill afterward.

**Options considered:**
1. **Remove resize entirely (as asked).** Kills the accidents, but loses a tool he likes, and
   the length then has to be changed somewhere else. Rejected.
2. **Thinner, deliberate grab zone + a notice after resize with Undo.** Fixes both the
   accident and the "didn't know." Small build. **Chosen.**
3. **Resize only while holding a key (e.g. Alt).** Accidents become nearly impossible, but
   resize becomes invisible to anyone who doesn't know the trick. Kept as the follow-up if
   option 2 isn't enough.
4. **Per-user "lock pill length" setting.** Lets him turn it off and on. Adds a setting to
   maintain for a problem option 2 should already solve. Later, if wanted.

## The problem
- **Who it hits:** whoever moves work on the week/month team rows (desktop, needs the
  move-jobs permission). Right now that's Treysen. The floor tech also inherits it
  indirectly: their op's dates and hours change and nobody meant them to.
- **When and how often:** while moving a pill left or right. "ive caught myself accidentally
  doing it too often."
- **How bad:** wrong schedule dates, and **(inferred from code)** wrong hours: a resize
  rewrites the op's hours, not just its dates, so job health and progress shift too. And it's
  silent: "it just does it and i dont always know."
- **What he does today:** Ctrl+Z backwards until the original dates come back, which also
  throws away every good move made after the accident.
- **Cost of doing nothing:** schedules and hours quietly drift from what was planned, and
  each time he catches it late it costs him a rework session.

**What the code shows (checked in `traqs-func`, 2026-10-16):**
- The resize grip on each end of a pill is a third of the pill's width, up to 10px
  (`_handleW`, `TRAQS.jsx` ~16870). On a ~30px pill that's 10px at each end, so two-thirds of
  the pill resizes and only the middle third moves. Pills under 12px have no grips at all.
- The grip is invisible until you hover it (opacity 0).
- On release, a resize saves right away: no confirm, no notice (`handleTeamResize`,
  ~17435–17500). It writes a new `hpd` for the op as well as new dates (`resizeSession`,
  `dragMove.js` ~390).
- It's one undo step, but undo is a single stack (50 deep, this session only). Getting back
  to it means undoing everything done since.

## Proposed solution

**How it works (user's view):**
1. Grab anywhere in the body of a pill and drag: it moves, same length, every time.
2. To change the length, grab the thin grip at the very end of the pill. The cursor and grip
   show clearly before you press, and while dragging the pill shows the new hours or end date.
3. Let go after a resize and a notice appears, e.g. "Resized *Panel 3 wiring* (Marco):
   16h → 24h, ends Thu instead of Wed · **Undo**". Undo puts back exactly that resize,
   without touching anything else.

**Platforms:** desktop web only (week/month team rows, plus the day-level team bars, which
use a fixed 12px grip). iPhone and Android don't resize schedule pills by drag, as far as I
found.

### Requirements

**Must have (v1)**
- [ ] A move drag that starts in the body of a pill never changes its length **(said)**.
  *Done when:* on a pill one day wide in week view, pressing anywhere except the outer grip
  and dragging sideways changes dates only. Start/end hours and `hpd` stay the same.
- [ ] The resize grip is a thin fixed strip at the pill's edge, not a share of its width.
  Short pills get no grip rather than a grip that takes up most of the pill **(inferred)**.
  *Done when:* the grip width doesn't grow with pill width, and any pill with a grip still
  has a move area clearly bigger than both grips together. Treysen picks the pixel numbers.
- [ ] Every committed resize shows a notice with before and after for hours and dates, and
  an Undo button **(said: "it just does it and i dont always know")**. *Done when:* resize
  any pill, and the notice names the op, the person, old vs. new hours and end date. Undo
  restores that op's dates and hours and leaves later edits alone.
- [ ] While resizing, the pill shows the hours it will have when you let go **(inferred)**.
  *Done when:* dragging a grip shows the changing hours or end date before release.
- [ ] Pressing Esc mid-resize cancels it with nothing saved **(assumed)**. *Done when:* start
  a resize, press Esc, release: no change, no undo step, no save.

**Later / nice to have**
- Hold a key (e.g. Alt) to resize, if accidents keep happening after v1.
- A per-user "lock pill length" toggle.
- The same treatment for Gantt-view bar resizing, if it has the same problem.

## Not doing
- Removing resize.
- Changing how a move works: snapping, reassigning by dropping on another row, multi-select
  and group moves all stay as they are.
- Changing undo in general (per-item undo, undo that survives a page reload).
- A confirm dialog before every resize. That would get in the way of deliberate resizes,
  and the notice with Undo covers the accident case.

## Must not change
- All the refusals still run on resize: time off, a live clock on the op, overlap, the past.
- One resize = one save and one undo step (#31 #32).
- PTO bar resizing keeps working (it's a separate path).
- Pills with worked hours keep their current rules (the left grip is already hidden when
  `workedHpd > 0`).

## Edge cases and ripple effects
- **Crew ops:** a resize writes the team's total `hpd`. The notice should show the op's total
  hours change, not one person's share, or it'll look wrong.
- **Undo after a later edit:** if the op was moved or edited after the resize, the notice's
  Undo has to either reverse only the length or step aside (hide or disable). It must never
  wipe out the later edit.
- **Realtime:** someone else might edit the same op before Undo is clicked. Same rule as
  above: don't overwrite their change.
- **Notice spam:** several deliberate resizes in a row. Each new notice replaces the last.
  No stacking.
- **PTO bars** resize live mid-drag with no session, a different path. Same accident risk?
  Not in scope unless Treysen sees it there too.

## Assumptions (Treysen: veto any of these)
- **A1.** "Drag the schedule pills" means resizing by the ends, not moving. *Why:* he says
  the problem is expanding or shrinking while moving left or right, and he wants to keep
  moving.
- **A2.** This is the week/month team rows on desktop. *Why:* "the schedule pills on the
  rows," "a schedule for a person." Mobile has no drag-resize.
- **A3.** Keep resize, with guardrails, rather than switching it off. *Why:* "I technically
  like the option of being able to do it."
- **A4.** The notice is a toast-style message that goes away on its own after a few seconds.
  It's not a dialog you have to click. *Why:* deliberate resizes shouldn't cost an extra click.
- **A5.** Esc-to-cancel is wanted. *Why:* it's cheap, and it's the standard way out of a drag
  you didn't mean.

## Open questions
- **For Treysen (technical):** does the resize preview already show hours on the ghost? If
  it does, requirement 4 is done.
- **For Treysen (technical):** the narrowest pill that should still get a grip. Somewhere a
  half-day pill in month view still has a move area you can hit easily.
- **For Treysen:** after v1, is the hold-a-key version worth it, or is the notice enough?

## How we'll know it worked
- He can rearrange a week without later finding pills that changed length.
- When a resize does happen, he knows it in the moment and undoes it with one click instead
  of Ctrl+Z through his other moves.

## Builder notes
- **Likely touches:** the grips and `handleTeamResize` in `TRAQS.jsx` (~16870, ~17435,
  ~17876, ~17970 for the tail-hours grip), the day-level team bar grips (~16127), and the
  `commit` path for the notice. `resizeSession` in `dragMove.js` probably needs no change.
- **Related existing features:** global undo (`undoStack`, ~5283), the "Resized in
  schedule" history reason already passed to `applyDragMove`, and existing toast plumbing.
- **Rabbit holes:** a targeted single-op undo for the notice could balloon into per-item
  undo. Suggested call: Undo restores that op's saved `from` snapshot only if the op still
  matches the resize's `to`. Otherwise the button goes away.
- **If it runs long, cut first:** Esc-to-cancel, then the live hours label. The thinner grip
  and the notice are the fix.
- **Parity:** Swift-parity suites shouldn't care (web-only drag), but `npm run build` runs
  them anyway.

## What they said
> I want traqs to stop allowing me to drag the schedule pills on the rows, because when i am
> moving a schedule for a person left or right sometimes i accidentally expand or decrease
> the scheduled time, and if i dont realize, then it can be annoying to have to undo all the
> changes to find the original scheduled date.
> I technically like the option of being able to do it, but ive caught myself accidentally
> doing it too often, and it just does it and i dont always know
> Can we fix this somehow
