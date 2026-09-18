#!/usr/bin/env node
// Guards against live job-hours arithmetic being written by hand instead of
// calling `liveElapsedHours`.
//
// Why this exists: the same "now - clockIn - totalPausedMs" calculation was
// written seventeen times across web, iOS and Android in three different
// variants, and nothing noticed they had drifted apart. One variant dropped the
// open-pause term entirely, so the current-work card and the op-progress
// percentage kept counting straight through lunch on all three platforms; that
// was filed once as an iOS-only cosmetic gap because nobody could see it was
// replicated. Another subtracted an open pause without flooring it, so a
// `pausedAt` ahead of `now` — phone/server clock skew — ADDED time.
//
// Deduplication alone does not hold this: iOS already had a shared helper and
// four call sites routed around it, because the helper itself was missing the
// open-pause term. A helper nobody is required to use decays back into variants.
// This is the part that makes the divergence visible.
//
// An arithmetic use of `totalPausedMs` is legal only inside `liveElapsedHours`
// itself, or on a block explicitly marked:
//
//     // live-hours-exempt: <why this window is genuinely different>
//
// The two current exemptions measure from `drainCheckpoint` rather than
// `clockIn` and baseline their pause on `pausedMsAtCheckpoint` — a different
// window on purpose, not a copy.
//
// Run: node scripts/check-live-hours.mjs [--root src]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

// Web and Android, because the duplication was never confined to one platform —
// the missing open-pause term was written independently on all three. iOS is not
// scanned: Swift cannot be built on every machine this runs on, and a check that
// silently skips a platform is worse than one that says it does not cover it.
const rootArg = process.argv.indexOf("--root");
const ROOTS = rootArg === -1
  ? ["src", "traqs-android/app/src/main/java"]
  : [process.argv[rootArg + 1]];
const FIELD = "totalPausedMs";
const EXEMPT = /live-hours-exempt:/;

// Comments only, blanked rather than removed so line numbers stay true. A
// mention of the field in prose never trips the check; the exemption marker is
// read back from the ORIGINAL text for the same reason.
//
// Strings are deliberately NOT stripped. A quote-matching regex cannot survive a
// 32k-line JSX file — regex literals, apostrophes in prose text and nested
// template literals all derail it — and when it derails it blanks whole regions.
// Stripping strings here silently ate three of the nine real occurrences,
// including the variant-C site this check exists to catch, and still exited with
// a confident count. Arithmetic on the field inside a string literal is not a
// real shape; a check that under-reports is worse than no check at all.
const blank = (m) => m.replace(/[^\n]/g, " ");
const stripped = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, blank)
     .replace(/\/\/[^\n]*/g, blank);

// Arithmetic, not transport. `totalPausedMs: jc.totalPausedMs` handing the field
// to the helper is the shape we WANT and must not be flagged; subtracting,
// dividing or compound-assigning it is the shape that drifts.
// `?:` is Kotlin's elvis and `0.0` its Double literal, so the second shape has
// to cover both languages: `(totalPausedMs ?? 0) /` and `(totalPausedMs ?: 0.0) /`.
const ARITHMETIC = new RegExp(
  `(?:[-+*/]\\s*\\(?\\s*[\\w.?]*\\b${FIELD}\\b)` +      // ... - (jc.totalPausedMs
  `|(?:\\b${FIELD}\\b[^,;\\n]*?(?:\\|\\||\\?\\?|\\?:)\\s*0(?:\\.0)?\\s*\\)?\\s*[-+*/])` +
  `|(?:[-+*/]=\\s*[\\w.?]*\\b${FIELD}\\b)`,             // ms -= jc.totalPausedMs
  "");

const files = [];
for (const root of ROOTS) {
  if (!existsSync(root)) continue;   // a platform checkout may be absent
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|jsx|mjs|kt)$/.test(p)) files.push(p);
    }
  })(root);
}

let failures = 0, checked = 0, exempted = 0;
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  if (!raw.includes(FIELD)) continue;
  checked++;
  const rawLines = raw.split("\n");
  const codeLines = stripped(raw).split("\n");
  // The helper's own body is the one place this arithmetic belongs.
  const helperAt = codeLines.findIndex(l => /(?:export function|fun) liveElapsedHours/.test(l));
  const helperEnd = helperAt === -1 ? -1 : codeLines.findIndex((l, i) => i > helperAt && /^\}/.test(l));

  for (let i = 0; i < codeLines.length; i++) {
    if (!ARITHMETIC.test(codeLines[i])) continue;
    if (helperAt !== -1 && i >= helperAt && i <= helperEnd) continue;
    // Marker may sit on the line or in the few lines of comment above it.
    const near = rawLines.slice(Math.max(0, i - 6), i + 1).join("\n");
    if (EXEMPT.test(near)) { exempted++; continue; }
    failures++;
    console.error(`FAIL ${relative(".", f)}:${i + 1}`);
    console.error(`       raw live-hours math — call liveElapsedHours() or mark it live-hours-exempt`);
    console.error(`       ${rawLines[i].trim().slice(0, 110)}`);
  }
}

console.log(
  `\nchecked ${checked} file(s) referencing ${FIELD}, ${exempted} exempt — ` +
  (failures === 0 ? "no hand-written live-hours math" : `${failures} site(s) outside the helper`)
);
process.exit(failures === 0 ? 0 : 1);
