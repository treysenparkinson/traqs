# Group chat naming, web + iOS

Date: 2026-08-05
Scope: `src/TRAQS.jsx` (web) and `TRAQS Scheduling` (iOS). No backend changes.

## Problem

Group naming is broken in **both** directions, and the cause is that the two clients
disagree about whether a group has a name at all.

**Web strips the name.** `saveNewGroup` (`src/TRAQS.jsx:8088`) builds
`{ id, memberIds, createdBy, createdAt }` with an explicit comment —
``// No `name` — groups are identified by their members (see groupTitle)`` — and the
modal's subtitle tells the user "the group is named after its members". There is no name
input.

**iOS requires one.** `createGroup` (`Services/AppState.swift:1451`) bails on an empty
name via `guard !trimmed.isEmpty else { return nil }`, and `NewMessageSheet`'s Create
button is `.disabled(groupName…isEmpty)`.

The two failures compound:

| Created on | Result elsewhere |
| --- | --- |
| Web (no name) | iOS's `resolvedTitle` finds no name, so `displayTitle` falls through to `String(key.dropFirst(6))` — **the raw group UUID** is shown as the thread title. `threadTitle` does the same via `?? ref`. |
| iOS (named) | Web's `groupTitle()` ignores `group.name` entirely and always renders the member list, so **the name the user typed never appears**. |

## Goals

1. A group can be given a name, on either platform. Never required.
2. Blank name → a display name derived from the members.
3. The name shows in the thread list *before* opening a thread, and in the thread header.
4. Member selection is a grid of avatar cards rather than pills / checkmark rows.

## Non-goals

- **Renaming an existing group.** Deliberately out of scope; it's a separate surface on
  each platform (a thread context menu on web, the thread header on iOS). Note the
  consequence: groups that already exist can't be given names by this work, they can only
  stop showing a UUID.
- Any backend change. `name` already round-trips through `groups.json` — iOS writes it
  today — so this is purely client-side.
- Changing how threads are keyed. See below.

## Design

### 1. The shared rule

`name` is an **optional field that both clients honour**.

```
displayName(group) =
    group.name, trimmed, if non-empty
    else  first 3 member names (excluding the viewer), joined ", ", plus " +N"
          for any remainder
    else  "Group"      // no member names resolve
```

Two details that would otherwise be read two ways:

- **`N` counts the remaining OTHERS, not remaining members.** The viewer is excluded
  before counting, so a 4-person group (you + 3) shows three names and no `+N`, and a
  5-person group (you + 4) shows `Alice, Bob, Carol +1`.
- **Names follow `memberIds` order**, not alphabetical. That's what web does today, and it
  keeps a group's title stable rather than reshuffling when someone is renamed.

The member *count* in the iOS header subtitle is unaffected and keeps counting everyone,
the viewer included — it already reads "7 members" from `threadParticipants`.

Truncating at 3 is deliberate. Web currently joins *every* name, which for a 7-person
group produces a title wider than a thread row — it gets clipped mid-name and groups stop
being distinguishable from one another.

Excluding the viewer matches what web's `groupTitle` already does: you know you're in it.

JS and Swift can't share this, so it is implemented **twice, each in exactly one
function**, which is what stops the two platforms drifting apart again the way they
already have:

- web: `groupDisplayName(group)`
- iOS: `ChatGroup.displayName(people:myId:)`

### 2. Names stay display-only

Both clients already key group threads by **id** — `"group:\(g.id)"` on iOS
(`Views/MessagesView.swift:327`), `` `group:${newGroup.id}` `` on web
(`src/TRAQS.jsx:8095`). So:

- nothing has to migrate,
- existing threads keep resolving,
- and a name can be anything, including empty, without touching thread identity.

`canViewThread` (`netlify/functions/messages.js:56`) matches `group:<ref>` against
`g.name === ref || g.id === ref`, which stays as-is for threads keyed by name by older
iOS builds.

**Sharp edge, pre-existing, not fixed here:** because that ACL check accepts a name *or*
an id, a group whose name happened to equal another group's id would match the wrong
group. Names were already user-supplied on iOS, so this work adds no new exposure, and
ids are UUIDs so a collision is not realistically reachable. Recorded because it is a
real edge, not because it needs fixing now.

### 3. Web changes

- **New Group modal** (`src/TRAQS.jsx:26236`): add an optional Name input above Members.
  Its subtitle currently reads "Pick who's in it — the group is named after its members";
  that becomes accurate about the name being optional.
- **`saveNewGroup`** (`:8079`): include `name` when the trimmed value is non-empty, omit
  it otherwise. Delete the `// No name` comment, which encodes the decision being
  reversed.
- **`groupTitle`** (`:8046`) splits in two. It is currently called both with a group
  object (`:18826`) *and* with a bare `memberIds` array (`:8098`), so a single function
  can't just start reading `.name`:
  - `groupDisplayName(group)` — the full rule from §1, for group objects.
  - `memberNamesLine(ids)` — the derived-names half, for the array call sites.
- **Thread list** (`:18826`) already calls `groupTitle(g)`, so it picks names up with no
  further change.

### 4. iOS changes

- **`createGroup`** (`Services/AppState.swift:1448`): drop the empty-name guard.
- **Dedupe** (`:1454`) currently reuses any group with a matching name. Keep that **only
  when a name was supplied**. Left unconditional, every unnamed group would dedupe onto
  the first one, since they'd all share the empty name.
- **`NewMessageSheet`** (`Views/MessagesView.swift:2568`): the name field stays but stops
  being mandatory — Create gates on `selectedIds.isEmpty` instead of the name.
- **Title resolution**: `displayTitle` (`:654`) and `threadTitle` (`:803`) route through
  the shared rule. This is what stops a group ever rendering as a raw UUID.
- **`addGroupMembers(groupName:)`** (`Services/AppState.swift:1473`) becomes id-based. A
  name lookup cannot work once names are optional and non-unique.

### 5. Both member pickers

A 3-per-row grid of square cards — avatar above the first name, selected state carried by
the card itself. Three keeps the avatar readable and a full first name visible while a
30-person roster still scans in a couple of rows; it also works at both a phone width and
the desktop modal's 420px.

Replaces web's wrap-flex of pills (`:26241`) and iOS's checkmark list rows (`:2618`).

## Verification

No automated coverage exists for either surface, so this is a clean web build plus an
iOS `xcodebuild`, then a manual pass. Per project convention the user drives the
simulator.

The cross-platform cases are the whole point of the work:

1. Name a group on **web** → the name shows on **iOS**, in the list and the header.
2. Name a group on **iOS** → the name shows on **web**, in the list and the header.
3. Leave it blank on either → both show `Alice, Bob, Carol +4`.
4. An **existing** web-made group (no name) no longer shows a UUID on iOS.
5. A 2-person group reads sensibly — two names, no `+N`.
6. Both pickers: 3 per row, selection toggles, creator is a member whether or not they
   picked themselves.
7. Creating two unnamed groups with the same members yields two distinct groups on iOS
   (the dedupe change), matching web.
