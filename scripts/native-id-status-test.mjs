// #447 and #442 — the two native clients narrowing a server value and writing
// the narrowed version back.
//
// ─── WHAT THIS SUITE CAN AND CANNOT DO, STATED FIRST ───
//
// It asserts the SHAPE OF THE NATIVE SOURCE as text, which is the same thing
// `schedule-parity-test` and `brand-test` already do. It CANNOT compile Swift or
// Kotlin, cannot type-check, cannot run either app, and cannot tell you that a
// SwiftUI view still builds. Everything below is "the source says X", never "the
// app does X".
//
// So this is red-first for the edit and nothing more. **Neither fix may ship
// until it has been compiled** — #447 needs a Mac, #442 an Android toolchain,
// and both are parked for those sessions.
//
// ─── #447: iOS ───
//
// `status` was `JobStatus`, a five-case enum, decoded with
// `(try? ...) ?? .notStarted` and re-encoded from the enum. Matrix has
// SEVENTEEN statuses, so 38 of 64 jobs read as "Not Started" — and `saveJobs`
// re-encodes the WHOLE array on any edit, so one tap wrote that back for all of
// them.
//
// THE FIX STORES THE RAW STRING AND DERIVES THE ENUM. `statusRaw` is the stored
// property, decoded and encoded verbatim; `status` becomes a COMPUTED property
// over it, with a setter. That is deliberately not the literal shape discussed —
// making `status` a `String` outright would have touched ~60 read sites across
// 20 files in a language this machine cannot compile. A computed property fixes
// the DESTRUCTION (which lives entirely in decode/encode) while every
// `$0.status == .finished` keeps working untouched. The remaining DISPLAY bug is
// then a handful of sites that should show `statusRaw`, not sixty.
//
// ─── #442: Android ───
//
// `Person.id` was `Int`, and `SafeIntDeserializer` turns an unparseable id into
// `0` rather than throwing — so 16 of 18 people share id 0. `team` is
// `List<Int>`, so every membership collapses the same way. TeamScreen's delete
// is `filter { it.id != person.id }`, which with sixteen zeros removes sixteen
// people.
//
//   node scripts/native-id-status-test.mjs
import { readFileSync, existsSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const read = (p) => {
  const u = new URL(p, import.meta.url);
  return existsSync(u) ? readFileSync(u, "utf8").replace(/\r\n/g, "\n") : "";
};
const MODELS = read("../TRAQS Scheduling/TRAQS Scheduling/Models/Models.swift");
const TASKS = read("../TRAQS Scheduling/TRAQS Scheduling/Views/TasksView.swift");
const KMODELS = read("../traqs-android/app/src/main/java/com/matrixsystems/traqs/models/Models.kt");
const KAPI = read("../traqs-android/app/src/main/java/com/matrixsystems/traqs/services/ApiService.kt");
const KTEAM = read("../traqs-android/app/src/main/java/com/matrixsystems/traqs/ui/screens/TeamScreen.kt");

console.log("\n0. THE SOURCES ARE WHERE THIS EXPECTS THEM");
{
  ok("iOS Models.swift found", MODELS.length > 0, true);
  ok("iOS TasksView.swift found", TASKS.length > 0, true);
  ok("Android Models.kt found", KMODELS.length > 0, true);
  ok("Android ApiService.kt found", KAPI.length > 0, true);
  ok("Android TeamScreen.kt found", KTEAM.length > 0, true);
}

console.log("\n1. #447 — the status is STORED as the server sent it");
{
  // Three models carry it: Op, Panel, Job.
  ok("three models store a raw status", (MODELS.match(/var statusRaw: String/g) || []).length, 3);
  ok("none still stores the enum", /var status: JobStatus\s*$/m.test(MODELS), false);
  // Decoded verbatim. The old line collapsed anything unmodelled to .notStarted.
  ok("the raw string is decoded, not the enum",
    (MODELS.match(/statusRaw\s*=\s*\(try\? c\.decode\(String\.self, forKey: \.status\)\) \?\? "Not Started"/g) || []).length, 3);
  ok("no decode narrows to the enum any more",
    /try\? c\.decode\(JobStatus\.self, forKey: \.status\)/.test(MODELS), false);
  // Encoded verbatim — this is the half that was destroying data.
  ok("the raw string is encoded", (MODELS.match(/try c\.encode\(statusRaw, forKey: \.status\)/g) || []).length, 3);
  ok("the enum is never encoded", /try c\.encode\(status, forKey: \.status\)/.test(MODELS), false);
}

console.log("\n2. #447 — the enum survives as a DERIVED view, so no read site moves");
{
  const computed = /var status: JobStatus \{\s*\n\s*get \{ JobStatus\(rawValue: statusRaw\) \?\? \.notStarted \}\s*\n\s*set \{ statusRaw = newValue\.rawValue \}\s*\n\s*\}/g;
  ok("all three expose a computed status with a setter", (MODELS.match(computed) || []).length, 3);
  // The SETTER is what keeps the two in step. Without it, `p.status = .finished`
  // would leave statusRaw stale and the next encode would write the old value —
  // the same destruction with the sign flipped.
  ok("the setter writes through to the raw value",
    (MODELS.match(/set \{ statusRaw = newValue\.rawValue \}/g) || []).length, 3);
  // A caller can ask for the honest answer where it matters.
  ok("an optional accessor exists for code that must know it is unmodelled",
    /var statusKnown: JobStatus\? \{ JobStatus\(rawValue: statusRaw\) \}/.test(MODELS), true);
  // Job's memberwise init still has to name a status; it takes the string now.
  ok("the init default is a string", /status: String = "Not Started"/.test(MODELS), true);
  ok("...and no init still defaults to the enum case", /status: JobStatus = \.notStarted/.test(MODELS), false);
}

console.log("\n3. #447 — the cycle control is GONE, ruled");
{
  // It offered three of seventeen and overwrote whatever it replaced, so after
  // the type change it would STILL destroy a status iOS cannot express. Ruled:
  // no status edit on the phone beats one that can only produce three answers.
  ok("the three-value cycle list is gone", /cycle: \[JobStatus\] = \[\.pending, \.inProgress, \.finished\]/.test(TASKS), false);
  ok("...and the next(after:) stepper with it", /private func next\(after s: JobStatus\) -> JobStatus/.test(TASKS), false);
  ok("...and the tap that applied it", /onTapGesture \{ if mayEdit \{ apply\(next\(after: job\.status\)\) \} \}/.test(TASKS), false);
  ok("the badge still RENDERS, it just no longer edits", /StatusBadge\(status:/.test(TASKS), true);
  // And it shows what the server actually holds, which is the display half of
  // #447 — 38 of 64 jobs were drawn as "Not Started".
  ok("the badge takes the raw string", /struct StatusBadge: View \{\s*\n\s*let status: String/.test(TASKS), true);
}

console.log("\n4. #442 — a person id is a string on Android");
{
  ok("Person.id is a String", /data class Person\(\s*\n\s*val id: String = ""/.test(KMODELS), true);
  ok("...and not an Int", /data class Person\(\s*\n\s*val id: Int/.test(KMODELS), false);
  // `team` holds person ids too, so it collapsed to zeros by the same route.
  ok("no team list is List<Int> any more", /val team: List<Int>/.test(KMODELS), false);
  ok("team lists are List<String>", (KMODELS.match(/val team: List<String> = emptyList\(\)/g) || []).length >= 3, true);
  ok("the assign payload's id lists follow", /val jobTeamIds: List<String>/.test(KMODELS), true);
  ok("...both of them", /val newTeamIds: List<String>/.test(KMODELS), true);
  // The API surface takes the same type, or the call sites cannot pass an id.
  ok("no API method still takes personId: Int", /personId: Int/.test(KAPI), false);
}

console.log("\n5. #442 — the delete compares the way the server does");
{
  // `filter { it.id != person.id }` with sixteen zeros removed sixteen people.
  // Comparing as the server does — String on both sides — is what makes one
  // delete remove one person.
  ok("the delete filters on a string comparison",
    /filter \{ it\.id != person!!\.id \}/.test(KTEAM), true);
  ok("the SafeInt deserialiser no longer sees ids, because none are Int",
    /registerTypeAdapter\(Int::class\.java, SafeIntDeserializer\)/.test(KAPI), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log("NOTE: source shape only. Neither app was compiled, type-checked or run.");
process.exit(fail ? 1 : 0);
