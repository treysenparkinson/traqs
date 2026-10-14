# iOS Liquid Glass Arrangement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Home, Jobs, Analytics and Employees back in their pre-`09ca9fa` arrangement, and re-skin Time Clock in that design language, on today's code with no logic changes.

**Architecture:** View-layer only. Each page keeps its current data/logic members verbatim and swaps its `Rv*` layout for the old components (`frostedCard`, `PageTitle`-era structs, `TSectionTitle`, `TagPill`), restored from `git show 09ca9fa~1:<file>` and adapted to today's font and models. One page per task, one commit per task.

**Tech Stack:** SwiftUI (iOS 26 target, Swift 5 mode, default MainActor isolation), Swift Testing, Xcode 26 `xcodebuild`.

**Spec:** `docs/superpowers/specs/2026-10-14-ios-liquid-glass-arrangement-design.md`

## Global Constraints

- No liquid background, no frosted glass: `T.glassEnabled` stays `false`; `.frostedCard` is used as-is (solid `T.surface`, 1pt `T.border` hairline).
- Untouched files: `MessagesView.swift`, `MainTabView.swift` (nav bar), `GlassHeader.swift`, `SplashView.swift`, `CustomizeView.swift`, `ThemeSettings.swift`, `Revamp.swift` (stays; dead-code pass is separate).
- Title sizing: `RvTitle` stays on every page (`Rv.titleSize` 38; Home 46). Nothing else of Revamp's layout is kept on the five pages except the two kept selectors.
- Font: every restored `.custom(TFontName.X.rawValue, size: N)` becomes `.traqs(.X, size: N)`. `TTypo.*` calls are kept as written (already system font).
- Side margins: 16 (`Rv.side` → `16`) on the five pages.
- Kept user decisions: no "In Progress" title and no `EndOfDayPlaceholder` on Jobs; job cards sky (`Rv.Tint.sky`); no purple; "It's quiet here..." empty text; Analytics bars labelled with day pay hours + today highlight.
- No data/logic member of any page is edited. If a restored view needs a value, it reads the CURRENT member that provides it (e.g. `hoursToday(now:)`, not the old `liveShiftHours(now:)`).
- Per memory: build to verify compile only; do NOT boot/drive the simulator; the user runs each page.

## Review Focus

1. **Basic tier** — Home shows `BasicShiftsCard`, Jobs hides Active, last tab is Employees. Expect each restored page to render its Basic branch, not a blank.
2. **Dark mode** — solid `T.surface` cards on `T.bg`; the today pill on the week strip and the gradient count badges must stay readable (`T.onGradient`).
3. **Large phones / xxLarge Dynamic Type floor (≥430pt)** — Home's two SQUARE cards (`aspectRatio(1)`) must not clip: the clock uses `minimumScaleFactor(0.7)`, the label `lineLimit(1)` + scale. Keep both.
4. **Empty states** — Home with nothing today, Jobs per tab ("It's quiet here...", "Nothing assigned to you", "Nothing in progress", "No finished jobs"), Analytics non-admin, Employees with no search hit.
5. **Live values while on the page** — Home shift clock ticks each second on lunch/break/working; Analytics running entry keeps `frozenAtMs` (#521) so a held clock stops.

These are pinned by the existing unit suites where logic is involved (`LiveDateBugsTests` holds `BasicShiftsCard.today`; `HeldClockTests`, `JobsQueryTests`, `TaskUnitsTests` hold the data); the visual half of each is the user's on-device check, listed per task.

## Verification commands (used by every task)

```bash
# 1. iOS compiles + full unit suite (New York host; see reference_traqs_ios_build_test)
cd "/Users/treysenparkinson/traqs/TRAQS Scheduling" && TEST_RUNNER_TZ=America/New_York \
  xcodebuild test -project "TRAQS Scheduling.xcodeproj" -scheme "TRAQS Scheduling" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:"TRAQS SchedulingTests" -parallel-testing-enabled NO 2>&1 \
  | grep -E "error:|✘|Test run with|TEST "
# Expected: "Test run with N tests … passed", "** TEST SUCCEEDED **"

# 2. Web build (web suites read the Swift). Only if no dev server on :8888.
cd /Users/treysenparkinson/traqs && npm run build
# Expected: exit 0, "✓ built"

# 3. Mac typecheck (Models/Services are shared). Ably stub + file list in the session scratchpad;
#    see reference_traqs_mac_typecheck. Only needed when a task touches Services/ or Models/.
```

No new unit tests: these tasks change layout only, and layout is the user's on-device check (per the standing rule — no simulator driving). A task that finds it must change a data member stops and reports instead.

---

### Task 1: Home — old arrangement

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Views/HomeView.swift` (whole view layer; data members kept)

**Interfaces:**
- Consumes: `appState.myShiftStatus`, `appState.hoursToday(now:)`, `appState.livePauseSeconds(now:)`, `appState.unreadSenders`, `appState.todayTasks(now:)`, `appState.activeTaskAssignment`, `appState.myActiveJobClock`, `appNav.selected`, `appNav.jobsMode`.
- Produces: `struct BasicShiftsCard` keeps its name, `onJump:` init and `static func today(now:org:) -> String` (pinned by `LiveDateBugsTests`).

- [ ] **Step 1: Replace the body's content stack**

In `HomeView.body`, replace everything inside `ScrollView { VStack(alignment: .leading, spacing: 0) { … } }` with:

```swift
                        // Greeting — today's size (46), the old position.
                        RvTitle(title: greeting, size: 46)

                        // Today's date + this week. Only changes at the shop's
                        // midnight, so it ticks once a minute.
                        LiveClock(every: 60, tab: .home) { now in
                            TodayDateCard(now: now)
                        }
                        .padding(.horizontal, 16)

                        // Live shift + new messages — two square cards.
                        HStack(spacing: 12) {
                            LiveClock(every: 1, tab: .home) { now in
                                ShiftStatusHero(status: appState.myShiftStatus,
                                                liveHours: appState.hoursToday(now: now),
                                                pauseSeconds: appState.livePauseSeconds(now: now)) {
                                    withAnimation(.easeInOut(duration: 0.22)) { appNav.selected = .hours }
                                }
                            }
                            NewMessagesCard(senders: unreadBySender) {
                                withAnimation(.easeInOut(duration: 0.22)) { appNav.selected = .chat }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 14)

                        // Today's job.
                        Group {
                            if !appState.isBusinessTier {
                                BasicShiftsCard(onJump: jumpToJobs)
                            } else if let s = suggested {
                                SuggestedJobCard(task: s, isActive: isActive(s), onJump: jumpToJobs)
                            } else {
                                HomeEmpty(text: "Nothing scheduled for today.")
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, 28)
```

Check `RvTitle`'s own horizontal inset: if it pads `Rv.side` (24) internally, give it `side: 16` if the initializer takes one; otherwise leave it (the spec allows the title inset to be redialled on device) and note it in the report.

- [ ] **Step 2: Swap the Business list for the suggested job**

Delete `businessToday`, `todayRows` and `subtitle(for:)`. Add (from old HomeView L127-132):

```swift
    /// Active job if clocked in, else the next "up next" task today, else the first.
    private var suggested: TaskAssignment? {
        appState.activeTaskAssignment
            ?? today.first(where: { $0.status == .notStarted })
            ?? today.first
    }
```

Keep `today`, `isActive(_:)`, `greeting`, `unreadBySender`, `reload()`, `jumpToJobs()` exactly as they are.

- [ ] **Step 3: Replace the component structs**

Delete `HomeWeekStrip`, `ShiftTile`, `MessagesTile`. Restore `TodayDateCard`, `ShiftStatusHero`, `NewMessagesCard`, `SuggestedJobCard` and `HomeEmpty` verbatim from:

```bash
git show 09ca9fa~1:"TRAQS Scheduling/TRAQS Scheduling/Views/HomeView.swift" | sed -n 156,396p   # TodayDateCard … SuggestedJobCard
git show 09ca9fa~1:"TRAQS Scheduling/TRAQS Scheduling/Views/HomeView.swift" | sed -n 486,496p   # HomeEmpty
```

with exactly these edits:
- every `.font(.custom(TFontName.bold.rawValue, size: N))` → `.font(.traqs(.bold, size: N))` (6 sites);
- `ShiftStatusHero.liveHours` keeps its name; its value now comes from `hoursToday(now:)` (Step 1) — no change inside the struct.

- [ ] **Step 4: Restore BasicShiftsCard's old face, keeping its logic**

Keep `myShifts` and `static func today(now:org:)` byte-for-byte. Replace `body` (from `return VStack` down) and `shiftRow` with the old ones (old L415-482), plus the old `section(_:_:)` helper, applying the same `.custom` → `.traqs` edit (3 sites). `SLine` and `BasicCardLabelStyle` still exist (Primitives.swift:442, TasksView.swift:2275).

- [ ] **Step 5: Update the file header comment**

Replace the `// Wireframes v2 screen 01: …` comment with: `// The pre-Wireframes-v2 arrangement (spec 2026-10-14): greeting · date + week · shift and messages squares · today's job. Every card jumps to the tab that acts on it; Home never starts/logs time itself.`

- [ ] **Step 6: Verify**

Run verification command 1. Expected: `** TEST SUCCEEDED **`, `LiveDateBugsTests` green. Then command 2 (expected exit 0). Grep the file: `grep -n "Rv[A-Z]" HomeView.swift` must show only `RvTitle`.

- [ ] **Step 7: Commit**

```bash
git add "TRAQS Scheduling/TRAQS Scheduling/Views/HomeView.swift"
git commit -m "iOS Home: the Liquid Glass arrangement — date card, shift and messages squares, today's job

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Hand off: Business and Basic, light and dark, idle / working / lunch states.

---

### Task 2: Jobs — old arrangement, tabs kept

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Views/TasksView.swift`
- Not modified: `JobsHubView.swift` (the fixed title + Day/Week row stays — confirmed)

**Interfaces:**
- Consumes (unchanged, do not edit): `JobsFilter`, `filter`, `filterOptions`, `jobCount`/`jobCountLabel`, `showsMyWork`, `myTasks`, `allJobsList`, `activeOthersSection`/`doneSection` data, `JobUnits`, `openJobs`, `TaskUnits.*`, `TaskCardV1.Style`, `StatusBadge`/`JobStatusBadge`, `blockTint`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Tabs stay, restyled position only**

Keep `RvTabs(options: filterOptions, selection: $filter, trailing: jobCountLabel)` (current L75) and its `.padding(.horizontal, …)` → `16`.

- [ ] **Step 2: Section headers back to the old centred label**

Replace the body of `sectionHeader(_:count:top:)` (current ~L364) with the old centred style (old L344-356: `Text(title)` `TTypo.xsBold(12)` `.tLabel(tracking: 1.6)`, centred, optional tint), keeping the CURRENT signature so callers don't move; render `count` as ` · N` after the title only if non-nil. Remove the `Rv.line` hairline.

- [ ] **Step 3: Cards to the `.card` face**

In `cardStack`, `jobCardStack`, the working stack and `taskBlock`, change `style: .block` → `style: .card`. Apply the sky tint to the `.card` face's accent (the element `blockTint` colours on `.block`) so job cards stay sky (95194fb).

- [ ] **Step 4: AllJobsCard — old pill face over today's dropdowns**

Keep `JobUnits`, `openJobs`, `jobRow`, `taskBlock` logic. Replace the `RvRow { RvDot; RvRowText; RvChevron }` face with the old `SBox(size: .pill, rim: false)` pill (old L1800-1866: dot, title, chevron), keeping today's `rowTitle` ("number – title") and "N of M tasks" subtitle as the pill's second line.

- [ ] **Step 5: Spacing**

`rangeContent`: `VStack(spacing: 0)` + `Rv.sectionTop` maths → old `VStack(spacing: 16)`; every `Rv.side` → `16`; card stacks `spacing: 12`. Do NOT restore the "In Progress" title or `EndOfDayPlaceholder`.

- [ ] **Step 6: Verify** — command 1, then command 2. `grep -n "Rv\." TasksView.swift` shows only `RvTabs` and `Rv.Tint.sky`.

- [ ] **Step 7: Commit** — `iOS Jobs: the Liquid Glass arrangement; the All/Mine/Active/Done tabs stay`

Hand off: each tab, Business and Basic, a job with tasks and one with none (#451 clock-in leaf).

---

### Task 3: Analytics — old arrangement, Week/Pay Period tabs kept

**Files:**
- Modify: `TRAQS Scheduling/TRAQS Scheduling/Views/MoreView.swift`

**Interfaces:**
- Consumes (unchanged): every compute member in current L245-784 (`statsInterval`, `efficiencyDays`, `efficiencyPercent(from:)`, `idleHours(from:)`, `breakHours(from:)`, live-hours helpers with `frozenAtMs`), `rangeToggle` (RvTabs), `InfoButton`.

- [ ] **Step 1: Body order** — title (`RvTitle(title: "Analytics", meta: rangeLabel)`, kept) → `rangeToggle` (kept) → admin: `statGrid` → `EfficiencyCard` → over-hours; personal: `personalStatGrid` → `EfficiencyCard`; then Past Jobs. Spacing from old body L62-135 (`VStack(spacing: 16)`, horizontal 16).
- [ ] **Step 2: Stat grids** — restore `StatBox` (old L816-857); `statGrid`/`personalStatGrid` become a 2-column `LazyVGrid` of `StatBox(title:value:info:)` (old L408-468), same values and info strings as today's `RvTile`s.
- [ ] **Step 3: Efficiency** — restore `EfficiencyCard` + `WeeklyBars` (old L1024-1156), keeping today's `EfficiencySection.hoursLabel` labels (day pay hours) and `todayId` highlight from `d9cc596`; delete `EfficiencySection`/`EffBarsRow`.
- [ ] **Step 4: Over-hours + Past Jobs** — restore frosted `OverHoursTab`/`OverHoursList`/`OverHoursRow` (old L883-992), `TSectionTitle("Past Jobs")`, `RunningEntryCard`, `JobHoursSummaryRow`, `EntryGroupCard`, `EntryRow`, `HoursEmptyState`, `NonAdminEmpty` (old L1157-1350). In `RunningEntryCard`, keep today's `HoursCalculator.liveElapsedHours(…, frozenAtMs: jc.frozenAtMs, …)` call exactly.
- [ ] **Step 5: Fonts** — `.custom(TFontName.X.rawValue, size:)` → `.traqs(.X, size:)` throughout restored code.
- [ ] **Step 6: Verify** — command 1 (`HeldClockTests`, `StatsRangeTests` green), command 2.
- [ ] **Step 7: Commit** — `iOS Analytics: the Liquid Glass arrangement; the Week/Pay Period tabs stay`

Hand off: admin Everyone, admin personal, non-admin; Week and Pay Period; a running entry.

---

### Task 4: Employees — old arrangement

**Files:** Modify `TRAQS Scheduling/TRAQS Scheduling/Views/EmployeesView.swift`

- [ ] **Step 1:** Keep filter/sort, search (`glassControl`), contact buttons, own-row hiding, `PhoneNumber`, `.refreshable`. Title stays `RvTitle("Employees")`.
- [ ] **Step 2:** Remove `RvSection("Everyone")`; rows become the old `EmployeeCard` (old L101-203: HStack 12, 46pt Avatar, `.padding(.horizontal,14).padding(.vertical,12).frostedCard(radius: T.cornerMd)`) in `LazyVStack(spacing: 10)`, horizontal 16; search `.padding(.horizontal,16).padding(.bottom,14)`; empty state `.padding(.vertical,22).frostedCard(radius: T.cornerMd)`. Fonts via `.traqs`.
- [ ] **Step 3: Verify** — command 1, command 2.
- [ ] **Step 4: Commit** — `iOS Employees: the Liquid Glass arrangement`

---

### Task 5: Time Clock — today's layout, old design language

**Files:** Modify `TRAQS Scheduling/TRAQS Scheduling/Views/TimeClockView.swift`

- [ ] **Step 1:** Section order unchanged. `RvTitle(title: "Time Clock", meta: todayMeta)` kept.
- [ ] **Step 2:** `ClockTimerBlock` → wrapped `.padding(T.insetHero).frostedCard()`; its `RvTag` → `TagPill`.
- [ ] **Step 3:** `PayPeriodTile` → `.frostedCard()` (drop `Rv.Tint.sky` fill); `RvEyebrow("Pay period")` → `Text("PAY PERIOD").font(TTypo.xsBold(11)).tLabel(tracking: 1.4).foregroundStyle(Color(hex: T.muted))`; `RvTrack` → `Bar`.
- [ ] **Step 4:** `RvSection("Recent entries", action: "Last 8 days")` → in-card heading (bold 17 ink title, trailing muted `TTypo.xs(11)` "Last 8 days") over ONE `.frostedCard(radius: T.cornerMd, rim: false)` holding the `DayLine` rows (row internals keep their data; `RvRow`/`RvRowText` → plain HStack/VStack as old `EntryRow`).
- [ ] **Step 5:** `OpenBreakCard` → `.frostedCard(radius: T.cornerMd)` (drop `Rv.Tint.butter`). Buttons (`GradientCTA`, glass pills) untouched. `Rv.side` → 16. Same substitutions in `TimesheetSheet`.
- [ ] **Step 6: Verify** — command 1 (`PayPeriod`/`HoursCalculator` suites green), command 2.
- [ ] **Step 7: Commit** — `iOS Time Clock: today's layout in the Liquid Glass design language`

---

### Task 6: Dead-code pass

- [ ] **Step 1:** For each `Rv*` type/member in `Revamp.swift`, `grep -rn "<Name>" --include='*.swift' "TRAQS Scheduling" "TRAQS MacBook Native/TRAQS MacBook Native"` (excluding `.build`); list those with zero callers outside Revamp.swift.
- [ ] **Step 2:** Delete only those; keep `RvTitle`, `RvTabs`, `Rv.Tint`, `Rv.titleSize` and anything Messages uses.
- [ ] **Step 3: Verify** — command 1, command 2, and command 3 (Mac typecheck).
- [ ] **Step 4: Commit** — `iOS: drop the Revamp pieces nothing uses after the Liquid Glass arrangement`
