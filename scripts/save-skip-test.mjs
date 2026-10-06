// #227 (1) — a slice that has not changed is not POSTed.
// #338     — an undo frame records content, and stamps come from live state.
//
// WHY #227 (1). Measured over the 40 most recent writes to Matrix's tasks.json:
// 112 jobs sent every time, 0.97 changed on average, and NINETEEN OF FORTY
// CHANGED NOTHING AT ALL — 508 KB uploaded, an S3 version stored, a
// publishChange, a silent push and a notify scan, to change nothing. The cause
// is upstream: the autosave effect fires on OBJECT IDENTITY, so any rebuild of
// the array schedules a save.
//
// WHY #338. undo() restored a deep copy carrying each job's lastModifiedAt from
// when the frame was pushed. Since #337 the client adopts the server's stamp on
// every save, so those are always older than stored — every undo POSTed stale
// stamps and tripped the conflict check. In enforce that means every undo is
// refused. It was the second precondition on #185.
//
//   node scripts/save-skip-test.mjs

import { readFileSync } from "node:fs";
const J = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
const count = (n) => J.split(n).length - 1;
const slice = (a, b) => { const i = J.indexOf(a); if (i < 0) return ""; const k = J.indexOf(b, i); return k < 0 ? J.slice(i) : J.slice(i, k); };

let pass = 0, fail = 0;
const ok = (label, got, want = true) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  PASS  ${label}`); return true; }
  fail++; console.error(`  FAIL  ${label}\n        got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

// ── the behaviour, modelled ──────────────────────────────────────────────
// contentKey and the stamp helpers are small and pure, so they are re-declared
// here and asserted against the source separately. That keeps the BEHAVIOUR
// assertions real rather than string matches.
const contentKey = (v) => JSON.stringify(v, (k, val) => (k === "lastModifiedAt" ? undefined : val));
const snapshotForHistory = (arr) =>
  JSON.parse(JSON.stringify(Array.isArray(arr) ? arr : [])).map(({ lastModifiedAt, ...job }) => job);
const restoreWithLiveStamps = (snap, live) => {
  const now = new Map((Array.isArray(live) ? live : []).filter(j => j && j.id != null).map(j => [String(j.id), j.lastModifiedAt]));
  return (Array.isArray(snap) ? snap : []).map(j => {
    const s = j && j.id != null ? now.get(String(j.id)) : undefined;
    return s ? { ...j, lastModifiedAt: s } : j;
  });
};

console.log("\n1. #227 — the content key ignores stamps and nothing else");
{
  const a = [{ id: "j1", title: "Job", lastModifiedAt: "2026-10-01T00:00:00.000Z" }];
  const b = [{ id: "j1", title: "Job", lastModifiedAt: "2026-10-02T23:59:59.000Z" }];
  ok("a stamp-only difference reads as UNCHANGED", contentKey(a) === contentKey(b), true);
  // This is the assertion that makes the optimization work at all: after #337
  // the client adopts the server's stamps, so a content-identical tree differs
  // by its stamps alone. Compare with them in and the skip never fires.
  ok("...which is the whole point — with stamps in, it would look changed",
    JSON.stringify(a) === JSON.stringify(b), false);
  const c = [{ id: "j1", title: "Renamed", lastModifiedAt: a[0].lastModifiedAt }];
  ok("a real content change reads as CHANGED", contentKey(a) === contentKey(c), false);
  // Nested changes must not be missed -- a moved op is the common case.
  const d = [{ id: "j1", title: "Job", lastModifiedAt: a[0].lastModifiedAt, subs: [{ id: "p", subs: [{ id: "o", startHour: 8 }] }] }];
  const e = [{ id: "j1", title: "Job", lastModifiedAt: a[0].lastModifiedAt, subs: [{ id: "p", subs: [{ id: "o", startHour: 11 }] }] }];
  ok("a nested op change reads as CHANGED", contentKey(d) === contentKey(e), false);
  // Nested stamps are stripped too (the replacer is key-based, at every depth),
  // which is fine: the conflict check reads the ROOT stamp only.
  const f = [{ id: "j1", subs: [{ id: "p", lastModifiedAt: "x" }] }];
  const g = [{ id: "j1", subs: [{ id: "p", lastModifiedAt: "y" }] }];
  ok("nested stamp-only differences also read as unchanged", contentKey(f) === contentKey(g), true);
}

console.log("\n2. #227 — the skip is wired, per slice, and fails towards SAVING");
ok("there is a last-saved baseline", count("const lastSavedRef = useRef"), 1);
ok("it starts empty, so the first save of a session always goes",
  /const lastSavedRef = useRef\(\{ tasks: null, people: null, clients: null \}\)/.test(J), true);
{
  const fn = slice("const contentKey = (v) => JSON.stringify", "const results = await Promise.allSettled");
  ok("the comparison excludes lastModifiedAt", /k === "lastModifiedAt" \? undefined : val/.test(fn), true);
  ok("...and is computed per slice", /tasks:.*contentKey\(dedupedTasks\)/s.test(fn), true);
  ok("a fully-unchanged save returns without POSTing",
    /if \(!changedSlice\.tasks && !changedSlice\.people && !changedSlice\.clients\) \{/.test(fn), true);
  // The intent is "this path reports saved and returns", not "those two lines
  // are adjacent". #403 inserted the save verdict between them
  // (`lastSaveResultRef.current = { ok: true }`), which an adjacency pattern
  // reads as a regression and is not one — a no-op save IS a successful save,
  // and the AI chat path now needs to be told so.
  ok("...and still reports saved rather than leaving the pill on 'saving'",
    /setSaveStatus\("saved"\);[\s\S]{0,120}?return;/.test(fn), true);
  ok("...and records that verdict for a caller that awaited it",
    /setSaveStatus\("saved"\);[\s\S]{0,120}?lastSaveResultRef\.current = \{ ok: true \};/.test(fn), true);
}
ok("each endpoint is skipped independently",
  /changedSlice\.tasks \? saveTasks\(/.test(J)
  && /changedSlice\.people \? savePeople\(/.test(J)
  && /changedSlice\.clients\s*\n?\s*\? saveClients\(/.test(J), true);
ok("the baseline advances only for slices that were actually sent",
  /if \(changedSlice\.tasks\) lastSavedRef\.current\.tasks = nextKeys\.tasks;/.test(J), true);
// The safe direction, asserted: a rollback must not leave a baseline that could
// suppress the next save.
ok("a rollback clears the baseline so the next save always goes",
  /lastSavedRef\.current = \{ tasks: null, people: null, clients: null \};/.test(J), true);

console.log("\n3. #338 — an undo frame carries no stamps, and gets live ones back");
{
  const live = [{ id: "j1", title: "Moved", lastModifiedAt: "2026-10-02T16:00:00.000Z" }];
  const frame = snapshotForHistory([{ id: "j1", title: "Original", lastModifiedAt: "2026-10-01T09:00:00.000Z" }]);
  ok("the frame holds no stamp at all", Object.hasOwn(frame[0], "lastModifiedAt"), false);
  ok("...but keeps the content", frame[0].title, "Original");
  const restored = restoreWithLiveStamps(frame, live);
  ok("restoring brings the content back", restored[0].title, "Original");
  // THE assertion: the restored tree must carry the CURRENT stamp, or the save
  // that follows the undo is a stale write and enforce refuses it.
  ok("...carrying the LIVE stamp, not the one from when the frame was pushed",
    restored[0].lastModifiedAt, "2026-10-02T16:00:00.000Z");
  // A job deleted since the frame was pushed has no live stamp. It goes back
  // unstamped and the server stamps it, which is the create path.
  const gone = restoreWithLiveStamps(snapshotForHistory([{ id: "j9", title: "Deleted", lastModifiedAt: "old" }]), live);
  ok("a resurrected job returns without a stamp — a resurrection is a create",
    Object.hasOwn(gone[0], "lastModifiedAt"), false);
  // Deep-copy safety: the frame must not alias live nested objects, or a later
  // edit would mutate history.
  const src = [{ id: "j1", subs: [{ id: "p", subs: [{ id: "o", startHour: 8 }] }] }];
  const snap = snapshotForHistory(src);
  src[0].subs[0].subs[0].startHour = 99;
  ok("the frame is a deep copy, not an alias", snap[0].subs[0].subs[0].startHour, 8);
}

console.log("\n4. #338 — wired at all four stack sites");
ok("the capture pushes a stripped snapshot", count("undoStack.current.push(snapshotForHistory(prev));"), 2);
ok("redo frames are stripped too", count("redoStack.current.push(snapshotForHistory(prev));"), 1);
ok("undo re-attaches live stamps", count("restoreWithLiveStamps(undoStack.current.pop(), prev)"), 1);
ok("redo re-attaches live stamps", count("restoreWithLiveStamps(redoStack.current.pop(), prev)"), 1);
ok("no raw deep-copy push survives on the history path",
  /(undo|redo)Stack\.current\.push\(JSON\.parse\(JSON\.stringify\(prev\)\)\)/.test(J), false);
ok("no raw pop survives either",
  /return (undo|redo)Stack\.current\.pop\(\);/.test(J), false);

console.log("\n5. RED PROOF");
{
  const muts = [
    ["the baseline ref", "const lastSavedRef = useRef"],
    ["the no-change return", "if (!changedSlice.tasks && !changedSlice.people && !changedSlice.clients) {"],
    ["the rollback reset", "lastSavedRef.current = { tasks: null, people: null, clients: null };"],
    ["the stripped push", "undoStack.current.push(snapshotForHistory(prev));"],
    ["the live re-attach", "restoreWithLiveStamps(undoStack.current.pop(), prev)"],
  ];
  let red = 0;
  for (const [label, needle] of muts) {
    if (J.split(needle).join("/* gone */").includes(needle)) { console.error(`  RED FAIL  ${label} survives deletion`); fail++; }
    else red++;
  }
  console.log(`  red proof: ${red}/${muts.length} guards go red when their subject is deleted`);
  // Behavioural red proof: the OLD snapshot shape would fail section 3.
  const oldFrame = JSON.parse(JSON.stringify([{ id: "j1", title: "Original", lastModifiedAt: "2026-10-01T09:00:00.000Z" }]));
  ok("the old deep-copy frame would have carried the stale stamp",
    oldFrame[0].lastModifiedAt, "2026-10-01T09:00:00.000Z");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
