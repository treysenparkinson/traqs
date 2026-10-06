// What a rejected save does to the web client — SCHEDULE_MAP #182/#183/#184.
//
//   node scripts/save-rollback-test.mjs
//
// Executes the REAL source of doSave, rollbackToServer, the 30s poll's refetch,
// busy and applySlice, sliced out of src/TRAQS.jsx by brace matching and run with
// injected fakes. Free variables resolve through a scope Proxy: the named fakes
// below, then real globals, then a recording stub — so an unexpected dependency
// shows up as a stub call instead of a crash.
//
// Contract:
//   - a 4xx rejection (not 401) replaces local tasks/people/clients with the
//     server's copy, clears "unsaved" and keeps the error banner, so the poll
//     and Ably slices resume and the next save cannot resend the rejected change;
//   - a 401 is not a verdict on the edit (the token expired) and a 5xx may be
//     transient, so both keep the local edit and stay "unsaved" for the retry;
//   - an edit made while the rollback fetch is in flight is not clobbered;
//   - no direct saveTasks call bypasses doSave's handling (#184).
import { readFileSync } from "node:fs";
// #223/#224. doSave now strips client-DERIVED defaults before the POST, and the
// sandbox below auto-stubs any identifier it does not know with a function that
// returns UNDEFINED — which turned dedupedTasks into undefined and failed 21
// assertions that have nothing to do with it. The REAL helper is a pure function,
// so the harness imports it rather than stubbing it.
import { stripDerived } from "../src/derived.js";
const SRC = readFileSync(new URL("../src/TRAQS.jsx", import.meta.url), "utf8");

function slice(anchor, { optional = false } = {}) {
  const at = SRC.indexOf(anchor);
  if (at < 0) {
    if (optional) return null;
    console.error("anchor not found in TRAQS.jsx:", anchor);
    process.exit(2);
  }
  const arrow = SRC.indexOf("=>", at);
  const asyncAt = SRC.indexOf("async", at);
  const start = asyncAt >= 0 && asyncAt < arrow ? asyncAt : SRC.indexOf("(", at);
  let i = SRC.indexOf("{", arrow), depth = 0;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) break;
  }
  return SRC.slice(start, i + 1);
}
const BUSY = "const busy = () =>";
const src = {
  // The save body was renamed to `doSaveOnce` by #388: `doSave` is now the
  // serialised wrapper around it (useMemo + serializeRuns), so the old anchor
  // no longer names a function body. Everything this suite checks lives in the
  // body, which is this one.
  doSave: slice("const doSaveOnce = useCallback(async () => {"),
  rollback: slice("const rollbackToServer = async () => {", { optional: true }),
  refetch: slice("const refetch = async () => {"),
  applySlice: slice("const applySlice = async (entity) => {"),
  busy: SRC.slice(SRC.indexOf(BUSY) + "const busy = ".length, SRC.indexOf(";", SRC.indexOf(BUSY))),
};
if (SRC.indexOf(BUSY) < 0) { console.error("anchor not found:", BUSY); process.exit(2); }

function build(code, deps) {
  const stubs = {};
  const scope = new Proxy(deps, {
    has: (_, k) => typeof k === "string" && k !== "globalThis",
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in t) return t[k];
      if (k in globalThis) return globalThis[k];
      return stubs[k] ??= (...a) => { (stubs[k].calls ??= []).push(a); };
    },
  });
  return new Function("scope", `with (scope) { return (${code}); }`)(scope);
}

let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

const SERVER = { tasks: [{ id: "j1", title: "Job", status: "Not Started", subs: [] }], people: [{ id: 7, name: "W" }], clients: [] };
const EDITED = [{ id: "j1", title: "Job", status: "In Progress", subs: [] }];   // the rejected change

function client({ saveTasks, onRollbackFetch, canManageClients = true, saveClients } = {}) {
  const st = { tasks: EDITED, people: SERVER.people, clients: SERVER.clients, error: null };
  const log = { fetchTasks: 0, readSlice: 0 };
  const saveStatusRef = { current: "saved" };
  const deps = {
    stripDerived,
    console: { log() {}, warn() {}, error() {} },
    saveStatusRef,
    setSaveStatus: (s) => { saveStatusRef.current = s; },          // J:6013 mirrors it
    setSaveError: (e) => { st.error = e; },
    dataLoadedRef: { current: true },
    latestTasksRef: { current: st.tasks },
    latestPeopleRef: { current: st.people },
    dataRef: { current: { clients: st.clients, tasks: st.tasks } },
    getTokenRef: { current: async () => "t" }, orgCodeRef: { current: "ORG" },
    getToken: async () => "t", orgCode: "ORG",
    lastSaveTime: { current: 0 }, protectedJobIds: { current: new Set(["j1"]) },
    pollAppliedRef: { current: {} },
    saveTasks, savePeople: async () => ({}),
    saveClients: saveClients || (async () => ({})),
    canManageClientsRef: { current: canManageClients },
    fetchTasks: async () => { log.fetchTasks++; if (onRollbackFetch) { const f = onRollbackFetch; onRollbackFetch = null; f(deps); } return structuredClone(SERVER.tasks); },
    fetchPeople: async () => structuredClone(SERVER.people),
    fetchClients: async () => structuredClone(SERVER.clients),
    readSlice: async () => { log.readSlice++; return []; },
    document: { hidden: false }, deltaSync: async () => {},
    normalizeTasks: (x) => x, normalizePeople: (x) => x,
    cacheFullSlices: () => {},
    // The wrapped setters (J:5432/5445) write latest*Ref synchronously.
    setTasks: (u) => { st.tasks = typeof u === "function" ? u(st.tasks) : u; deps.latestTasksRef.current = st.tasks; },
    // #227 (1). doSave skips a slice whose content key matches the last
    // successful save. Starts empty, which is why every assertion in this file
    // still POSTs: the first save of a session always goes. Modelled because
    // this harness compiles the REAL doSave body — leave it out and doSave
    // throws on `lastSavedRef.current`, the catch reports endpoint "unknown",
    // and twenty-one assertions fail at once. Which is how it was found.
    lastSavedRef: { current: { tasks: null, people: null, clients: null } },
    // #218. The rollback installs the SERVER's copy, so it goes through the
    // uncapturing setter — undoing a rollback would hand the user back the
    // change the server just refused. Modelled identically here because this
    // harness compiles the REAL rollbackToServer body: leave it out and the
    // function silently does nothing, which is how it was found.
    setTasksFromServer: (u) => { st.tasks = typeof u === "function" ? u(st.tasks) : u; deps.latestTasksRef.current = st.tasks; },
    setPeople: (u) => { st.people = typeof u === "function" ? u(st.people) : u; deps.latestPeopleRef.current = st.people; },
    setClients: (u) => { st.clients = typeof u === "function" ? u(st.clients) : u; },
  };
  if (src.rollback) deps.rollbackToServerRef = { current: build(src.rollback, deps) };
  deps.busy = build(src.busy, deps);
  return { st, log, deps, saveStatusRef,
    doSave: build(src.doSave, deps), refetch: build(src.refetch, deps), applySlice: build(src.applySlice, deps) };
}
const rejectWith = (status) => async () => { const e = new Error(`saveTasks failed (${status})`); e.status = status; e.endpoint = "saveTasks"; throw e; };
const settle = () => new Promise(r => setTimeout(r, 700));   // doSave's 600ms "saved" timer
const ticks = async (c) => { for (let i = 0; i < 10; i++) { await c.refetch(); await c.applySlice("tasks"); } };

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Save rejected 403 (a worker without editJobs)");
{
  const c = client({ saveTasks: rejectWith(403) });
  c.saveStatusRef.current = "unsaved";          // the autosave effect, J:8835
  await c.doSave(); await settle();
  ok("status is no longer \"unsaved\"", c.saveStatusRef.current !== "unsaved", true);
  ok("local tasks replaced by the server's copy (rolled back)", c.st.tasks, SERVER.tasks);
  ok("the next save would POST the server's copy, not the rejected change", c.deps.latestTasksRef.current, SERVER.tasks);
  ok("error banner kept", [c.st.error?.endpoint, c.st.error?.status], ["saveTasks", 403]);
  const before = c.log.fetchTasks;
  await ticks(c);
  ok("10 poll ticks fetch tasks again", c.log.fetchTasks - before, 10);
  ok("10 Ably deltas read the tasks slice again", c.log.readSlice, 10);
}

console.log("\n2. Other 4xx rejections roll back the same way");
for (const status of [400, 409, 422]) {
  const c = client({ saveTasks: rejectWith(status) });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok(`${status}: rolled back and not "unsaved"`, [c.st.tasks, c.saveStatusRef.current !== "unsaved"], [SERVER.tasks, true]);
}

console.log("\n3. 401 and 5xx keep the edit for the retry");
for (const status of [401, 500, 503]) {
  const c = client({ saveTasks: rejectWith(status) });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok(`${status}: edit kept, still "unsaved", banner up`, [c.st.tasks, c.saveStatusRef.current, c.st.error?.status], [EDITED, "unsaved", status]);
}

console.log("\n4. An edit made during the rollback fetch is not clobbered");
{
  const NEWER = [{ id: "j1", title: "Renamed while rolling back", status: "Not Started", subs: [] }];
  const c = client({ saveTasks: rejectWith(403), onRollbackFetch: (d) => { d.setTasks(NEWER); d.setSaveStatus("unsaved"); } });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok("the newer edit survives and its own save is left to run", [c.st.tasks, c.saveStatusRef.current], [NEWER, "unsaved"]);
}

console.log("\n4b. A save that lands with conflicts (TASK_CONFLICT_MODE=enforce)");
{
  // The server kept its own copy of the stale jobs and saved the rest, so the
  // server's copy IS the result: roll back to it and say which jobs were kept.
  const c = client({ saveTasks: async () => ({ ok: true, conflicts: ["j1"] }) });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok("local tasks replaced by the server's copy", c.st.tasks, SERVER.tasks);
  ok("not \"unsaved\"", c.saveStatusRef.current !== "unsaved", true);
  ok("banner names the conflict", [c.st.error?.endpoint, c.st.error?.status, /changed/i.test(c.st.error?.message || "")], ["saveTasks", 409, true]);
}
{
  const c = client({ saveTasks: async () => ({ ok: true, conflicts: [] }) });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok("control: an empty conflicts list is a plain success", [c.saveStatusRef.current, c.st.tasks, c.st.error], ["saved", EDITED, null]);
}

console.log("\n4c. A user without manageClients never POSTs /clients");
{
  // POST /clients needs manageClients even for an unchanged list, and doSave sent
  // it on every autosave — so every worker save failed on clients and rolled back.
  let clientPosts = 0;
  const c = client({ saveTasks: async () => ({ ok: true }), canManageClients: false,
    saveClients: async () => { clientPosts++; const e = new Error("saveClients failed (403)"); e.status = 403; e.endpoint = "saveClients"; throw e; } });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok("no clients POST", clientPosts, 0);
  ok("the save succeeds, no banner, edit kept", [c.saveStatusRef.current, c.st.error, c.st.tasks], ["saved", null, EDITED]);
}
{
  let clientPosts = 0;
  const c = client({ saveTasks: async () => ({ ok: true }), canManageClients: true, saveClients: async () => { clientPosts++; return {}; } });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok("control: a user with manageClients still POSTs clients", clientPosts, 1);
}

console.log("\n5. Control: a save that succeeds");
{
  const c = client({ saveTasks: async () => ({ ok: true }) });
  c.saveStatusRef.current = "unsaved";
  await c.doSave(); await settle();
  ok("saved, edit kept, no banner", [c.saveStatusRef.current, c.st.tasks, c.st.error], ["saved", EDITED, null]);
  await ticks(c);
  ok("poll keeps fetching", c.log.fetchTasks, 10);
}

// Structural, not behavioural: #184 is about call sites, so this reads the source.
console.log("\n6. No direct saveTasks call bypasses doSave (#184)");
{
  const code = SRC.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  const calls = [...code.matchAll(/\bsaveTasks\(/g)].length;
  ok("saveTasks( appears once in TRAQS.jsx — inside doSave", calls, 1);
  ok("that one call is doSave's", src.doSave.includes("saveTasks("), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (pass + fail === 0) { console.error("no assertions ran"); process.exit(2); }
process.exit(fail === 0 ? 0 : 1);
