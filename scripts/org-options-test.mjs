// Status and Priority options are ORG-WIDE.
//
// They used to live in the per-account store -- localStorage plus the per-user S3
// blob that syncs a person's theme and layout between their machines. So an admin
// renaming a status, recolouring a priority or adding a stage changed it for
// themselves and nobody else, and two people in the same organization could hold
// different lists of which statuses exist.
//
//   node scripts/org-options-test.mjs
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };

// ── the source of truth moved ────────────────────────────────────────────────
ok("status options are read from orgSettings", S.includes("const s = orgSettings.statusOpts;"));
ok("priority options are read from orgSettings", S.includes("const s = orgSettings.priOpts;"));
ok("editing status writes through to orgSettings",
  /setStatusOpts = useCallback\(\(v\) => setOrgSettings\(/.test(S));
ok("editing priority writes through to orgSettings",
  /setPriOpts = useCallback\(\(v\) => setOrgSettings\(/.test(S));
// A useState seeded from orgSettings needs an effect to follow it, and that effect
// is how the copy went stale in the first place.
ok("neither is held as its own state any more",
  !/\[statusOpts, setStatusOpts\] = useState/.test(S) && !/\[priOpts, setPriOpts\] = useState/.test(S));

// ── the per-account store no longer carries them ─────────────────────────────
// Left in the bundle, this account's copy would be written back into orgSettings on
// every sign-in and hand the whole organization one user's stale list.
const bundle = S.match(/const bundle = \{[^}]*\}/)[0];
ok("the synced per-user bundle does not carry the status list", !bundle.includes("statusOpts"));
ok("...nor the priority list", !bundle.includes("priOpts"));
ok("...and the remote per-user copy is not applied over the org's",
  !/setStatusOpts\(remote\.statusOpts\)/.test(S) && !/setPriOpts\(remote\.priOpts\)/.test(S));
// It IS captured, because the bundle no longer carries these and this read is
// the only place they are seen.
//
// THE REASON CHANGED, so this is a new rule rather than the old one with its
// answer flipped (R3). It used to be "capture them before the next write
// DESTROYS them", which held only while user-settings.js replaced the blob
// wholesale. #441 made it MERGE, so a key no client sends is now KEPT — these
// two linger in the blob instead of being collected. The capture is still
// required, for a different reason: the bundle does not carry them, so without
// it they would never reach the org's list at all. What is no longer true is
// that they are on a clock.
ok("...and it IS captured, because nothing else will ever read it",
  S.includes("legacyOptsRef.current.statusOpts = remote.statusOpts") &&
  S.includes("legacyOptsRef.current.priOpts = remote.priOpts"));
ok("...and the blob MERGES now, so the capture is not racing a deletion",
  readFileSync(new URL("../netlify/functions/user-settings.js", import.meta.url), "utf8")
    .includes("writeJson(s3Key, stampObject(merged, existing))"));
ok("...and the wholesale write it used to race is gone",
  !readFileSync(new URL("../netlify/functions/user-settings.js", import.meta.url), "utf8")
    .includes("writeJson(s3Key, stampObject(settings, existing))"));
ok("nothing writes the legacy localStorage keys any more",
  !/localStorage\.setItem\("tq_(status|pri)_opts"/.test(S));
// The bundle's effect must not still list them as dependencies, or a render that
// recomputes the memo re-fires a sync for values it no longer sends.
const dep = S.match(/\}, \[themeMode, customTheme[^\]]*\]\)/g) || [];
ok("the sync effect's dependencies match what it sends",
  dep.length > 0 && dep.every((d) => !d.includes("statusOpts") && !d.includes("priOpts")));

// ── the one-time migration, which MERGES ─────────────────────────────────────
// Every admin customised their own copy while these were personal, so they hold
// DIFFERENT lists -- one added Paused and Late, another added Crated. Seeding the
// org from whoever loaded first would throw the others away permanently.
ok("each admin's pre-move list is still read", S.includes('cached("tq_status_opts")') && S.includes('cached("tq_pri_opts")'));
ok("...preferring their account's server copy over this machine's cache",
  S.includes('legacyOptsRef.current.statusOpts || cached("tq_status_opts")'));
ok("...only by someone who may change organization settings", S.includes('if (!can("orgSettings")) return;'));
ok("...and only once BOTH reads have answered",
  S.includes("if (!orgSettingsLoadedRef.current || !userSettingsLoadedRef.current) return;"));
ok("...each set however its fetch resolves, not only on success",
  /\.finally\(\(\) => \{ orgSettingsLoadedRef\.current = true; \}\)/.test(S) &&
  /\.finally\(\(\) => \{ if \(!cancelled\) userSettingsLoadedRef\.current = true; \}\)/.test(S));
ok("it folds into the org's list rather than replacing it", S.includes("const fold = (orgList, mine) =>"));
ok("...keeping the org's own order and colours in front", S.includes("return added.length ? [...base, ...added] : null;"));
ok("...and runs at most once per session", S.includes("optsMigratedRef.current = true;"));
// Without this the cached copy is re-folded on every load, resurrecting options an
// admin has since deleted.
ok("...and at most once per browser, ever", S.includes('localStorage.setItem(OPTS_MIGRATED_KEY, "1")'));
ok("...with the legacy cache cleared behind it",
  S.includes('localStorage.removeItem("tq_status_opts"); localStorage.removeItem("tq_pri_opts");'));

// ── who may change them ──────────────────────────────────────────────────────
// settings.js already refuses the write without the orgSettings permission, and
// saveOrgSettings only console.warns on the 403. Offering the editor to everyone
// would mean a member rearranges the list, watches it apply, and finds it
// reverted on the next load with nothing having said so.
ok("the built-in option editor is offered only to someone who may save it",
  S.includes('if (isStd && !can("orgSettings")) return null;'));
ok("...and the server is the one actually enforcing it",
  readFileSync(new URL("../netlify/functions/settings.js", import.meta.url), "utf8")
    .includes('requirePerm(member, "orgSettings")'));

// ── everything that draws a pill reads the same list ─────────────────────────
// If any of these were built from the module defaults instead, that surface would
// keep showing the stock five no matter what an admin did.
ok("the name list is derived from the options", /const STATUSES = useMemo\(\(\) => statusOpts\.map/.test(S));
ok("the colour map is derived from the options", /const STA_C = useMemo\(.*statusOpts\.map/.test(S));
ok("the icon map is derived from the options", /const STA_ICON = useMemo\(.*statusOpts\.map/.test(S));
ok("the priority colour map is derived from the options", /const PRI_C = useMemo\(.*priOpts\.map/.test(S));
// The module-level defaults are a fallback only; a second reader would be a second
// answer to "which statuses exist".
const DEF = /DEFAULT_STA_C|DEFAULT_STA_ICON|DEFAULT_PRI_C|DEFAULT_STATUSES|DEFAULT_PRIORITIES/;
const readers = S.split(/\r?\n/)
  .map((line, i) => ({ n: i + 1, line }))
  .filter((r) => DEF.test(r.line))
  // The declarations themselves.
  .filter((r) => !/^const DEFAULT_(STA_C|STA_ICON|PRI_C|STATUSES|PRIORITIES) *=/.test(r.line.trim()));
ok("exactly five places read the module defaults", readers.length === 5);
ok("...and every one of them is a fallback inside the derived list or map",
  readers.every((r) => /const (STA_C|STA_ICON|PRI_C) = useMemo/.test(r.line)
    || /Array\.isArray\(s\) && s\.length \?/.test(r.line)));

// ── the behaviour, modelled ──────────────────────────────────────────────────
// Two people, one organization. What A saves is what B reads.
const DEFAULTS = [{ name: "Not Started" }, { name: "Pending" }, { name: "In Progress" }, { name: "On Hold" }, { name: "Finished" }];
const org = (settings) => {
  let s = { ...settings };
  return {
    read: () => (Array.isArray(s.statusOpts) && s.statusOpts.length ? s.statusOpts : DEFAULTS),
    write: (v) => { s = { ...s, statusOpts: typeof v === "function" ? v(s.statusOpts || []) : v }; },
    raw: () => s,
  };
};
const shared = org({});
ok("an org that has never touched them reads the stock list", shared.read().length === 5);
const adminEdit = [...DEFAULTS, { name: "Shipped", color: "#10b981" }];
shared.write(adminEdit);
ok("an admin adds a stage and the org's copy has it", shared.read().some((o) => o.name === "Shipped"));
// The point: a second person reading the SAME org settings sees it, with no sync
// step of their own, because there is only one list now.
const asSeenByEmployee = org(shared.raw());
ok("a second member sees it, reading the same org settings",
  asSeenByEmployee.read().some((o) => o.name === "Shipped"));
shared.write((prev) => prev.filter((o) => o.name !== "On Hold"));
ok("a removal reaches them too", !org(shared.raw()).read().some((o) => o.name === "On Hold"));
ok("...and the functional form saw the org's list, not an empty array",
  org(shared.raw()).read().length === 5);
const recoloured = org(shared.raw());
recoloured.write(recoloured.read().map((o) => (o.name === "Pending" ? { ...o, color: "#ff0000" } : o)));
ok("a recolour is carried on the option, so every pill follows",
  recoloured.read().find((o) => o.name === "Pending").color === "#ff0000");
// An empty list must not lock the organization out of every status it has.
const emptied = org({ statusOpts: [] });
ok("an empty stored list falls back to the stock five rather than none", emptied.read().length === 5);

// ── two admins with different lists, modelled on the shipped fold ────────────
// The situation this exists for: one admin's list has Paused and Late, another's
// has Crated, and a job already carries "Crated" so it renders as a grey pill with
// no icon for everyone who does not have that option.
{
  const foldSrc = S.match(/const fold = \(orgList, mine\) => \{[\s\S]*?\n    \};/)[0];
  const fold = new Function(foldSrc + " return fold;")();
  const N = (l) => (l || []).map((o) => o.name).join(",");
  const STOCK = ["Not Started", "Pending", "In Progress", "On Hold", "Finished"].map((name) => ({ name }));

  const adminA = [...STOCK.filter((o) => o.name !== "On Hold"), { name: "Paused" }, { name: "Late" }];
  const adminB = [...STOCK, { name: "Crated" }];

  // A loads first: the org has nothing, so their list becomes it.
  let org = fold(null, adminA);
  ok("the first admin to load seeds the org's list", N(org) === N(adminA));
  // B loads second. Under a seed-if-empty rule their Crated would be lost for good.
  org = fold(org, adminB);
  ok("the second admin's additions are folded in, not dropped", N(org).includes("Crated"));
  ok("...and the first admin's survive alongside them",
    N(org).includes("Paused") && N(org).includes("Late"));
  ok("...with the org's existing order kept in front", N(org).startsWith(N(adminA)));
  // On Hold is back, because B still had it. That is the deliberate trade: a fold
  // cannot tell "deleted" from "never had", and losing a status is worse.
  ok("a status only one admin still had comes back, to be deleted once if unwanted",
    N(org).includes("On Hold"));

  // Order is irrelevant to the outcome: B first, then A, reaches the same set.
  const other = fold(fold(null, adminB), adminA);
  ok("the result does not depend on who loads first",
    new Set(N(other).split(",")).size === new Set(N(org).split(",")).size &&
    N(other).split(",").every((n) => N(org).split(",").includes(n)));

  // Nothing to say, nothing written -- an admin who already agrees does not churn
  // org settings or fire a save toast at everyone.
  ok("an admin whose list adds nothing writes nothing", fold(org, adminA) === null);
  ok("an admin with no legacy list at all writes nothing", fold(org, null) === null);
  ok("...and an empty one likewise", fold(org, []) === null);
  // Names are compared loosely: the same status typed with different casing or a
  // stray space is the same status, not a second entry.
  ok("the same name in another casing is not added twice",
    fold(org, [{ name: " crated " }]) === null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
