# TRAQS — Complete Feature Inventory (as built, 2026-09-22)

Unclassified by tier, by design. Grouped by page/surface. Source of truth is the
React web app (`src/TRAQS.jsx`, `src/App.jsx`); the iOS and macOS ports are
listed separately at the end with their parity gaps, since a tier split has to
be enforced on all three.

---

## 0. Cross-cutting (no single page owns these)

| Feature | What it does |
|---|---|
| Auth0 login | Email-based sign-in; token feeds every authenticated API call. |
| Org code identity | Org is addressed by a short code; stored in `localStorage` so it survives relaunch. |
| Org creation | Self-serve: org name, code, admin email, email domain (`POST /org`). |
| Forgot org code | Emails the code to a registered admin address (`forgot-org.js`). |
| Switch organization | Leave the current org code and enter another without logging out. |
| Email-domain gate | Sign-ins whose email domain doesn't match the org's are rejected ("Email domain mismatch"). |
| Roster gate | A logged-in email not on the people roster is refused ("Not in team roster"). |
| PIN auth | Per-person numeric PIN; the kiosk/time-clock write path authenticates by PIN rather than Bearer. |
| Granular admin permissions | 9 server-enforced toggles: `editJobs`, `moveJobs`, `reassign`, `manageTeam`, `manageClients`, `undoHistory`, `orgSettings`, `approveCompletions`, `approveTimeOff`. |
| Role flags | `isAdmin`, `isEngineer`, `canSignOff`, `canClockInOut` — separate from the permission toggles. |
| Delta sync | `sync.js` returns per-entity deltas with a cursor; 30s poll plus event-driven refetch. |
| Realtime push | Ably channel per org; a `changed` event triggers an immediate delta sync. |
| Offline cache | IndexedDB rehydrate on cold open, so the app paints before the network answers. |
| Soft deletes / tombstones | `deletedAt` on records; `filterLive` keeps tombstoned people out of notification targeting. |
| Undo stack | 50-deep in-memory undo of schedule mutations, gated by the `undoHistory` permission. |
| Push notifications | OneSignal + Web Push. Types: `new_job`, `assigned`, `step`, `ready`, `finish_request`, `completion_resolved`. |
| Attachments | S3-backed upload/download via `/api/attachment`; job-panel photos and message files. |
| Theming | Light / Dark / System / Custom; accent, surface, button and highlight colors; background as color, image or "liquid"; card opacity/frost; saved theme presets. |
| Toast + confirm system | App-wide transient toasts and confirm modals. |
| Responsive split | `<768px` renders a separate mobile app shell with its own nav. |

### AI features
| Feature | What it does |
|---|---|
| FAST TRAQS import | One pipeline for pasted text + Excel/CSV/PDF/image/.txt files → Claude with a `submit_extraction` tool → editable preview → commit. Auto-detects import vs update intent. |
| FAST TRAQS guards | Per-file and total size caps, per-file conversion errors surfaced without failing the batch. |
| Ask TRAQS | Side panel (FAB on mobile) that answers questions about org data and can propose actions; actions are described in plain English and require explicit confirmation before executing. |
| AI schedule suggestion | In the job wizard, proposes assignments/dates; user accepts or overrides. |
| Streaming transport | `ai-schedule` runs as a Netlify **Edge** Function to stream SSE past the 504 inactivity timeout; client uses a 45s idle-reset abort. |

---

## 1. Login & Onboarding (`src/App.jsx`)

| Feature | What it does |
|---|---|
| Org code screen | First-run entry point; remembers the code afterwards. |
| Create Organization | Org name, code, admin email, email domain. |
| Admin Login | Auth0 sign-in for admins. |
| Send My Org Code | Recovery email flow. |
| Roster / person picker | Pick yourself from the team roster to reach the PIN pad. |
| PIN pad | Numeric PIN entry for kiosk-mode clock actions. |
| Shift action screen | Start your shift / Clock In / Clock Out / Lunch / End of Day / Resume work, straight from the gate. |
| Wrong-account recovery | "Wrong account" / "Back to Sign In" escape hatches. |
| Splash / load-up | Branded splash while org config and roster resolve. |

---

## 2. Dashboard (`renderDashboard`, `:14044`)

Everything is derived from data already in memory — no extra fetches.

| Feature | What it does |
|---|---|
| Greeting animation | Org-name greeting that travels to the header, then staggers the cards in. |
| Rotating stat panel | Cycles six KPIs: hours logged this pay period, active jobs, jobs on time %, average completion %, on the clock right now (n/total), jobs due within 7 days. |
| Team right now | Live roster bucketed into On a job / Idle / On lunch / On break / Offline. |
| On the clock | Count of clocked-in people against team size. |
| My clock | Personal Clock in / Clock out / Start–End lunch / Start–End break, with the "log out of your job first" guard. |
| Job clock indicator | Shows when the viewer has a job clock running. |
| Today strip | Per-person timeline of today's punches against the org's work-hours window, with hour ticks and a "now" marker. |
| Month calendar | Current month with "busy" days marked from job date spans. |
| Due within 7 days | Upcoming job list. |
| Messages panel | Most recent threads (DM / group / job chat) with unread counts and relative timestamps. |

---

## 3. Jobs (`renderTasks`, `:12408`)

The main work surface: a filterable job table on top, job detail below/beside.

### Table
| Feature | What it does |
|---|---|
| Three-level hierarchy | Job → Panel → Operation, expandable inline. |
| Standard columns | Name, #, Client, Status, Priority, Start, End, Due, Hrs, Progress, Team, Approval. |
| Column reorder | Drag to reorder; order persists per user. |
| Column rename | Rename any standard or custom column. |
| Column resize | Drag handles on the header. |
| Custom columns | Add Text / Number / Date / Dropdown(List) / Approval columns; edit options; link a dropdown to a job field. |
| Inline cell editing | Edit in place; every commit path routes through one recorder so select-popover edits are logged like typed ones. |
| Grouping | Group rows by client or by any groupable standard/custom column; per-column groupable toggle; collapsible group sections. |
| Filtering | Status, client, time period, team/unassigned, plus per-custom-column filters; "Clear all filters". |
| Search | Free-text across job fields. |
| Sorting | Column sort. |
| Multi-select | Select mode with All/None and bulk delete. |
| Copy / cut / paste | Duplicate or move jobs, panels and ops; clipboard indicator with "Clear clipboard". |
| Context menu | Right-click on rows and headers; measured-height placement. |
| Overdue / pending badges | Row-level `OVERDUE` and `PENDING` flags. |
| Date-override marker | Shows when a scheduled date was manually overridden. |
| Empty state | "Create a job or use FAST TRAQS to import". |

### Job detail
| Feature | What it does |
|---|---|
| Detail pane | Resizable split beside the table, or full-page. |
| Job Details tab | Name, job number, PO number, client, project manager, priority, status, start/end, customer due date, hours/day, color, notes. |
| Project Plan | Phase/panel plan view with per-node status chips and a computed plan window. |
| Operations list | Per-panel ops with dates, hours, assignee, department. |
| Timeline / Gantt tab | Per-job Gantt. |
| Hours tab | Hours worked vs estimated; hours by person; hours by panel; hours/day; session list. |
| Job Log | Audit trail of edits, moves, approvals and sign-offs. |
| Attachments | Per-panel photo upload, gallery and delete. |
| Job chat | Opens the job's message thread. |
| Dependencies | Link ops so one must finish before another; dependency mode with unlink; dependent items cascade when a predecessor moves. |
| Lock / unlock | Pin an op so optimization and cascades won't move it. |
| Custom fields | Per-job custom field values. |

### Engineering & approvals
| Feature | What it does |
|---|---|
| Engineering sign-off | Three fixed steps — Designed / Verified / Sent to Perforex — each storing `{by, byName, at}`. |
| Revert engineering | Reverts a step and every subsequent step. |
| Approval chains | Arbitrary per-panel step chains with label, assignee, department and due date. |
| Approval templates | Reusable chains defined in Settings and applied to panels. |
| Chain sign / revert | Sign a step if you hold approval rights or are its assignee; admins can revert. |
| Approval comments | Threaded comments keyed to a chain step. |
| Approval activity log | Per-panel history of chain edits, signs and reverts. |
| Finish requests | A worker requests completion of an op; admins approve, decline (with reason) or undo. |
| Completion Requests group | Auto-maintained message group whose audience is admins holding `approveCompletions`. |
| Admin finish | An admin can finish an item directly. |
| "Ready" notification | Fires when all three engineering steps are done. |

### Exports
| Feature | What it does |
|---|---|
| Export jobs | PDF, CSV or Word, scoped to one job or a selection. |
| PDF layout designer | Freeform multi-page canvas: drag/resize blocks (title, subtitle, text, logo, image, job, panel, summary, notes, attachments, hours, legend), portrait/landscape, grid + snap, auto-fit block heights, logo upload, undo/redo (80 deep). |
| Job templates | Save an operation set as a named template and reuse it on new jobs. |

---

## 4. Schedule (`renderTeam`, `:14744`) and Gantt (`renderGantt`, `:11063`)

### Team schedule (people × days)
| Feature | What it does |
|---|---|
| Day / Week / Month views | `tMode`; month has an extra zoom control. |
| People × days grid | One row per person, bars for assigned operations. |
| Bar types | `task` (scheduled ops), `pto` (PTO/UTO hatching — UTO amber, PTO green). |
| Drag to move | Move a bar in time; drop on another person's row to reassign. |
| Drag edges | Resize from the left (start hour + hours) or right (hours). |
| Row reorder | Drag people to reorder the roster. |
| Pending-item drop | Drag an unscheduled item onto a person/day to schedule it. |
| Cascade push | Moving or overrunning a bar pushes the rest of that person's row; preview ghost shows where it lands and at what time. |
| Pull-back | Moving a bar earlier pulls following work back. |
| Clock cascade | A live job clock that overruns its estimate pushes the rest of the row in real time. |
| Session snapshot / revert | Each cascade session is snapshotted so it can be reverted wholesale. |
| Optimize | `runOptimize` / `computeJobOptimize` re-packs a job's ops into the next available slots. |
| Overlap detection | Warns when an assignment collides with existing work or PTO. |
| Availability check | Pre-flight check before committing an assignment. |
| Department lock | When a subtask has a department, the assignee list is filtered to that department's members. |
| Lock bars | Locked ops are excluded from moves and optimization. |
| Multi-select bars | Select mode with All/None, selected count and bulk delete. |
| Filters | Status, client, search, "Show completed work". |
| Live indicator | `LIVE` badge on rows with an active clock. |
| Clock pills | Per-person and per-group clock-state pill; groups report how many members are clocked in. |
| Schedule time off | Create PTO/UTO for the crew from the schedule. |
| Reset zoom | Restores default zoom. |
| Confirm move | Confirmation step on drag commits. |

### Job Gantt
| Feature | What it does |
|---|---|
| Day / Week / Month | `gMode` with period back/forward navigation and a period label. |
| Job and panel bars | Drag to move jobs or panels; work-day shading for non-working days. |
| Split view | Job list beside the Gantt (`renderSplitGantt`), with a draggable divider. |
| Dependency arrows | Rendered between linked items. |
| Zoom | Timeline zoom control. |
| PTO overlay | PTO bands drawn behind the job bars. |

---

## 5. Employees (`renderEmployees`, `:17936`)

One person's complete picture. Panels marked ▲ are job-derived and render empty in an org with no jobs.

| Feature | What it does |
|---|---|
| Person header | Name, email, phone, primary + secondary department, avatar. |
| Status | Live clock state. |
| Performance ▲ | Efficiency and utilization, from job data. |
| Schedule ▲ | Upcoming assigned work. |
| This week ▲ | This week's assignments. |
| Available | Availability summary. |
| Assigned Queue ▲ | Outstanding assigned operations. |
| Current Job / Current Task / Current Work ▲ | What they're on right now. |
| Time History | Payroll punches from `timeclock`. |
| PTO / Attendance | Time-off record and attendance. |
| Upcoming PTO | Approved future time off. |
| Reviews / Notes | Free-text admin notes with add/delete; reviews render an explicit empty state (no data model). |
| Remove | Delete the person; strips them from every job/panel/op team array. |

---

## 6. Time Clock (`renderTimeStamp`, `:18718`)

### Worker
| Feature | What it does |
|---|---|
| Clock in / out | Pay-shift punches, with lunch/break tracking. |
| Lunch / break | Start–End Lunch, Start–End Break; visibility controlled by org settings. |
| Kiosk source | Punches made through the PIN gate are tagged `source:"kiosk"`. |
| Clock-out guard | Cannot clock out with a job clock still running. |
| Clock-in gate | `canClockInOut` can be revoked; clock-**out** is never blocked. |
| Job clock | Start/End job work with pause and resume; separate from the pay clock. |
| Start-job picker | Searchable job → panel → op picker grouped into Your Jobs / Upcoming Jobs / Other Jobs, auto-expanding while searching. |
| Working On | Current job clock with elapsed time. |
| Confirm clock-in | Confirmation step before the punch. |
| Break reminder | Prompts when a break policy applies. |

### Admin
| Feature | What it does |
|---|---|
| Team Status tab | Org-wide live table: Name / Punches / Hours / Status / Since. |
| Timesheets tab | Per-person, per-pay-period timesheet with punch and event rows. |
| Requests tab | Pending finish requests, with a live count in the tab label. |
| Manual shift entry | `adminClockIn`, `adminClockOut`, `adminEditEntry`, `adminEditActiveClockIn`, `adminAddEvent`, `adminEditEvent`, `adminDeleteEvent`, `adminDeleteEntry`, `adminReopenEntry`, `adminLunchStart/End`, `adminBreakStart/End`. |
| Admin job hours | Edit logged job-clock time. |
| Admin end break / end job | Force-close someone else's break or job clock. |
| Timesheet confirmation | Confirm / unconfirm a person's timesheet for a period. |
| Pay-period navigation | Current / older / newer pay period; custom date range. |
| Past Logs | Historical clock logs by pay period, as a modal or a page. |
| Set PIN | Assign or change a person's PIN. |
| Pay Type | Hourly / Salary per person; payroll filtering is hourly-only. |
| Forgot-clockout sweep | Daily job flags shifts open >12h, reminds the worker and alerts admins once per shift. |

### Time off
| Feature | What it does |
|---|---|
| Request PTO / UTO | Both types, with date range. |
| Lifecycle | approve / deny / cancel / reopen / edit; statuses pending / approved / denied / cancelled. |
| Approval audience | Only admins holding `approveTimeOff` are notified and added to the group. |
| Overlap warning | Warns when a request collides with scheduled work. |
| Calendar hatching | PTO green, UTO amber on the schedule. |
| Cleanup | Daily prune of cancelled requests older than 30 days. |

---

## 7. Analytics (`renderAnalytics`, `:17286`)

| Feature | What it does |
|---|---|
| Period toggle | This Week / This Month / This Year / Pay Period. |
| Org stats | Total Jobs, Active Jobs, Total Ops, Avg Progress, Avg Ops / Person, Jobs Done, Hours Logged. |
| Jobs by Status donut | Not Started / In Progress / On Hold / Finished / Unassigned. |
| Completion donut | Average completion across active jobs. |
| Pay hours vs production hours | Split of payroll clock time against job-clock time for the period. |
| Employee stats | Per-person efficiency view (`renderEfficiency`). |
| Your stats | Personal view: My Jobs Done, My Jobs by Status, assigned-operation counts. |
| Export Hours | Opens the pay-period hours report (PDF via the layout designer; CSV path is thin — Date/Person/In/Out/Hours only). |

---

## 8. Clients (`renderClients`, `:13562`)

| Feature | What it does |
|---|---|
| Client list | Searchable by name or contact. |
| Add / edit client | Name, contact, email, phone, color, notes. |
| Multi-select | Select mode with All/None and bulk delete. |
| Client detail | Modal (desktop) or page (mobile) with Total Jobs, Est. Hours, and the client's jobs by status. |
| Job cards | Per-job card with status, priority, dates; Unscheduled bucket for undated jobs. |
| Jump to schedule | `goToScheduleJob` opens the job on the Schedule page. |
| Client color | Feeds job coloring elsewhere. |

---

## 9. Messages (`renderMessages`, `:22235`)

| Feature | What it does |
|---|---|
| Direct messages | 1:1 threads. |
| Groups | Create a named group with chosen members. |
| Job chats | Auto-derived threads per job, panel and operation. |
| Pinned threads | Pin conversations to the top; persists per user. |
| Unread counts | Per-thread and total, with server-side read receipts (`message-reads.js`). |
| Delivery status | Sent / Read indicators. |
| Attachments | Attach a file to a message. |
| Reveal timestamp | Tap a message to show its exact time. |
| Thread deletion | Remove a thread. |
| Approval cards in-thread | Completion Request and Time Off Request cards with Approve / Deny / Confirm Decline and "View Job Details" inline. |
| System threads | TRAQS-authored notices. |
| Job context header | Thread header shows client, project manager, status, op start/end. |

---

## 10. Admin live status (`renderAdmin`, `:12163`)

| Feature | What it does |
|---|---|
| Live roster | Everyone with current status: On Job / On Break / On Lunch / Idle / Offline. |
| Grouping | Live (by status), By dept, or Today (by clock-in time). |
| Elapsed time | How long they've been in the current state. |
| Force actions | End break, End job for another person. |

---

## 11. Settings (`renderSettingsPage`, `:26863`)

Two top-level sections plus a six-page Organization group.

| Section | Features |
|---|---|
| **General** (personal) | Profile: full name, photo upload/change, avatar resize. |
| **Organization → General** | Company name, org code (change + reload), logo upload/change. |
| **Organization → Departments** | Add, rename, recolor and delete departments; each person carries a primary and an optional secondary department. |
| **Organization → Worker Permissions** | The nine admin toggles, with "What the Admin toggle grants" explainer; click-to-enable/disable. |
| **Organization → Schedule Preferences** | Working Days (Sun–Sat, at least one required), Work Hours (opens / closes), default hours-per-day, Lunch policy, Breaks policy (duration + allowance), Holidays list (add / remove). |
| **Organization → Approval Queue Templates** | Create / edit / delete named approval chains (label, assignee, department per step). |
| **Organization → Time Clock** | Track Lunch on/off, Track Breaks on/off, show Start/End Lunch and Start/End Break buttons for hourly workers, Clock Events visibility, pay-period type and pay dates, per-person pay-period Hours Cap, PIN management, and "allow workers to clock in for pay from the iOS app". |
| **Customization** | Theme (Light / Dark / System / Custom); per-surface colors — System Elements (sidebar, headers, buttons), List Cells (tables, lists, graphs, toggles), Schedule Grid, Today, accent/highlight; background as Color / Image / Liquid / Adaptive, with upload, background-image opacity, Liquid Color wash and a "Recent images" history; Frosted Glass card opacity; Sidebar Behavior; live mock preview of the Jobs and Schedule pages; Saved Presets. |
| Save mechanics | Per-section dirty tracking, inline Save / Discard, "Unsaved changes" vs "All changes saved" indicator, guard on navigating away dirty. |

---

## 12. Mobile web shell (`renderMobileApp`, `:21653`)

Its own nav rather than a responsive reflow of the desktop pages.

| Feature | What it does |
|---|---|
| Tab bar | Home, Jobs, Time, Schedule, Chat, More. |
| More sheet | Clients, Analytics, Settings (General / Organization). |
| My Tasks / View All | Personal assigned work, or the full calendar (`renderMobileCal`). |
| Mobile task cards | Compact job/op cards with status and dates. |
| Mobile clients | List + detail as pages, not modals. |
| Mobile team | Roster with clock pills. |
| Mobile analytics | Reduced stat set. |
| Ask TRAQS FAB | Always-visible floating button. |
| Page-stack navigation | Modals become pushed pages with back buttons. |

---

## 13. iOS native app (`TRAQS Scheduling/`)

SwiftUI, Auth0, SwiftData local cache, Ably realtime.

| Surface | Features |
|---|---|
| Welcome / Splash | Org code, login, person picker, PIN pad. |
| Home | Personal dashboard. |
| Jobs Hub / Tasks | Job grid with columns, filters, progress, approval state, row and column menus, cell editors, custom columns. |
| Job Detail / Popup | Panels, ops, hours, attachments, approval chain. |
| Job Edit | Create and edit jobs. |
| Schedule / Gantt / Team | Timeline views and the people grid. |
| Schedule Job sheet / Reschedule sheet / Availability check | Assignment flows with conflict checks. |
| Time Clock | Clock in/out, lunch, break, job clock, optimistic clock state, clock action banner and overlays, break reminder. |
| Time Off | Request and view PTO/UTO. |
| Messages | Threads, groups, job chats, decision actions. |
| Clients | List and detail. |
| Analytics | Stats views. |
| Admin | Live status screen. |
| Panel photos | Camera/library capture, gallery, attachment preview. |
| Settings / Customize | Theme and personal settings; delete-account countdown. |
| Sync status | Visible sync state. |
| Liquid Glass UI | iOS 26 glass treatment, committed to master. |
| Hand-traced nav glyphs | Home / Jobs / Hours / Analytics traced from the web SVGs. |

## 14. macOS native app (`TRAQS MacBook Native/`)

SwiftUI port of the web UI, built in Split parity mode against the live site.

| Surface | Features |
|---|---|
| Auth gate | Intro, lockup, org steps, login step, team step, PIN pad, load-up. |
| Jobs page | Grid, column menu + store, cell editors, custom cells, row menu, approval menu + sheet, new-job sheet, export sheet, template store. |
| Parity view | Side-by-side against the web app for visual diffing. |
| Native shell | macOS window chrome, account commands, context menus, modals, form controls. |
| WebView host | Embeds the web app for surfaces not yet ported. |

**Frontier:** the Jobs page. Other pages are not yet ported natively.

---

## 15. Backend surface (`netlify/functions/`)

| Function | Role |
|---|---|
| `sync.js` | Delta sync across all entities with a cursor. |
| `tasks.js` / `people.js` / `clients.js` / `groups.js` | Entity CRUD. |
| `messages.js` / `message-reads.js` | Chat and read receipts. |
| `timeclock.js` | All punch and admin-timesheet actions. |
| `timeoff.js` | PTO/UTO lifecycle. |
| `settings.js` / `user-settings.js` / `org-config.js` / `org.js` / `org-lookup.js` / `forgot-org.js` | Org and user configuration. |
| `attachment.js` | S3 upload/download. |
| `notify.js` / `push-subscribe.js` | OneSignal + Web Push. |
| `ably-token.js` | Realtime auth. |
| `ai-schedule` (edge function) | Streaming Claude calls for FAST TRAQS and Ask TRAQS. |
| `backup-daily.js` | **Scheduled 05:00 UTC** — full S3 backup to `backups/{date}/`; with bucket versioning gives 30-day point-in-time recovery. |
| `forgot-clockout.js` | **Scheduled 05:00 UTC** — flags shifts open >12h, notifies worker and admins. |
| `timeoff-cleanup.js` | **Scheduled 05:00 UTC** — prunes cancelled time-off older than 30 days. |
| `migrate-timeclock.js` | One-off data migration. |

Security: CSP and other headers applied to every SPA response; permission checks duplicated server-side in `_utils/can.js` so iOS and direct API calls cannot bypass the web UI's `can()`.

---

## Known gaps (from the 2026-09-21 rostering audit, carried forward)

Not features — listed so they aren't mistaken for them during the tier split.

- **No scheduled shift start**, so no clock-in-vs-scheduled on-time metric. (`ontime` in the codebase is job-delivery health only.)
- **CSV payroll export is thin** — Date/Person/In/Out/Hours; drops lunch, break, PTO, UTO and OT, all of which the PDF report already has.
- **No PTO balances or accrual** — you can request and approve, but not answer "how many days are left".
- **No pay rate, employee/payroll ID, or hire date** on the person record.
- **No reviews or certifications** data model — the Employees panels are deliberate empty states.
