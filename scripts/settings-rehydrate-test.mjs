// A settings rehydrate REPLACES the copy in memory; it does not merge over it — #225.
//
// The rehydrate did `setOrgSettings(prev => withOrgDefaults({ ...prev, ...s }))`, so a key another
// client REMOVED could never go: the spread kept the old value. The mount load already did the
// right thing — base defaults plus the server copy, never `prev`. Both now build the settings
// object with the same function, orgSettingsFromStored. (The stale-copy half of the entry was
// already closed by orgSettingsDirty and the mount's replace.)
//
// Scoped, comments stripped (R4).
//
//   node scripts/settings-rehydrate-test.mjs

import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) { pass++; console.log("ok    " + m); } else { fail++; console.error("FAIL  " + m); } };
const S = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n").replace(/^\s*\/\/.*$/gm, "");

const reAt = S.indexOf('} else if (entity === "settings") {');
const re = S.slice(reAt, S.indexOf("}\n", S.indexOf("setOrgSettings(", reAt)) + 2);
ok("the settings rehydrate is found", reAt > 0);
ok("#225 it no longer spreads the incoming copy over the old one", !/\.\.\.prev,\s*\.\.\.s/.test(re));
ok("#225 it builds the settings the way the mount load does", /orgSettingsFromStored\(s\)/.test(re));
const lAt = S.indexOf("fetchOrgSettings(getToken, orgCode)");
ok("#225 ...and the mount load uses the same function", /orgSettingsFromStored\(server\)/.test(S.slice(lAt, lAt + 1500)));
ok("the function is defined once", (S.match(/const orgSettingsFromStored = /g) || []).length === 1);

// Behaviour: evaluate the function from source.
const fAt = S.indexOf("const orgSettingsFromStored = ");
const fnSrc = S.slice(fAt + "const orgSettingsFromStored = ".length, S.indexOf("\n};", fAt) + 2);
const withOrgDefaults = (x) => x;
const TD = "2026-10-15";
const DEFAULT_ORG_SETTINGS = { lunch: { time: "12:00", durationMinutes: 30 } };
const orgSettingsFromStored = eval(fnSrc);
const out = orgSettingsFromStored({ workStart: "08:00", customCols: [] });
ok("#225 a key the stored copy no longer has is gone (nothing is read from what was in memory)", !("removedKey" in out) && out.workStart === "08:00");
ok("...defaults fill what the stored copy never had", out.payPeriodHourCap === 80 && Array.isArray(out.payDates));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
