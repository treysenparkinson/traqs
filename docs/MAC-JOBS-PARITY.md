# macOS Jobs page — parity map and worklog

**Source of truth:** `src/TRAQS.jsx`, `renderTasks()` @ **11346–12457**.
`taskSubView` is written in exactly two places and both write `"list"`, so the
**cards** branch (11524–11759) and the **gantt** branch (12454) are dead code.
The live page is the header bar (11429–11522) plus the list view (11760–12452).

**Target:** `TRAQS MacBook Native/TRAQS MacBook Native/Jobs*.swift`, `TQ*.swift`.
Models and services live in `TRAQS Scheduling/TRAQS Scheduling/{Models,Services}`
and compile into **both** the iOS and macOS targets — a change there hits iOS too.

---

## Start here

### Where it stands

Working on the Mac: the grid (three levels, expand, inline editing, sort), the
full column system (reorder, resize, rename, custom columns, the `+` picker, the
header context menu), the row right-click menu, and three modals — Export, TRAQS
Cloud, and New Job.

### Pick up in this order

1. **Conditional formatting** (§3) — needs `orgSettings.conditions`, which is
   already surviving in `extras`.
2. **Grouping** (§5) — by person, client, or column value. Until it lands, the
   column menu's "Use for grouping" is drawn and disabled: it used to toggle a
   preference that nothing read.
3. **The wizard's scheduling step** (§6) — availability check, AI suggestion,
   packer. The biggest remaining piece.
4. The engineering / sign-off queues above the grid.
5. The seven disabled rows in the row context menu, each behind a modal that is
   not ported: View Details, Reschedule, Split Job, Set Worked Hours, Add/Edit
   Dependencies, Edit, Send Reminder.
6. **Performance.** Two costs found and fixed; still reported slow. `TRAQS_PERF=1`
   reports every span over 2 ms — see the worklog. The unmeasured suspect is the
   view layer: rows build eagerly and each is now twelve cells, four carrying a
   `.popover`.

**Done:** the Approval and Activity columns, row drag-reordering, the org-settings
write path, and the Status / Priority palettes (§3) — see the worklog.

### Four things that will bite you

1. **Adding a stored property to `Job`, `Panel`, `Operation` or `OrgSettings`
   means adding it to `CodingKeys` AND to `encode(to:)`.** Nothing enforces it at
   compile time. See *The unmodelled-field bug* below for what happens otherwise.
2. **You cannot measure the page's width from inside the grid.** See *Measuring
   the page width*. Three attempts were wrong before one worked.
3. **Both targets set `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`.** So
   `map(Color.hex)` — an unapplied reference to a main-actor function handed to a
   nonisolated closure parameter — warns. Write `map { Color.hex($0) }`. Likewise
   `mapValues(CGFloat.init)` is *ambiguous*, not just noisy.
4. **`withAnimation` cannot animate a value that passes THROUGH and returns.** A
   scale of 1 → 1.025 → 1 has identical endpoints and silently does nothing. Those
   need `keyframeAnimator` — and a `KeyframesBuilder` has no empty branch, so an
   `if` inside one fails to type-check with no usable diagnostic.

### Verifying without building

Per the standing rule, the user builds and runs; I do not. What does work:

**A REAL TYPECHECK of the whole app, without Xcode.** This is the one that
matters, and it was not known when the notes below were written. `swiftc` can
compile every source in the Mac target in one go — the only thing in the way is
`RealtimeService.swift`, which imports Ably (an SPM checkout that is not on the
command line), so it is dropped and replaced by a stub of the surface `AppState`
touches:

```sh
cd ~/traqs
{ find "TRAQS Scheduling/TRAQS Scheduling/Models" \
       "TRAQS Scheduling/TRAQS Scheduling/Services" \
       -name '*.swift' ! -name 'RealtimeService.swift' -print0
  find "TRAQS MacBook Native/TRAQS MacBook Native" -maxdepth 1 -name '*.swift' -print0
} > /tmp/macfiles.txt
xargs -0 swiftc -typecheck -swift-version 5 -default-isolation MainActor \
  -sdk "$(xcrun --show-sdk-path --sdk macosx)" -target arm64-apple-macos26.0 \
  /tmp/ably_stub.swift < /tmp/macfiles.txt
```

Three flags are load-bearing and each one produces a wall of false errors if it
is missing:

| flag | why |
|---|---|
| `-default-isolation MainActor` | matches `SWIFT_DEFAULT_ACTOR_ISOLATION` in both projects. Without it every `AppState` call from a synchronous context is an actor-isolation error. |
| `-target arm64-apple-macos26.0` | `glassEffect` is macOS 26. At 15.0 the Gate files alone report a dozen availability errors. |
| `-swift-version 5` | matches `SWIFT_VERSION` in the pbxproj. |

The Ably stub is four declarations — `RealtimeStatus`, and a `RealtimeService`
with `isDegraded`, `connect(orgCode:api:onChange:onReconnect:onStatus:onTimeoff:onReads:)`
and `disconnect()`.

This catches type errors, overload ambiguity and actor isolation — everything the
note below says gets through. Prefer it over all three of these:

- `swiftc -parse <file>` — syntax only, no module context. It does NOT catch type
  errors, overload ambiguity, or actor isolation; three build failures got through
  on parse-clean code, which is what the typecheck above now prevents.
- A standalone `swift` script for anything pure (`JobsColumnLayout`,
  `JSONExtras`, `JobsProgress`) — stub the two or three types it needs. Still the
  quickest way to check ONE pure file in isolation.
- An `NSHostingView` in a borderless `NSWindow`, laid out and printed from a
  `GeometryReader`, for **layout questions**. This is how the width table below
  was produced, and it is the only reason that bug got found. A typecheck says
  nothing about layout.

---

## 1. Header bar — 11429–11522

Grid `auto 1fr auto 1fr`: title, tool cluster, spacer, actions.

**Select cluster** (11436–11448)
- `Select`/`Done` pill, `minWidth: 78` — toggles `jobSelectMode`, clears `selJobs`
- `All`/`None` — `.subtle-all-btn`, OUTLINED accent, `minWidth: 56`
- `{n} selected` + `Delete` → `setBulkDeleteConfirm({type:"jobs", ids, count})`

**Tools** (11453–11496)
- Filter icon + count badge → `taskFilterOpen` dropdown (250 wide, 14 pad)
  - Filter Status chips: `All` (clears) + STATUSES
  - Time Period chips: `current` / `future` / `finished`
  - Job # text input
  - `renderCustomColFilters()` @ **7703**
  - "Clear all filters" — resets fStat/fClient/fPers/grouping/fJobNum/fRole/fHpd/fOverloaded/fCustom
    (NOT taskSearchQ)
- `GroupingSelect asIconButton` — workers / clients / groupable columns
- Search bar `tq-searchbar` — 34 collapsed, 220 open, × to clear
- Align — ONE button cycling left → center → right

**Actions** (11501–11521)
- `Export` — filled accent + download glyph → `exportSelOpen` (modal @ **25601–25785**)
- divider
- FAST TRAQS cloud icon → `bcModalState = "open"` (modal @ **25028**)
- `+ New Job` (gated `can("editJobs")`) → `openNew()` @ **8505** → `renderModal()` @ **21529–23473**

---

## 2. Columns

`STD_COL_DEFS` @ **115** — 12 columns, `i` is the index into `colWidths`:

| i | id | label | align |
|---|----|-------|-------|
| 0 | name | Name | left |
| 1 | jobNum | # | left |
| 2 | client | Client | left |
| 3 | status | Status | left |
| 4 | pri | Priority | center |
| 5 | start | Start | left |
| 6 | end | End | left |
| 7 | due | Due | left |
| 8 | hrs | Hrs | right |
| 9 | progress | Progress | left |
| 10 | team | Team | left |
| 11 | appr | Approval | left |

All twelve exist on the Mac. `appr` was the last one added — `JobColumn` had
eleven cases and its cell drew nothing, which is what "a mapped column that does
nothing" referred to.

- `colWidths` default @ **4818**: `[26, 200, 80, 120, 132, 80, 100, 100, 100, 70, 130, 140, 200, 36]`
  — index 0 is a lead gutter, 1..12 are the std cols (`1 + col.i`), 13.. are custom, last is the `+` cell (36).
- `colOrder` @ **5021** — user-reorderable list of std col ids; deleting a column removes it from here.
- `colLabels` @ **5039** — per-column rename overrides.
- `colSort` @ **4610** — `{ id, dir }`; click a header cycles asc → desc → none.
- `GROUPABLE_STD` @ **~210** — `["status","pri","due","start","end","jobNum","hrs"]`

**Custom columns** — `customCols`, each `{ id, label, type, options?, fieldKey? }`
- types: `text` | `number` | `date` | `select` | `checkbox`
- `FIELD_COL_CATALOG` @ **91** — linked job fields:
  `poNumber` (PO #, text, 100) · `jobType` (Job Type, text, 110) · `hpd` (Hrs/Day, number, 80) ·
  `notes` (Notes, text, 180) · `color` (Color, text, 70) · `apprActivity` (Activity, **activity**, 210, read-only)
- `COL_TEMPLATES` @ **35** — Status/Priority/Phase/Category/Approval (select), Checkbox, Rating, Budget (number), Contact (text)

**Column header interactions** (12190–12235)
- `onMouseDown` → `startColDrag` (11774) — pointer-tracked reorder, 4px threshold,
  reorders only WITHIN its group (std vs custom); a non-drag becomes a **sort**
- `onContextMenu` → `colCtxMenu` (menu @ **26149–26304**)
- `onDoubleClick` → `renameCol` popover (@ **26120–26148**, draggable)
- resize grip → `startColResize` @ **5932**
- trailing `+` cell → `colPickerOpen` portal (@ **11368–11427**)

**Column picker** (11368–11427) — three sections:
1. *Link to Job Field* — `FIELD_COL_CATALOG`, already-added shown as "Added ✓"
2. *Templates* — `COL_TEMPLATES`
3. *Custom Column* — name input (Enter adds) + type `SimpleDrop` + Add button

**Column context menu** (26149–26304)
- *Edit Options* submenu — only for `status`/`pri` std cols and custom `select` cols.
  Per-option colour swatch + icon + name + delete; Add; Cancel/Save.
  Colour picker is **disabled** when `cellMode === "adaptive"` for std cols.
- *Rename Column*
- *Add Column Left* / *Add Column Right* — submenu with basic types + templates
- *Use for grouping* (checkbox) — `toggleColGroupable`
- *Delete Column*

---

## 3. Cells — `renderStdCell` @ 11832–12036

`level`: 0 job · 1 panel · 2 operation. `indent = level * 20`.

- **name** — caret (only if `subs.length`), `⠿` drag handle (L0, not select mode),
  select checkbox (L0 + select mode), unread-chat dot (L0, `unreadByThread`),
  level-1 / level-2 markers, title. **Double-click** → inline title edit.
- **jobNum** — L0 only, click → inline edit; `#1042` or `—`
- **client** — L0 colour dot + name; **L1 shows `{n} ops`**; L2 blank
- **status** — click → `statusPopover` at `placePopover(rect, STATUSES.length)`.
  Display status is `getOpDisplayStatus` (L2) / `getPanelDisplayStatus` (L1) / raw (L0)
- **pri** — click **cycles** (L0 only), no popover
- **start** / **end** — `PENDING` when the job is `scheduledLater`, else click → `TraqsDatePicker autoOpen compact`
- **due** — L0 only, `fm(date)` + ` !` when `< TD`
- **hrs** — `opHrs = round(hpd*10)/10` (NO ×days), panel = Σ ops, job = Σ panels.
  L1 also prints `/ {n} ops`
- **progress** — `{pct}%` + `finished/total ops` (L0) or `finished/total` (L1) + a bar, `pctRampColor(pct, "#94a3b8")`
- **team** — L0: up to 4 avatars + `+n`; L1/L2: first assignee avatar + first name
- **appr** — `apprStateFor(item, level, jobId, panelId)`
  - `kind === "rollup"` (job row): `{done}/{total}` + "approved" / "across n panels", not clickable
  - `kind === "chain"` (panel row): one chip per step; the first unsigned step is
    *active* and clickable only when `canApprove && (!assigneeId || assigneeId === me)`.
    `✓` signed / `●` active / `○` pending.
    **Right-click** → `approvalCtx` (menu @ **26952**): Edit Steps, Remove chain

**Custom cells** (12106–12173)
- `apprActivity` — computed, read-only, `apprActivityFor(...)`; verb + who + when
- `color` — L1 only, a swatch
- `checkbox` — toggle button
- `select` — click → `ccSelectPopover`
- everything else — click → inline edit (date uses `DateField square compact`)

**Conditional formatting** (12060–12074) — `orgSettings.conditions`,
`applyTo === "row"` → row bg + strike; `applyTo === "cell:{colKey}"` → bg, text
colour, bold, strike. Last matching condition wins. `evalCondition` @ **64**.

---

## 4. Rows

- Row bg: `selTask === id ? accent+"12" : transparent`; hover `accent+"0d"`
- **Drag to reorder** — L0 only, HTML5 drag, writes `taskOrder`
- **Click** — select-mode toggles selection, otherwise toggles expand
- **Right-click** → `handleCtx(e, item, "job-detail")` → `ctxMenu`
- Finished job rows render at `opacity 0.6`

### Row context menu — `ctxMenu` @ 27939–28077

Header: job title (op rows show the *job* title), `panel · op` subtitle, `start → end · Nh/day`,
and icon buttons: **Edit**, **Open Chat**, **Send Reminder**, and for ops with ≥2
siblings a **dependency-mode toggle** cycling free → unlocked → locked.

Items (each conditional):
| item | shown when |
|------|-----------|
| View Details | always |
| Take me to schedule | always |
| Add/Edit Dependencies | op with ≥2 sibling ops |
| Reschedule | `can("editJobs")` |
| Split Job | op, `hpd > 1`, not Finished |
| Set Worked Hours | op, not Finished |
| Request Completion | `liveChildCount === 0` |
| — divider — | |
| Delete | `can("editJobs")` |

Placement is **measured** (`ctxPlace` @ **8988**) — hidden until measured so it
never flashes in the wrong spot; flips up near the bottom edge; `overflowY: auto`.

---

## 5. Sections

Default: one section **per project manager**, in first-seen order of `orderedActive`,
`__none__` → "Unassigned". Header = chevron + avatar + name + count pill.
Collapse state in `pmSectionsCollapsed` (keyed by pm id).
Body animates via `grid-template-rows: 0fr ↔ 1fr`.

Then a **Finished** section (green, `#10b981`), built from `finishedTasks` (unfiltered).

**Grouping mode** (`grouping.length > 0`, 12326–12381) replaces PM sections:
- `person` — jobs where `personOnTask`, trimmed by `trimTaskToPerson` (only that
  person's ops, and only panels that keep ≥1 op)
- `client` — jobs with that `clientId`
- `column` — one section per distinct value; `valueForGrouping` (12293) +
  `sortBuckets` (12316: STATUSES order, High/Medium/Low, numeric, lexical; empties last)

A job may appear in several sections. `groupPrefix` namespaces expand keys so the
same job expanded in one section stays collapsed in another.

---

## 6. Popups / modals reachable from this page

| state | render | what |
|-------|--------|------|
| `colPickerOpen` | 11368 | add-column picker |
| `taskFilterOpen` | 11458 | filter dropdown |
| `grouping` | `GroupingSelect` | grouping dropdown |
| `statusPopover` | 26307 | status list |
| `ccSelectPopover` | 26333 | custom select list |
| `colCtxMenu` | 26149 | column header menu |
| `renameCol` | 26120 | draggable rename popover |
| `approvalCtx` | 26952 | approval chain menu |
| `ctxMenu` | 27939 | row menu |
| `finishApproval` | 26491 | "request completion" confirm |
| `bulkDeleteConfirm` | 29460 | delete N jobs |
| `confirmDelete` | — | delete one item |
| `exportSelOpen` | 25601 | export picker |
| `bcModalState` | 25028 | FAST TRAQS |
| `modal` | 21529 | New Job / Edit — **3-step wizard** |
| `depsModal` | 28080 | dependencies |
| `quickAddSub` | 28143 | add panel / op |
| `splitModal` / `workedHoursModal` / `reminderModal` | — | op tools |
| `confirmPush` | 28780 | "this move affects N other jobs" |

## 7. Animations

CSS keyframes defined inline at **11434** and in the global sheet:
- `toolDrop` / `toolDropUp` — menu rows, staggered `i * 38ms`
- `gridRowIn` / `gridRowOut` — row enter/exit; note the 3-stop max-height ramp
  and `overflow` flipping to `visible` only at 100%
- `menuIn` / `menuInUp` — popover 0.15s ease-out
- `anim-ctx` / `anim-ctx-up` — context menus
- `dropIn` — `cubic-bezier(0.34, 1.56, 0.64, 1)`, stagger `min(i,12) * 0.03s`
- `optFlash` — the 150ms flash before a status popover closes
- `FadeOnClose` — wraps most popovers so they fade out rather than vanish
- section collapse — `grid-template-rows` 0fr ↔ 1fr

`placePopover` @ **2333** — decides x/y/maxHeight/up from the anchor rect + row count.

---

## 8. Worklog

What has been done and why, newest concern last. The reference above is the
spec; this is the record.

### Landed

- **Expand lag.** `JobsProgress` (one bottom-up pass over every level) +
  `AppState.jobsProgressIndex` (roster indexed once, `Date()` read once). Was:
  three walks of the same operations, an O(roster) scan per operation, and a
  percent map that changed shape on every expand so every cell on the page
  invalidated. Sort comparators now read the same index instead of re-walking.
  `Color(hex:)` no longer allocates a `CharacterSet`, a `String` and a `Scanner`
  per call — it was doing that several times per cell.
- **Unmodelled-field loss** — see below.
- **Row right-click menu**: `TQContextMenu` (card, `ctxMenuIn` keyframes, 38ms
  row cascade that reverses when flipped up, AppKit right-click catcher),
  `MenuPlacement` (port of `menuPlacement.js` + `placePopover`), `JobsRowMenu`,
  18 new glyphs. Live: Request Completion, Delete (with confirm), the
  dependency-mode toggle, Open Chat, Take me to schedule. Drawn-and-disabled
  with a reason: View Details, Reschedule, Split Job, Set Worked Hours,
  Add/Edit Dependencies, Edit, Send Reminder — each needs a modal that is not
  ported.

### Landed — the cell audit (2026-09-04)

An audit of every interactive control on the page against the web, prompted by
"some dropdowns on the cells don't actually do anything". Four were wrong; the
rest of the page's controls are wired or honestly disabled. What changed:

- **The cell popovers were dead.** Reported as "pressing the dropdown options
  aren't changing when clicked", and it was two separate faults in the same path.

  *The popovers were installed conditionally* — `if statusOpen { Color.clear
  .popover(isPresented: $statusOpen) }` — to save a presentation anchor on every
  cell of every row. That destroys the ANCHOR in the same update that flips the
  binding, so a dismissal races its own presenter: the list stays on screen with
  its state frozen, and every later click lands on a view no longer in the
  hierarchy. The tell was on this page already — the toolbar's Filter popover is
  attached unconditionally and had always worked, while all five cell popovers
  were conditional and all five were dead. Now unconditional. An unpresented
  `.popover` is a modifier, not a window; if four per row ever measures, the fix
  is one popover for the whole grid keyed by which cell is open, NOT the `if`.

  *`JobsOptionList.flashing` was never cleared.* The tap guard refuses a pick
  while it is set, and the justification for leaving it set was "picking closes
  the popover, so the row goes away" — an assumption about SwiftUI view lifetime
  that nothing guarantees. It is cleared after the pick now. The reason it was
  not is real, so the keyframe trigger moved to `flashTick`, a counter that only
  goes up: clearing `flashing` would otherwise flip the trigger a second time and
  replay the flash on the way out.

- **Panel and operation Status pills showed the STORED status.** The web derives
  it: `getOpDisplayStatus` reads logged hours and live job clocks, and
  `getPanelDisplayStatus` rolls a panel up from its operations' derived values.
  A panel with hours against it and someone clocked in read "Not Started" on the
  Mac. Ported as `Services/JobsDisplayStatus.swift` (pure) plus
  `AppState.jobsDisplayStatusIndex`, indexed once per redraw into
  `JobsCellContext` — the same shape and the same reason as `JobsProgress`.
  `Paused` is display-only and is NOT a `JobStatus` case: folding it in would put
  it in `allCases` and therefore into every picker on both platforms.
  The level-1 name dot reads the same value, so pill and dot cannot disagree.

  **A PICKED STATUS WINS — a deliberate divergence, decided by the user.** The
  first cut of this ported the web's precedence exactly, and the web's precedence
  makes the status dropdown a control that writes a value nothing displays:
  `getOpDisplayStatus` overrides the stored status on any operation with hours
  against it, and `getPanelDisplayStatus` ignores `panel.status` outright whenever
  the panel has operations. Measured, before the change:

  | row | pick "In Progress" | stored after | pill after |
  |---|---|---|---|
  | job | ✓ | In Progress | **In Progress** |
  | panel (2 ops) | ✓ | In Progress | **Paused** |
  | op (3h logged) | ✓ | In Progress | **Paused** |

  The order is now: **Finished > a live clock > a stored status other than Not
  Started > Paused > Not Started**, with `Not Started` standing for "nobody has
  said anything" — the only stored value the derivation may overrule. For a panel,
  all-operations-finished still comes first, so a stale "In Progress" cannot
  outlive the work. A panel-level clock now marks the panel too, which the web
  drops entirely once the panel has operations.

  Pinned by `JobsDisplayStatusTests`, which marks which cases are parity and which
  are the divergence.
- **Start / End were editable on a job still in TRAQS Cloud.** The web prints an
  amber `PENDING` and makes the cell inert (`!isScheduledLater && startEdit`).
  The Mac drew the (empty) date and opened a picker that wrote one, half-scheduling
  a job behind the scheduler's back. `JobsCloudSheet.isScheduledLater` is now the
  one reader of that flag and the grid asks it at every level via `row.jobID`.
- **An admin could not set Finished from the grid.** `needsCompletionRequest` sent
  EVERY move to Finished through a completion request; for an admin that notifies
  the admins — themselves — and leaves the status untouched. The web's popover
  writes the status and special-cases Finished only for a non-admin. Now
  admin-gated. Deliberate divergence for the other half: where the web ignores a
  non-admin's click entirely (with a comment telling them to use the row menu),
  the Mac raises the request for them — a dead click in a dropdown is
  indistinguishable from a bug.
- **"Use for grouping" was a live checkbox wired to nothing.** It toggled, it
  persisted to `tq_col_order`'s sibling `tq_group_cols`, and no code path on the
  page has ever read it, because grouping is not ported. Now drawn-and-disabled
  with a reason, like every other unported action. `JobsColumnMenuRow` gained
  `enabled` / `help` to say so.

Still dead, and now the top of the list because they are what "mapped but does
nothing" refers to: the **Activity** column (a linked column that always draws an
em dash) and the **Approval** column, which does not exist on the Mac at all —
`JobColumn` has eleven cases and the web's `STD_COL_DEFS` has twelve. Both need
the approval subsystem (§3, and item 1 in *Pick up in this order*).

### Landed — the approval subsystem (§3, item 1)

The Approval column, the Activity column, and the four writers behind them.

**`Services/JobsApproval.swift`** (pure) is the typed view over the three keys the
web keeps on a panel — `apprChain`, `signOffs`, `apprLog`. None of them is a
modelled property and none of them became one: promoting a field means adding it
to `CodingKeys` AND `encode(to:)` with nothing enforcing the pair, which is the
one documented footgun in this model layer and how the approval data was destroyed
the first time. The passthrough already round-trips them, so this reads and writes
through `Panel.extras` instead. `JSONValue.decoded(_:)` / `.encoding(_:)` bridge
the two.

A panel runs AT MOST ONE chain, in the web's precedence: `apprChain` supersedes a
sign-off template's `signOffs`, which supersedes the seeded `engineering` steps.
`ApprovalKind` names which, and `signing` dispatches on it — so the chips and the
write cannot disagree about which chain is showing. The web has three separate
sign functions and picks between them at the cell (`st.sign(i)`).

Notes worth keeping:

- **`Paused` is not a `JobStatus`.** Same rule as the display statuses below: it
  is display-only, so folding it into the enum would put it in `allCases` and
  therefore into every status picker on both platforms.
- **`panel.engineering !== undefined` is the KEY, not a truthy value.** Swift
  cannot tell an absent key from an explicit null through `decodeIfPresent` — but
  every place the web seeds it writes an object (`{designed: null, …}`) and never
  a literal null, so `engineering != nil` is the same test.
- **Reverting cascades to every later step**, for all three shapes. The web
  implements it for the engineering chain (`stepOrder.slice(stepIdx)`) and for a
  template (`Number(k) >= stepIdx`), and a custom chain had no revert at all. One
  rule instead of a fourth: a chain whose second step is signed and whose first is
  not describes an approval that never happened.
- **A signed step cannot be re-signed.** Not in the web either, because only the
  first UNSIGNED step is clickable — but the rule is stated here rather than left
  to the cell, since it is the one outcome that forges a signature.
- **Editing the steps keeps the signatures.** `editableSteps` converts whichever
  shape is running into `ApprovalChainStep`s with `done`/`by`/`byName`/`at`
  carried across, which is what the web's `seed` builds. Saving PROMOTES the panel
  to a custom `apprChain` — intended, and why "Reset to default steps" exists.
- **Approval does not sort.** The web's comparator falls through to `return 0`, so
  clicking that header there parks the sort arrow on a column that orders nothing.
  `JobColumn.isSortable` refuses it instead.
- `AppState+Approval.swift` holds the impure half — who is signing, the write, and
  the two notifications (`step` always, `ready` when that signature was the last
  one outstanding), read from the UPDATED job exactly as the web does.

**Tested**: `JobsApprovalTests` — 20 cases over the three shapes, the permission
rules, the revert cascade, the rollup, the activity fallback, the log cap, and
(twice) that a write keeps the panel's and the step's unmodelled fields.

### Landed — making the approval columns affordable

The port above was correct and unusably slow: an edit took several seconds to
appear on screen. The write was instant; the redraw behind it was not. Measured on
240 panels / 1440 operations, each panel carrying a chain and a full twenty-entry
trail, release build:

| per redraw | before | after |
|---|---|---|
| `jobsProgressIndex` (existing) | 0.2 ms | 0.2 ms |
| display-status index | 0.2 ms | 0.2 ms |
| approval index | 45.3 ms | — |
| activity index | 762.7 ms | — |
| approval + activity, one pass | — | **2.1 ms** |

A frame is 16 ms. Four things were wrong, in descending order of cost:

1. **`JSONValue.decoded(_:)` round-trips through `JSONEncoder` + `JSONDecoder`.**
   That is the right tool for something read once and the wrong one for something
   read per row per frame — it was one encoder AND one decoder allocation per
   chain step and per log entry, per panel, per redraw. The hot path now reads
   fields off the `JSONValue` tree by hand (`ApprovalChainStep(json:)` and
   friends). Encoding still goes through Codable: a write happens once per click.
2. **The Activity pass repeated the Approval pass.** `activity(ofPanel:)` derived
   the panel's state again as its fallback, and `activity(ofJob:)` derived every
   panel's state again to build the rollup. Both now take what has already been
   computed, and `AppState.jobsApprovalIndex` returns states and activity from ONE
   walk.
3. **`signOffTemplates` was decoded per panel.** `ApprovalContext` resolves the
   templates and the three engineering labels once for the page.
4. **`ISO8601DateFormatter` on every ordering test.** "Is this newer" runs once per
   log entry per panel per redraw, and the common (fractional) form failed the
   first formatter before the second succeeded, so it paid for two.
   `ApprovalDate.sortKey` reads the digits out of the `…Z` form this app always
   writes and converts with `days_from_civil`; anything carrying a real offset
   (`+02:00`) still falls back to the formatter, because a digit scan would
   misread it.

**Two bugs were found while doing this, both by tests rather than by reading:**

- A first cut packed the date digits into a key rather than computing epoch
  seconds. It overflowed the 2^53 where a `Double` still counts in ones — so
  milliseconds fell off — and put the fast path on a different SCALE from the
  formatter fallback, so comparing one of each always said the packed one was
  newer.
- `newestLogEntry` broke ties with a strict `>`. The trail is append-only and
  sign-then-revert in one gesture writes two entries in the same millisecond, so
  the Activity column reported "Signed" for an approval that had just been
  reverted — the exact failure the log exists to prevent. Ties now go to the later
  element. An ad-hoc harness missed this because its operations were spread out in
  time; the real test caught it because they were not.

### Landed — the write path, and how to measure any of this

Two more costs on the edit path, both pre-existing, both found by benchmark.

**`cacheJobsLocally` rewrote the whole table on every cell edit.** It encoded
EVERY job — 46 ms of JSON for 200 jobs, measured, with a fresh `JSONEncoder`
allocated per job on top — and then stamped `lastModifiedAt: now` on all of them,
which defeats the no-op skip inside `LocalCache.applyBatch`. That skip exists for
precisely this reason; its own comment says "SwiftData writes run on the main
actor, so rewriting the entire delta every sync stalls the UI". A fresh stamp on
every job makes `inLM == curLM` false for every job, so one status pick rewrote
and re-saved every row in the table, on the main actor, before the frame could
draw. `updateJobs` now takes `changedIDs`, and `updateJob` — the path every grid
cell edit takes — names the one job it touched.

**`applyBatch` fetched every cached row even for a batch of one.** Right for a
sync delta, which touches most of the table; wrong for the write behind one cell
edit. Batches of 32 or fewer now fetch only the rows they name. Measured against a
real SwiftData container, 200 cached jobs at 13 KB each:

| | before | after |
|---|---|---|
| encode for the cache | 46.4 ms | 0.2 ms |
| `applyBatch` | 15.8 ms | 0.5 ms |

**`TQPerf`** exists because the numbers that mattered were always the ones from
the real dataset on the real machine, and there was no way to get them. Set
`TRAQS_PERF=1` in the scheme's environment and the Jobs page reports any span over
2 ms (`TRAQS_PERF_MS` to change it) — the whole cell context, each of its three
indexes, the filter-and-sort, and the cache write — with the page's shape on every
line. It also emits Instruments signposts under `com.traqs.perf`. Off, it compiles
to a straight call. Deliberately an env var and not `#if DEBUG`: the interesting
case is a release build over a real org's data, which is where `#if DEBUG` would
compile it out.

**Not yet measured, and the next place to look if it is still slow:** the view
layer. The section's `LazyVStack` has no vertical scroll ancestor and builds every
row eagerly (see *Measuring the page width*), and each row is now TWELVE cells
rather than eleven. Four of those cells carry an unconditional `.popover` since
the dismissal fix. If the numbers point there, the answer is the one already
written down — ONE popover for the whole grid, keyed by which cell is open and
anchored with `attachmentAnchor: .rect(.rect(cellRect))`, which the grid can
compute exactly because row height and column widths are constants. Not done
speculatively: a headless `NSHostingView` harness could not be made to measure it,
and a refactor of every cell on a guess is how the last three rounds went.

### Landed — the three that looked broken

Picked as a set because each was a control that read as a bug rather than as a
missing feature.

**The `⠿` drag handle now drags.** It was drawn on every job row and inert — the
one affordance on the row that says "drag me" was the only thing that could not
be. `JobsQuery.applyingManualOrder` / `movingInManualOrder` are the rules (pure,
`JobsManualOrderTests`), the handle is the drag source and the whole row is the
drop target with a 2pt accent rule at the landing edge.

Two deliberate narrowings from the web:

* Only the HANDLE starts a drag, where the web makes the entire row draggable.
  The row already owns a tap (expand / select), a right-click and four cells that
  open pickers, and a whole-row drag competes with all of them.
* The order is SESSION-ONLY — and so is the web's. `taskOrder` is `useState([])`
  there and is not in the bundle `saveUserSettings` persists. Worth stating
  because it looks like an omission.

`movingInManualOrder` re-finds the target AFTER removing the dragged id rather
than splicing at a pre-removal index. Same answer as the web in both directions —
verified case by case — but it stays right without the reader redoing that
arithmetic. A first version of the comment claimed the web was off by one; it is
not, and the test that "caught" it was my own wrong expectation.

**Custom columns reach the server.** `APIService.saveOrgSettings` had existed all
along with nothing calling it, so a column added here lived in memory until the
next settings fetch and then vanished — which reads as the app losing your work.
`AppState.updateOrgSettings` is optimistic and rolls back on a failed POST, which
is the opposite of the jobs path and deliberate: settings are one small object
with no debounce and no undo stack, so the honest thing on failure is to put it
back. Two things already in place made this safe to add — the `JSONExtras`
passthrough on `OrgSettings` (the endpoint REPLACES the object, so a POST from
Swift would otherwise destroy `conditions`, `statusOpts`, `signOffTemplates` …)
and the server's `requirePerm(member, "orgSettings")` gate, which `canEditColumns`
now asks BEFORE offering Add / Delete / Edit Options rather than after a 403.

**Edit Options works for Status and Priority — colour and glyph only.**

The scoping here is the interesting part, and it corrected a wrong assumption:
`statusOpts` / `priOpts` are **per-user**, not org settings. On the web they sit
in `localStorage` beside `colOrder` and go up in the `saveUserSettings` bundle, so
they belong in `JobsColumnStore` with the rest of the per-device half — stored
under the web's own `tq_status_opts` / `tq_pri_opts` keys.

Names, adding and deleting stay locked, and that is a REAL CONSTRAINT rather than
unfinished work: the web stores a job's status as a free string, so renaming an
option there rewrites what every job means. Swift models it as `enum JobStatus`,
so a renamed or invented status has no case to decode into —
`JobStatus(rawValue:)` returns nil and the value is lost on the next save.
`JobsColumnStore.merged` enforces it at the storage layer too, taking only colour
and glyph by position whatever the editor passes, so a future caller cannot
bypass the UI lock. Lifting it means making status a string throughout the model
layer on both platforms; that is its own piece of work.

The pills, the level-1 dot, the priority chip and the status picker all read the
palette through `JobsCellContext`, merged over `JobPalette` exactly as the web
merges `statusOpts` over `DEFAULT_STA_C`.

### The unmodelled-field bug (fixed)

`APIService.saveJobs` encodes `[Job]` with `JSONEncoder` and POSTs it;
`netlify/functions/tasks.js` replaces the array rather than merging field by
field. Codable's synthesised `encode` writes only what a struct models — so every
key Swift did not name was **destroyed on any save**:

| level | lost |
|-------|------|
| Panel | `apprChain`, `apprComments`, `apprLog`, `signOffs`, `depsMode`, `requiredDepartment`, `color`, `qty`, `startHour`, `endHour`, `dateOverridden`, `moveLog` |
| Operation | `color`, `qty`, `startHour`, `endHour`, `requiredDepartment`, `requiredRole`, `depsMode`, `placedSubs` |
| Job | `requiredDepartment`, `createdAt`, `scheduledLater`, `customOps`, **and every `_cc_<id>` custom-column value** |

Fixed by `JSONExtras` (`Models/JSONPassthrough.swift`): each of the three
captures every key it does not model and writes it back first, so a modelled
field always wins and nothing else is touched. Job / Panel / Operation now have
explicit `CaseIterable` `CodingKeys` and hand-written `encode(to:)`.

**If you add a stored property to any of those three, add it to `CodingKeys` AND
to `encode(to:)`.** Nothing enforces it at compile time.

### Landed — the column system (§2)

- `JobsColumns.swift` (pure, in Services): `JobsColumnLayout` — order, widths,
  rename overrides, custom columns, grouping preference. Every mutation returns a
  new layout; standard and custom columns are two runs and a column can only be
  dragged within its own. `JobsFieldCatalog` and `JobsColumnTemplates` are the
  web's `FIELD_COL_CATALOG` and `COL_TEMPLATES`.
- `JobsColumnStore.swift`: the same split the web uses — order / renames / widths
  / grouping preference to `UserDefaults` under the web's own key names
  (`tq_col_order`, …), custom columns to `orgSettings.customCols`.
- Header: click to sort, drag to reorder (4px threshold, so a click still sorts),
  a resize grip with the right cursor, right-click for the menu, double-click to
  rename, and a live `+` cell.
- `JobsColumnMenu.swift`: Edit Options (with the colour/icon/name editor),
  Rename, Add Column Left/Right with the type and template palette, Use for
  grouping, Delete Column. Plus the rename popover and the `+` picker.
- `JobsCustomCell.swift`: all six custom types — text, number, date, select,
  checkbox, activity — plus the `color` swatch special case. `JobsCustomValue`
  is the one place that knows a LINKED column writes a real job field and an
  invented one writes `_cc_<id>` into `extras`.
- `OrgSettings` now models `customCols` and carries `JSONExtras`.

Two things about it are deliberately half-done and say so in the code:

* **Adding a column does not reach the server.** It writes
  `AppState.orgSettings` and nothing posts org settings yet, so a new column
  survives until the next settings fetch. `OrgSettings`'s passthrough is in place
  so adding that write cannot destroy `conditions` / `statusOpts` / the rest.
* **The Activity column draws an em dash.** `panel.extras["apprChain"]` survives
  a save now, but nothing reads it.

### Modals (§6) — partly landed

- `TQModal` — scrim + card with the web's `bcModalState` three-phase lifecycle.
  Entering, the blur and the card come together; LEAVING, the card goes first and
  the scrim's blur only starts lifting once it is gone (`TQModalTiming`, four
  numbers in one place). `TQModalPresenter` owns the phase so a modal outlives its
  own dismissal long enough to play the exit — without it a modal vanished on the
  frame it was dismissed.
- **Export** (`exportSelOpen`) — real. CSV and Word write files through a save
  panel, built from the web's `flatRows` (one row per operation, inheriting job
  and panel columns). PDF is drawn and disabled: the web's is a page-layout
  designer, not a document.
- **TRAQS Cloud** (`bcModalState`) — the jobs-pending-scheduling list. Only
  possible now that `scheduledLater` survives a save.
- **New Job** — steps 1 and 2, ending at the web's own "Save for Later"
  (`:22801`), which writes the job with `scheduledLater: true`. Quantity expansion
  ported. Step 3 (availability check, AI suggestion, packer) is disabled.

### Known, not addressed

- `Color.perceivedBrightness` / `readableText` are `#if canImport(UIKit)` and
  return a constant 128 / always-white on macOS. Any Mac surface relying on
  `readableText` for contrast is not actually deciding anything.
### Measuring the page width — read this before touching the grid's layout

Horizontal scrolling never worked, and it took three wrong fixes to find out why.
The section decides whether to install a horizontal scroller by comparing the
room it has against `totalWidth` (1288pt of columns). Getting "the room it has"
is the hard part: **any view whose subtree contains the grid reports the grid's
width, not the window's.**

Measured, not assumed:

| measured on | window | reports |
|---|---|---|
| `.frame(maxWidth: .infinity)` around 1288pt content, proposed 1100 | — | **1288** |
| `ScrollView(.vertical)` with 1288pt content | 1164 | **1352** |
| `GeometryReader` | 1164 | **1164** |

`.frame(maxWidth: .infinity)` GROWS to a wider child rather than clamping it, and
a vertical `ScrollView` does the same horizontally. Only `GeometryReader` reports
the proposal, because it never sizes to its content — so `JobsPage.body` is one,
and `availableWidth` is handed DOWN to each section rather than measured there.

- With the scroller now actually installed, the section's `LazyVStack` has no
  vertical scroll ancestor and builds every row eagerly. Mitigated by stating the
  grid's height (rows are a fixed 36pt), so nothing has to be measured to lay it
  out — but the rows are still all built. Fixing it properly means hoisting
  horizontal scrolling to the page, which puts every section's column headers in
  one shared scroller.
- The modal blur is applied to the PAGE (`.blur` on the content, before the sheet
  overlay), not left to the scrim's `Material`. A Material sampling a page inside
  a clipped, rounded panel produced no visible blur. It covers the page panel
  only, not the sidebar or brand strip — the web's `modalBlur` also blurs those.
