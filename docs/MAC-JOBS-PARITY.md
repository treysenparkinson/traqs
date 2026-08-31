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

1. **Standard-cell parity** (§3) — the Approval column above all. It can now read
   `panel.extras["apprChain"]` / `["signOffs"]`; nothing does yet, so the Activity
   column draws an em dash.
2. **Conditional formatting** (§3) — needs `orgSettings.conditions`, which is
   already surviving in `extras`.
3. **Grouping** (§5) — by person, client, or column value.
4. **The org-settings write path.** Adding a custom column writes
   `AppState.orgSettings` but nothing POSTs settings, so a new column vanishes at
   the next fetch. `OrgSettings` already carries its passthrough, so the write can
   be added safely.
5. **The wizard's scheduling step** (§6) — availability check, AI suggestion,
   packer. The biggest remaining piece.
6. Row drag-reordering, and the engineering / sign-off queues above the grid.

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

- `swiftc -parse <file>` — catches syntax errors with no module context.
- A standalone `swift` script for anything pure (`JobsColumnLayout`,
  `JSONExtras`, `JobsProgress`) — stub the two or three types it needs.
- An `NSHostingView` in a borderless `NSWindow`, laid out and printed from a
  `GeometryReader`, for **layout questions**. This is how the width table below
  was produced, and it is the only reason that bug got found.

`swiftc -parse` does NOT catch type errors, overload ambiguity, or actor
isolation — three build failures got through on parse-clean code.

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
