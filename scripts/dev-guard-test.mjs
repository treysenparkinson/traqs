// #454 — local development must not write to production, or reach real people.
//
// `netlify dev` runs the functions with the live S3 credentials, Ably root key,
// OneSignal and VAPID keys and mail settings. So a work-in-progress build running
// on a laptop WROTE MATRIX'S REAL DATA (#453: 287 records, one autosave) and,
// on any edit that changed an assignment, would push a notification to a real
// phone and broadcast over Ably to every production client.
//
// THE TRIPWIRE. `netlify dev` always injects NETLIFY_DEV=true into functions
// (netlify-cli commands/dev/dev.js). With it set:
//   - every S3 WRITE refuses, loudly: _utils/s3.js's mutators and
//     backup-daily.js's own copy/delete. Reads are untouched, so the local app
//     still loads.
//   - Ably publishes, OneSignal and web pushes, and mail are no-ops.
// It is read at CALL time, so a function process cannot cache its way past it.
//
// EVERY CASE BELOW RUNS TWICE: guard on, and guard OFF as the control. The SDK
// clients and fetch are patched to record instead of sending, so "nothing went
// out" is a measured count — and the control proves the same call DOES go out
// when the guard is off. Without the control, a refactor that broke the call
// itself would read as a working guard.
//
//   node scripts/dev-guard-test.mjs
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { codeOf } from "./_code-view.mjs";

const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (label, got, want) => {
  const good = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${good ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  good ? pass++ : fail++;
};

// ── fake credentials, set BEFORE any module reads them at import ────────────
const webpushLib = require("web-push");
const vapid = webpushLib.generateVAPIDKeys();
Object.assign(process.env, {
  S3_BUCKET: "dev-guard-test-no-such-bucket", MY_AWS_REGION: "us-west-1",
  MY_AWS_ACCESS_KEY_ID: "AKIATEST", MY_AWS_SECRET_ACCESS_KEY: "test",
  ONESIGNAL_APP_ID: "test-app", ONESIGNAL_API_KEY: "test-key",
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  SEND_FROM_EMAIL: "noreply@example.test",
});
delete process.env.ABLY_ROOT_KEY;   // control path for Ably: no key, no client
const DEV = (on) => { if (on) process.env.NETLIFY_DEV = "true"; else delete process.env.NETLIFY_DEV; };

// ── record instead of send ──────────────────────────────────────────────────
const sent = [];
const { S3Client } = require("@aws-sdk/client-s3");
const { SESClient } = require("@aws-sdk/client-ses");
const S3_STORE = { "orgs/T/push-subs.json": { "1": [{ endpoint: "https://push.example.test/x", keys: { p256dh: "x", auth: "y" } }] } };
S3Client.prototype.send = async function (cmd) {
  const name = cmd.constructor.name; sent.push("s3:" + name);
  if (name === "GetObjectCommand") {
    const v = S3_STORE[cmd.input.Key];
    if (v === undefined) { const e = new Error("NoSuchKey"); e.name = "NoSuchKey"; throw e; }
    return { Body: Readable.from([Buffer.from(JSON.stringify(v))]), ETag: '"e"' };
  }
  if (name === "ListObjectsV2Command") return { Contents: cmd.input.Prefix === "orgs/" ? (globalThis.__NO_ORGS ? [] : [{ Key: "orgs/T/tasks.json" }]) : [{ Key: "backups/2000-01-01/orgs/T/tasks.json" }] };
  if (name === "HeadObjectCommand") { const e = new Error("NotFound"); e.name = "NotFound"; e.$metadata = { httpStatusCode: 404 }; throw e; }
  return {};
};
SESClient.prototype.send = async function (cmd) { sent.push("ses:" + cmd.constructor.name); return {}; };
globalThis.fetch = async (url) => { sent.push("fetch:" + String(url).replace(/^https:\/\/([^/]+).*/, "$1")); return { ok: true, status: 200, json: async () => ({ id: "n1" }), text: async () => "{}" }; };
webpushLib.sendNotification = async () => { sent.push("webpush:send"); return {}; };

const s3 = await import("../netlify/functions/_utils/s3.js");
const push = await import("../netlify/functions/_utils/push.js");
const webpush = await import("../netlify/functions/_utils/webpush.js");
const mail = await import("../netlify/functions/_utils/mail.js");
const ably = await import("../netlify/functions/_utils/ably-publish.js");
const backup = await import("../netlify/functions/backup-daily.js");
let guard;
try { guard = await import("../netlify/functions/_utils/dev-guard.js"); }
catch (e) { console.error("could not load _utils/dev-guard.js:", e.message); process.exit(2); }
const GUARD = readFileSync(new URL("../netlify/functions/_utils/dev-guard.js", import.meta.url), "utf8");

// Runs fn with the guard on/off; returns what went out and how it ended.
const run = async (on, fn) => {
  DEV(on); sent.length = 0; let outcome;
  try { const r = await fn(); outcome = { ok: r }; } catch (e) { outcome = { threw: e.name, refused: !!e.localDevRefused }; }
  DEV(false);
  return { sent: [...sent], ...outcome };
};
const people = [{ id: "1", name: "W", pushToken: "tok" }];

console.log("\n1. S3 WRITES REFUSE UNDER netlify dev — AND STILL WRITE WITHOUT IT");
const WRITES = {
  writeJson: () => s3.writeJson("orgs/T/tasks.json", []),
  writeJsonIfMatch: () => s3.writeJsonIfMatch("orgs/T/tasks.json", [], '"e"'),
  writeBinary: () => s3.writeBinary("orgs/T/a.bin", Buffer.from("x"), "application/octet-stream"),
  copyObject: () => s3.copyObject("orgs/T/a.json", "orgs/T/b.json"),
  deleteObject: () => s3.deleteObject("orgs/T/a.json"),
  copyPrefix: () => s3.copyPrefix("orgs/T/", "orgs/U/"),
};
for (const [name, fn] of Object.entries(WRITES)) {
  const on = await run(true, fn), off = await run(false, fn);
  ok(`RED: ${name} refuses under netlify dev, and sends nothing that writes`,
    [on.refused, on.sent.filter(s => /Put|Copy|Delete/.test(s))], [true, []]);
  ok(`...control: without it, ${name} reaches S3 with a write`, off.sent.some(s => /Put|Copy|Delete/.test(s)), true);
}
{
  const on = await run(true, () => s3.readJson("orgs/T/push-subs.json"));
  ok("reads are NOT refused — the local app still loads", [on.threw ?? null, on.sent], [null, ["s3:GetObjectCommand"]]);
}

console.log("\n2. backup-daily's OWN S3 CLIENT IS GUARDED TOO");
{
  const on = await run(true, () => backup.handler());
  const off = await run(false, () => backup.handler());
  ok("RED: under netlify dev it copies and prunes nothing", on.sent.filter(s => /Copy|Delete/.test(s)), []);
  ok("...control: without it, it copies and prunes", ["s3:CopyObjectCommand", "s3:DeleteObjectCommand"].every(c => off.sent.includes(c)), true);
  // Nothing to copy: the handler goes straight to pruning, so the prune has to
  // carry its own guard -- the copy's refusal is not there to stop it.
  globalThis.__NO_ORGS = true;
  const onP = await run(true, () => backup.handler());
  const offP = await run(false, () => backup.handler());
  globalThis.__NO_ORGS = false;
  ok("RED: with nothing to copy, it still prunes nothing under netlify dev", onP.sent.filter(s => /Delete/.test(s)), []);
  ok("...control: without it, that run prunes", offP.sent.includes("s3:DeleteObjectCommand"), true);
}

console.log("\n3. NO PUSH, NO BROADCAST, NO MAIL FROM A LAPTOP");
const SIDE = {
  "OneSignal visible push": [() => push.sendVisiblePush("T", people, ["1"], { heading: "h", content: "c" }), /^fetch:onesignal/],
  "OneSignal silent push": [() => push.sendSilentPush("T", { people, personIds: ["1"] }), /^fetch:onesignal/],
  "web push": [() => webpush.sendWebPush("T", ["1"], { title: "t", body: "b" }), /^webpush:send$/],
  "mail": [() => mail.sendEmail({ to: "someone@example.test", subject: "s", html: "<p>x</p>", text: "x" }), /^ses:SendEmailCommand$/],
};
for (const [name, [fn, re]] of Object.entries(SIDE)) {
  const on = await run(true, fn), off = await run(false, fn);
  ok(`RED: ${name} sends nothing under netlify dev`, on.sent.filter(s => re.test(s)), []);
  ok(`...control: without it, ${name} goes out`, off.sent.some(s => re.test(s)), true);
}
{
  // Ably's control has no key (so it cannot reach the network from a test); the
  // guard's own record is what distinguishes "skipped by the tripwire" from
  // "not configured".
  globalThis.__DEV_GUARD_SKIPS = [];
  await run(true, () => ably.publishChange("T", "tasks", { ids: ["1"] }));
  const onSkips = [...globalThis.__DEV_GUARD_SKIPS];
  globalThis.__DEV_GUARD_SKIPS = [];
  await run(false, () => ably.publishChange("T", "tasks", { ids: ["1"] }));
  ok("RED: the Ably broadcast is skipped by the tripwire under netlify dev", onSkips.includes("ably"), true);
  ok("...control: without it, the tripwire does not fire", globalThis.__DEV_GUARD_SKIPS.length, 0);
}

console.log("\n4. THE TWO DIRECT OneSignal CALLS (timeoff.js, notify.js) ARE GUARDED");
// These bypass push.js with their own fetch. Driving the handlers needs auth and
// a store; the guard is checked at the one condition that gates each fetch (R4:
// exactly one OneSignal fetch per file, and the gate is the condition above it).
for (const f of ["timeoff.js", "notify.js"]) {
  const code = codeOf(readFileSync(new URL(`../netlify/functions/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n"));
  const n = code.split('fetch("https://onesignal.com/api/v1/notifications"').length - 1;
  if (n !== 1) { console.error(`${f}: expected one OneSignal fetch, found ${n}`); process.exit(2); }
  const before = code.slice(0, code.indexOf('fetch("https://onesignal.com/api/v1/notifications"'));
  const gate = before.slice(before.lastIndexOf("appId"));   // the nearest credential check above the fetch
  ok(`RED: ${f}'s OneSignal fetch is gated by localDevSkip`, /localDevSkip\("onesignal"\)/.test(before.slice(before.lastIndexOf("apiKey") - 120)), true);
  ok(`...and the gate is the credential check that precedes it`, /appId/.test(gate), true);
}

console.log("\n5. THE SWITCH IS READ AT CALL TIME, NOT IMPORT TIME");
DEV(true); const a = guard.isLocalDev(); DEV(false); const b = guard.isLocalDev();
ok("isLocalDev follows NETLIFY_DEV as it changes", [a, b], [true, false]);
process.env.NETLIFY_DEV = "false"; const c = guard.isLocalDev(); DEV(false);
ok("...and only the exact value \"true\" turns it on", c, false);

console.log("\n6. THE REFUSAL REACHES THE DEVELOPER INSTEAD OF BECOMING A BARE 500");
{
  // #499. The guard throws a 503 that says exactly why. timeclock.js caught it
  // in `catch { return err(500, "Failed to save timeclock") }` — a bare catch
  // that discards the error — so a developer saw "fails to save" with no cause.
  // That is what it cost: a live bug report, and a diagnosis that went to a real
  // timezone bug (#498) before the console showed the guard underneath it.
  const TC = readFileSync(new URL("../netlify/functions/timeclock.js", import.meta.url), "utf8");
  const bare = (TC.match(/catch \{ return err\(500, "Failed to (save|write)[^"]*"\)/g) || []).length;
  ok("no WRITE failure is reported without its cause", bare, 0);
  // The idiom: an error carrying a statusCode surfaces it; anything else keeps
  // the generic message. The same shape the auth catches in this file use.
  ok("...they surface a statusCode when the error has one",
    /catch \(e\) \{ return err\(e\.statusCode \|\| 500, e\.statusCode \? e\.message : "Failed to save timeclock"\); \}/.test(TC), true);
  ok("the refusal carries a 503 and names the reason",
    [new guard.LocalDevWriteRefused("x").statusCode, /#454/.test(new guard.LocalDevWriteRefused("x").message)], [503, true]);
  // Reads keep their plain message: the guard never refuses a read, so a read
  // failure really is just a read failure.
  ok("a READ failure is still a plain 500", /catch \{ return err\(500, "Failed to read/.test(TC), true);
}

console.log("\n7. OPTION 2(e): A DEV BUCKET MAY BE WRITTEN; PRODUCTION MAY NOT");
{
  // #500. The tripwire made local dev read-only, by design and "until option 2
  // exists" (#454). This is the half of option 2 that is code: writes are
  // allowed when S3_BUCKET is the bucket the developer NAMED as their dev
  // bucket, and production is refused BY NAME regardless of what else is set.
  const env = (o) => { for (const [k, v] of Object.entries(o)) { if (v === null) delete process.env[k]; else process.env[k] = v; } };
  const refused = (fn) => { try { fn(); return false; } catch (e) { return !!e.localDevRefused; } };
  const save = { NETLIFY_DEV: process.env.NETLIFY_DEV ?? null, S3_BUCKET: process.env.S3_BUCKET ?? null, DEV_S3_BUCKET: process.env.DEV_S3_BUCKET ?? null };

  env({ NETLIFY_DEV: "true", S3_BUCKET: "traqs-dev", DEV_S3_BUCKET: "traqs-dev" });
  ok("a write to the named dev bucket is ALLOWED", refused(() => guard.refuseWriteInLocalDev("writeJson orgs/DEV/people.json")), false);

  // The default is unchanged: no DEV_S3_BUCKET means the tripwire stays shut.
  env({ DEV_S3_BUCKET: null });
  ok("...but only once it is named — unset still refuses", refused(() => guard.refuseWriteInLocalDev("writeJson orgs/DEV/people.json")), true);

  // The point of the exercise: production is refused by name even if somebody
  // points DEV_S3_BUCKET at it. A typo must not re-open #453.
  env({ S3_BUCKET: "traqs-bucket", DEV_S3_BUCKET: "traqs-bucket" });
  ok("PRODUCTION IS REFUSED BY NAME, even when named as the dev bucket",
    refused(() => guard.refuseWriteInLocalDev("writeJson orgs/MTX2026TRAQS/people.json")), true);

  // A mismatch is refused too: the developer is pointed at one bucket and thinks
  // they are writing another.
  env({ S3_BUCKET: "traqs-bucket", DEV_S3_BUCKET: "traqs-dev" });
  ok("a mismatch between target and dev bucket refuses", refused(() => guard.refuseWriteInLocalDev("writeJson orgs/X/a.json")), true);
  // ...and the mismatch must refuse on its OWN account, not because the target
  // happened to be production. A mutant that allowed any non-production write
  // survived the case above for exactly that reason.
  env({ S3_BUCKET: "traqs-somewhere-else", DEV_S3_BUCKET: "traqs-dev" });
  ok("...even when NEITHER bucket is production", refused(() => guard.refuseWriteInLocalDev("writeJson orgs/X/a.json")), true);

  // And none of it applies off the laptop.
  env({ NETLIFY_DEV: null, S3_BUCKET: "traqs-bucket", DEV_S3_BUCKET: null });
  ok("production writes are untouched when not in local dev", refused(() => guard.refuseWriteInLocalDev("writeJson orgs/X/a.json")), false);

  ok("the production bucket is named in one place", /const PRODUCTION_BUCKET = "traqs-bucket";/.test(GUARD), true);
  env(save);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
