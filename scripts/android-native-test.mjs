#!/usr/bin/env node
// THE ANDROID FOUR (#283, #504, #523, #524), BY SOURCE SHAPE — because nothing else is possible.
//
// This Mac has no JDK and no Android SDK, so none of this is compiled or run; Trey: "Uncompiled
// is fine — they ride with whatever toolchain session happens eventually, and they're cheap now
// and expensive once someone installs the app." So these assertions read the Kotlin source, with
// its comments stripped (a comment that names a fix must not satisfy the assertion about it),
// and pin the SHAPE of each fix. They prove the code says the right thing, not that it compiles.
// #524's steps (1) assembleDebug, (2) the JVM round-trip of PassthroughAdapterFactory and (5)
// the emulator pass are still owed, and are what turns this into evidence.
//
//   node scripts/android-native-test.mjs
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};
const ROOT = "../traqs-android/app/src/main/java/com/matrixsystems/traqs/";
// Kotlin comments out: /* ... */ blocks and // to end of line, leaving string literals alone.
const code = (rel) => {
  const s = readFileSync(new URL(ROOT + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  let out = "", i = 0, str = null;
  while (i < s.length) {
    const c = s[i], n = s[i + 1];
    if (str) { out += c; if (c === "\\") { out += n ?? ""; i += 2; continue; } if (c === str) str = null; i++; continue; }
    if (c === '"' || c === "'") { str = c; out += c; i++; continue; }
    if (c === "/" && n === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (c === "/" && n === "/") { const e = s.indexOf("\n", i); i = e < 0 ? s.length : e; continue; }
    out += c; i++;
  }
  return out;
};
const fnBody = (src, sig) => {
  const at = src.indexOf(sig);
  if (at < 0) return "";
  let i = src.indexOf("{", at), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}" && --d === 0) break; }
  return src.slice(at, i + 1);
};

const HC = code("services/HoursCalculator.kt");
const MODELS = code("models/Models.kt");
const SM = code("models/StatusMeaning.kt");
const STATE = code("services/AppState.kt");
const API = code("services/ApiService.kt");
const TEAM = code("ui/screens/TeamScreen.kt");
const EDIT = code("ui/screens/JobEditScreen.kt");
const FAST = code("ui/screens/FastTRAQSScreen.kt");

console.log("\n1. #283 — A HELD SESSION STOPS ACCRUING");
{
  const f = fnBody(HC, "fun liveElapsedHours(");
  ok("liveElapsedHours is found", f.length > 0, true);
  ok("the clock stops at the hold, never later than now",
    /val effNow = if \(frozenAtMs != null\) minOf\(now, frozenAtMs\.toLong\(\)\) else now/.test(f), true);
  ok("...elapsed is measured to it", /\(effNow - started\)/.test(f), true);
  ok("...and so is an open pause, floored", /maxOf\(0\.0, \(effNow - pausedSince\)\.toDouble\(\)\)/.test(f), true);
  ok("nothing measures to raw now any more", /\(now - (started|pausedSince)\)/.test(f), false);
  ok("the unused-parameter suppression is gone with the reason for it", /UNUSED_PARAMETER/.test(HC), false);
}

console.log("\n2. #504 — MEANING FROM THE ORG'S LIST, PER FLAG");
{
  const inst = fnBody(SM, "fun install(");
  ok("a flag carried by any entry decides; else the name does",
    /isFinished = if \(anyFin\) flag\(o, "isFinished"\) else k == FINISHED_NAME/.test(inst)
    && /isActive = if \(anyAct\) flag\(o, "isActive"\) else k == ACTIVE_NAME/.test(inst), true);
  const means = fnBody(SM, "private fun means(");
  ok("a status in the list takes its entry's flag", /if \(hit\.isNotEmpty\(\)\) return hit\.any/.test(means), true);
  ok("...one not in the list is read by its name", /return s == \(if \(finished\) FINISHED_NAME else ACTIVE_NAME\)/.test(means), true);
  ok("names are normalised as the web does (trim, collapse spaces, lower)",
    /\.trim\(\)\.replace\(Regex\("\\\\s\+"\), " "\)\.lowercase\(\)/.test(SM), true);
  ok("AppState installs the list wherever settings land",
    /private fun setOrgSettings\(settings: OrgSettings\) \{\s*StatusMeaning\.install\(settings\.extras\?\.get\("statusOpts"\)\)/.test(STATE), true);
  ok("...and nothing sets them past it", (STATE.match(/_orgSettings\.value = /g) || []).length, 1);
}

console.log("\n3. #523 / #524(3) — NO NULL STATUS OR PRIORITY REACHES A SCREEN");
{
  ok("all three node classes store the field as read, still serialised as status/pri",
    [(MODELS.match(/@SerializedName\("status"\) val statusOrNull: JobStatus\? = /g) || []).length,
     (MODELS.match(/@SerializedName\("pri"\) val priOrNull: Priority\? = /g) || []).length], [3, 3]);
  ok("...and expose status/pri by meaning, never null",
    [(MODELS.match(/val status: JobStatus get\(\) = StatusMeaning\.statusOf\(statusOrNull, extras\)/g) || []).length,
     (MODELS.match(/val pri: Priority get\(\) = StatusMeaning\.priOf\(priOrNull\)/g) || []).length], [3, 3]);
  ok("no node class still declares a non-null status/pri field", /\n\s*val (status|pri): (JobStatus|Priority) = /.test(MODELS), false);
  const so = fnBody(SM, "fun statusOf(");
  ok("statusOf reads the raw value from extras when the enum had no case",
    /read\?\.label \?: extras\?\.get\("status"\)/.test(so), true);
  ok("...finished and active come from MEANING", /if \(isFinished\(raw\)\) return JobStatus\.FINISHED/.test(so) && /if \(isActive\(raw\)\) return JobStatus\.IN_PROGRESS/.test(so), true);
  ok("...and falls back to Not Started, never null", /\?: JobStatus\.NOT_STARTED/.test(so), true);
  ok("the quick toggle writes through the stored field", /op\.copy\(statusOrNull = newStatus\)/.test(FAST), true);
}

console.log("\n4. THE JOB EDITOR WRITES BACK WHAT IT READ (#520's family, found here)");
{
  ok("an edit COPIES the job, keeping its extras, instead of rebuilding it",
    /val newJob = \(job \?: TRAQSJob\(\)\)\.copy\(/.test(EDIT) && !/val newJob = TRAQSJob\(/.test(EDIT), true);
  ok("an untouched status is written back as read, not as our meaning of it",
    /statusOrNull = if \(job != null && status == job\.status\) job\.statusOrNull else status/.test(EDIT), true);
  ok("...and the same for priority",
    /priOrNull = if \(job != null && priority == job\.pri\) job\.priOrNull else priority/.test(EDIT), true);
}

console.log("\n5. #524(4) — NO SETTINGS POST WRITES KOTLIN DEFAULTS");
ok("the API has no settings POST", /@POST\("settings"\)|saveOrgSettings/.test(API), false);

console.log("\n6. #524(7) / #525 — A DELETE IS A DELETE");
{
  ok("the API deletes a person by id", /@DELETE\("people"\)\s*suspend fun deletePerson\(@Query\("id"\) id: String\)/.test(API), true);
  const del = fnBody(STATE, "fun deletePerson(id: String)");
  ok("AppState calls it", /api\?\.deletePerson\(id\)/.test(del), true);
  ok("...and re-reads the roster if the server refuses", /if \(!ok\) runCatching \{ api\?\.fetchPeople\(\) \}/.test(del), true);
  ok("the Team screen uses it, not a roster save", /appState\.deletePerson\(person!!\.id\)/.test(TEAM) && !/updatePeople\([^)]*filter/.test(TEAM), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail ? 1 : 0);
