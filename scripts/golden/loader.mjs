// ESM resolve hook for golden scenarios: the REAL handlers, the real cors / org / pin / timestamps
// / entities / update-json, and a storage module that forwards to whichever store the scenario
// runner installed in globalThis.__STORE (in-memory today, Postgres in plan step 6).
//
// Stubbed, and only these: auth (an Auth0 JWT can't be minted here; the scenario says who is
// calling), and the four network side effects (Ably, OneSignal, web push, SES), which are
// recorded into globalThis.__EFFECTS instead of sent, so the golden captures them too.

const STORE_FORWARD = `
  const S = () => globalThis.__STORE;
  export const readJson = (...a) => S().readJson(...a);
  export const writeJson = (...a) => S().writeJson(...a);
  export const readJsonVersioned = (...a) => S().readJsonVersioned(...a);
  export const writeJsonIfMatch = (...a) => S().writeJsonIfMatch(...a);
  export const listOrgCodes = (...a) => S().listOrgCodes(...a);
  export const writeBinary = (...a) => S().writeBinary(...a);
  export const readBinaryWithMeta = (...a) => S().readBinaryWithMeta(...a);
  export const copyPrefix = (...a) => S().copyPrefix(...a);
  export const copyObject = (...a) => S().copyObject(...a);
  export const deleteObject = (...a) => S().deleteObject(...a);
  // instanceof checks and the .preconditionFailed flag must both hold for every backend.
  export class PreconditionFailed extends Error {
    constructor(key) { super("Precondition failed: " + key); this.name = "PreconditionFailed"; this.preconditionFailed = true; }
  }
`;

const effect = (kind) => `(...args) => { (globalThis.__EFFECTS ??= []).push({ kind: ${JSON.stringify(kind)}, args: JSON.parse(JSON.stringify(args, (k, v) => v === undefined ? null : v)) }); }`;

export const STUBS = {
  "./_utils/s3.js": STORE_FORWARD,
  "./s3.js": STORE_FORWARD,
  "./_utils/auth.js": `
    export class AuthError extends Error { constructor(statusCode, message) { super(message); this.statusCode = statusCode; } }
    export const requireOrgMember = async () => {
      const f = globalThis.__AUTH_FAIL;
      if (f) throw new AuthError(f.status, f.message || "auth failed");
      if (!globalThis.__AUTH) throw new AuthError(401, "Missing token");
      return { ...globalThis.__AUTH };
    };
    export const validateToken = async () => {
      const f = globalThis.__AUTH_FAIL;
      if (f) throw new AuthError(f.status, f.message || "auth failed");
      if (!globalThis.__AUTH) throw new AuthError(401, "Missing token");
      return { sub: "auth0|" + (globalThis.__AUTH.email || "x") };
    };
    export const emailForToken = async () => ({ email: globalThis.__AUTH?.email ?? null, transient: false });
  `,
  "./_utils/ably-publish.js": `export const publishChange = async (...a) => { (${effect("ably")})(...a); };`,
  "./_utils/push.js": `
    export const sendSilentPush = async (...a) => { (${effect("silentPush")})(...a.map(x => x && x.people ? { ...x, people: undefined } : x)); };
    export const sendVisiblePush = async (orgCode, people, personIds, msg) => { (${effect("visiblePush")})(orgCode, personIds, msg); return { id: "os_test" }; };
  `,
  "./_utils/webpush.js": `
    export const webPushConfigured = () => false;
    export const subsKey = (orgCode) => "orgs/" + orgCode + "/push-subs.json";
    export const sendWebPush = async (...a) => { (${effect("webPush")})(...a); return { sent: 0 }; };
  `,
  "./_utils/mail.js": `
    export const FROM_EMAIL = "noreply@test.invalid";
    export const REPLY_TO = "";
    export const appBaseUrl = () => "https://traqs.test";
    export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    export const sendEmail = async (msg) => { (${effect("email")})({ to: msg.to, subject: msg.subject }); return { ok: true }; };
  `,
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
  return next(specifier, context);
}
