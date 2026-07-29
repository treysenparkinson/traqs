# TRAQS iOS — Revert to Original UI Design

**Purpose:** The Liquid Glass UI experiment (bottom tab bar, Home header controls, etc.) is being
built for user testing. If we decide to go back, this file is the reliable, verified way to restore
the **original TRAQS iOS UI** exactly.

> **Trigger phrase:** when the user says *"go back to the original TRAQS UI design"*, follow
> **Section 3 (Revert)** below.

---

## 1. What "original" is vs. "new"

**Original design (the side-drawer UI)** — what we restore to:
- Primary navigation is a **swipeable left side drawer** (`SideMenu` in `MainTabView.swift`), opened by
  a **hamburger / bars button** (`TRAQSMenuButton`) in the header's leading slot.
- The drawer holds: org card, the tab list (Home/Jobs/Time Clock/Stats/Messages), Admin + Settings
  rows, and a profile + logout footer. A pulsing red dot on the hamburger flags missed notifications.
- Header logo (`TRAQSWordmark`) shows **only on Home**; other pages show just the hamburger.
- **Settings** is a full-screen `SettingsView` sheet; **Profile** is `TRAQSProfileButton` → `ProfileSheet`
  (read-only). `EditProfileView` had no "About" footer.
- Time-tracking buttons (Clock Out, Lunch, job Break) use **solid** fixed-color fills.
- The `Messages` tab bar was not hidden inside a thread (there was no bottom tab bar — the drawer was nav).
- Gantt Week view passed a **recomputing `blocks(for:)` closure** to `WeekGrid` (the perf issue).

**New design (Liquid Glass experiment)** — what we're testing:
- Native Liquid Glass **bottom `TabView`** (Home · Jobs · Time Clock · Stats · Messages).
- Home header top-right: **Admin · Settings (native glass menu) · Profile avatar**, all 36×36; logo
  (`traqs=` lockup) top-left on **every** page; drawer removed.
- Settings glass menu → Customization (`CustomizeView`) + Log out; Profile avatar → `EditProfileView`
  (now with an About footer). `SettingsView` / `TRAQSProfileButton` / `ProfileSheet` retired.
- Time-tracking buttons rendered as **gradient** CTAs of their own colors (`Color.verticalGradient()`).
- Bottom tab bar hides (native slide) inside a message thread.
- Gantt computes blocks **once per render** (perf fix).

---

## 2. Anchor & file inventory (verified)

- **Original design = git commit `f208ca9`** ("feat: live-growing Efficiency stats while clocked in").
  Nothing has been committed on top, so `f208ca9` holds every original file intact.
- **Backup of the NEW design:** `docs/superpowers/liquid-glass-ui.patch` (full diff incl. the new file;
  verified it reverses cleanly against the working tree).

**Modified source files (restore from `f208ca9`):**
```
TRAQS Scheduling/TRAQS Scheduling/Services/AppNav.swift
TRAQS Scheduling/TRAQS Scheduling/Services/ColorExtension.swift
TRAQS Scheduling/TRAQS Scheduling/Views/GanttView.swift
TRAQS Scheduling/TRAQS Scheduling/Views/HomeView.swift
TRAQS Scheduling/TRAQS Scheduling/Views/MainTabView.swift
TRAQS Scheduling/TRAQS Scheduling/Views/MessagesView.swift
TRAQS Scheduling/TRAQS Scheduling/Views/SettingsView.swift
TRAQS Scheduling/TRAQS Scheduling/Views/SharedComponents.swift
TRAQS Scheduling/TRAQS Scheduling/Views/TasksView.swift
TRAQS Scheduling/TRAQS Scheduling/Views/TimeClockView.swift
TRAQS Scheduling/TRAQS Scheduling.xcodeproj/project.pbxproj
```

**New file (delete on revert):**
```
TRAQS Scheduling/TRAQS Scheduling/Views/HomeHeaderControls.swift
```

(The `xcuserstate` / `xcschememanagement.plist` changes are Xcode user-state noise — ignore them.)

---

## 3. Revert: go back to the ORIGINAL UI

Run from the repo root (`/Users/treysenparkinson/traqs`). This restores the tracked files to their
`f208ca9` versions and removes the one new file. It survives even if the new design is later committed,
because it references the specific commit `f208ca9`.

```bash
cd "/Users/treysenparkinson/traqs"

git checkout f208ca9 -- \
  "TRAQS Scheduling/TRAQS Scheduling/Services/AppNav.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Services/ColorExtension.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/GanttView.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/HomeView.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/MainTabView.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/MessagesView.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/SettingsView.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/SharedComponents.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/TasksView.swift" \
  "TRAQS Scheduling/TRAQS Scheduling/Views/TimeClockView.swift" \
  "TRAQS Scheduling/TRAQS Scheduling.xcodeproj/project.pbxproj"

rm -f "TRAQS Scheduling/TRAQS Scheduling/Views/HomeHeaderControls.swift"
```

Then in Xcode do a clean build (Cmd-Shift-K, then build). You're back on the original side-drawer UI.

**Alternative (equivalent), using the patch backup — only valid while the working tree still has the
new design applied:**
```bash
cd "/Users/treysenparkinson/traqs"
git apply --reverse "docs/superpowers/liquid-glass-ui.patch"
rm -f "TRAQS Scheduling/TRAQS Scheduling/Views/HomeHeaderControls.swift"   # if the reverse leaves it
```

---

## 4. Return to the NEW (Liquid Glass) design after reverting

If you revert and later want the experiment back:

```bash
cd "/Users/treysenparkinson/traqs"
git apply "docs/superpowers/liquid-glass-ui.patch"
```

This re-creates all 12 changes, including `HomeHeaderControls.swift`. Clean-build in Xcode.

> Keep `docs/superpowers/liquid-glass-ui.patch` in place — it is the durable backup of the new design.
> If the new design changes further, regenerate the patch so this file stays current (ask Claude to
> "update the liquid-glass patch backup").

---

## 5. Verification performed (2026-07-29)

- `git log -1` → HEAD is `f208ca9`; `git diff --cached` empty (nothing committed/staged).
- `git apply --reverse --check docs/superpowers/liquid-glass-ui.patch` → **OK** (revert path proven).
- `git cat-file -e f208ca9:<file>` → all modified files present at `f208ca9`;
  `HomeHeaderControls.swift` confirmed **absent** at `f208ca9` (so deleting it on revert is correct).
- No commits, no pushes were made.
