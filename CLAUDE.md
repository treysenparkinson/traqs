# Working agreements for this repository

Standing rules, kept here so they survive a new machine and apply to anyone
working in this repo. The defect campaign's own rules — how findings get written
down, how entries get corrected, how assertions get scoped — live at the top of
`SCHEDULE_MAP.md` as R1–R4 and are not repeated here.

## Commits and pushes

**Commit locally as you go. Push only when asked.**

Every push triggers a Netlify build, and the builds cost credits. Trey batches
several items and pushes once.

- Commit each finished item on its own, with a full message. Deferring the push is
  not a reason to batch several items into one commit.
- `git push` runs only on an explicit instruction. "Commit and push" means both;
  "commit" means only the commit.
- **Say plainly when something unpushed should be live.** A fix for something being
  hit today, or anything that changes production behaviour, gets named in the
  report as waiting on a push — not left in the log for someone to notice. A
  silent local commit of a production fix is the failure this rule could otherwise
  create, so the flag leads the report rather than trailing it.
- When nothing unpushed is user-facing, say so briefly, so the absence is a
  statement rather than an omission.

## Before saying a change is ready

- `npm run build` is the project's build: it runs lint first, then every suite,
  then `vite build`. Run that, not a subset — `npx vite build` plus a glob over
  `scripts/*-test.mjs` skips lint and misses suites.
- Audit the whole diff before handing off, and flag anything outside the requested
  scope.
- New behaviour gets a suite, written red first, wired into `npm run build`, and
  proved by mutation: change the fix, confirm an assertion fails. A mutant that is
  SKIPPED on a duplicated anchor, or "caught" by a crash rather than a failed
  assertion, has proved nothing.
