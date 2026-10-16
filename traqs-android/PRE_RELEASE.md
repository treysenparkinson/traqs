# Android pre-release checklist

Work owed before Android's first release. Not defects: they are tracked here, not in
SCHEDULE_MAP.md (moved out of #524 when it closed, 2026-10-16).

Toolchain on Trey's Mac: `JAVA_HOME=/opt/homebrew/opt/openjdk@17`,
`ANDROID_HOME=~/Library/Android/sdk`, AVD `traqs35`; run `bash gradlew …` (gradlew is not
executable in the repo).

- [ ] **Emulator pass against a TEST org, never Matrix's.** Sign in as an admin of a non-Matrix
      org. Delete one person on the Team screen and confirm exactly one tombstone in people.json
      (#442). Save a job and diff tasks.json: unestimated nodes stay 0, and every key the web
      wrote is still there (#520/#228).
- [ ] **versionCode bump** (currently 1), then the release.
