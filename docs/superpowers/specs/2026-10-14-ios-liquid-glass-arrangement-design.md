# iOS: back to the Liquid Glass arrangement — design

2026-10-14. Approach A (ruled): rebuild each page's pre-redesign ARRANGEMENT on today's code.

## What this is

Wireframes v2 (`09ca9fa`, 2026-10-05) rearranged the iOS pages around the Revamp kit
(`Views/Revamp.swift`, `Rv*`). This puts the pages back the way they were arranged before it —
cards, section order, spacing, page structure — **without** the liquid background or the frosted
glass look, and **without touching any logic**. Three weeks of fixes landed in these files after
`09ca9fa` (#447, #451, #518, #521, #372, #360, #525…); every one of them lives in data, services
and view logic that this work does not edit.

"The old look, minus the glass" is concrete: with `T.glassEnabled = false`, `.frostedCard` renders
as a solid `T.surface` rounded rect with a 1pt `T.border` hairline and no shadow, and `SBox` /
`frostedPill` likewise. So the old components are used as they are; nothing about glass is
re-enabled.

## Kept exactly as today (the user's list)

- Messages — layout, profile images, the glass name pill, the group page expanding from it.
- Navigation bar — Apple's native Liquid Glass tab bar, icons only.
- Header — logo (`TRAQSBarsMark(size: 30)`), header buttons, header height.
- Title SIZING — `Rv.titleSize` (38) on every page, 46 on Home's greeting. Titles keep `RvTitle`;
  only their side inset moves to 16 to line up with the restored content.
- Font — the system font (SF Pro, `3f1d5fd`). Any old `TTypo` / `.custom(...)` call brought back
  is written through `.traqs(...)`.
- Jobs — the All / Mine / Active / Done tabs (`RvTabs`, `JobsFilter`, counts, Basic hiding Active).
- Analytics — the Week / Pay Period selector (`RvTabs` on `appNav.statsRange`).
- Time Clock — today's layout; only its design language changes.
- Load-up screen, Customize (Light/Dark + accent), sign-in screens.
- User decisions made AFTER `09ca9fa` that the old arrangement predates, kept: no "In Progress"
  title and no end-of-today footer on Jobs (`510f3b2`); job cards sky blue (`95194fb`); box colours
  blue/green/red/yellow, no purple (`e5f6c77`); "It's quiet here..." empty text; Analytics bars
  labelled with the day's pay hours and today highlighted (`d9cc596`).

## Design language (shared by every page below)

| Today (Revamp) | Restored |
|---|---|
| cardless `RvRow` lists, `Rv.line` hairlines | content in `.frostedCard` (rows grouped in one card, `radius: T.cornerMd`, `rim: false`) |
| `RvTile` pastel tiles | `.frostedCard(radius: T.cornerMd)` stat boxes |
| `RvSection` / `RvEyebrow` headers | `TSectionTitle`, or the in-card heading (bold 17 + muted xs 11 trailing), or the muted tracked label `xsBold(11).tLabel(1.4)` |
| `RvTag` / `RvDot` | `TagPill` / coloured dot as the old card had it |
| `Rv.side` = 24 | 16 |
| `Rv.sectionTop` spacing | the old 12–16pt stack spacing |

The Revamp kit stays in the tree — Messages and the kept selectors use parts of it. Anything left
with no caller at the end goes in a separate dead-code commit.

## Pages, in build order (one commit each)

1. **Home** — title (greeting, 46) → date card with this week's strip (`TodayDateCard`) → two
   square cards side by side: live shift (`ShiftStatusHero`, tap → Time Clock) and new messages
   (`NewMessagesCard`, tap → Messages) → today's job: `SuggestedJobCard` on Business,
   `BasicShiftsCard` on Basic, or the empty card. **This replaces today's "TODAY" list of every
   item with the old single suggested job**, which is what the old arrangement was.
2. **Jobs** — the fixed header row stays in `JobsHubView` (title + the gantt's Day/Week toggle);
   the tabs stay under it. Below: Today section → in-progress cards (no title) → the range content
   (week strip / month / year above it as before) → Overdue / Upcoming → "All Jobs" with the old
   pill-style `AllJobsCard` face over today's `JobUnits` dropdowns (#451: second-level task
   dropdowns, the "No tasks" leaf's own clock-in card, "N of M tasks"). Task cards use the
   `.card` face instead of `.block`, carrying the sky tint. Section headers go back to the old
   centred tracked label. Status shows via the display-only `StatusBadge` (#447).
3. **Analytics** (`MoreView`) — title (kept size, range label as meta) → the kept Week/Pay Period
   tabs → 2-column grid of `StatBox` cards (with their info buttons) → `EfficiencyCard` with
   `WeeklyBars` → over-hours bar + list (admin) → "Past Jobs" (`TSectionTitle`) with the running
   entry card, job-hours rows and day-group cards. `frozenAtMs` (#521) stays on every live-hours
   call.
4. **Employees** (Basic's last tab) — title → search → `EmployeeCard`s (46pt avatar, frosted
   card) in a 10pt stack, no section header. Filter/sort, contact buttons and refresh unchanged.
5. **Time Clock** — today's sections in today's order, re-skinned: the timer block, pay-period
   tile and open-break card become `.frostedCard`s; "Recent entries" becomes an in-card heading
   over one card of rows; eyebrows become the muted tracked label; 16pt margins. Buttons are
   already the old ones (`GradientCTA`, glass pills) and do not change. `TimesheetSheet` gets the
   same substitutions.

`TeamView.swift` is not routed from anywhere (the last tab is Analytics on Business, Employees on
Basic) and is not part of this.

## Verification

View-only work, per page: the iOS build compiles and the full unit suite stays green (it covers
the logic these pages read, which is not edited); `npm run build` (web suites read the Swift);
the Mac target typechecks, since Services are shared. The user runs each page as it lands —
layout and spacing are judged on device, and values (paddings, radii, sizes) are kept easy to
redial.

## Confirmed by the user on review (2026-10-14)

- Home: the old single suggested job replaces today's full list — YES.
- Jobs: the fixed title/Day-Week row stays, so the gantt toggle keeps a home — YES.
