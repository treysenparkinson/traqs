// ESM resolve hook: redirect timeclock.js's _utils/* imports to in-memory stubs
// so the REAL handler runs against a fake S3 and fake auth.
const STUBS = {
  "./_utils/s3.js": `
    export const readJson  = async (key) => (globalThis.__S3[key] === undefined ? null : JSON.parse(JSON.stringify(globalThis.__S3[key])));
    export const writeJson = async (key, v) => { globalThis.__S3[key] = JSON.parse(JSON.stringify(v)); globalThis.__WRITES.push(key); };
  `,
  "./_utils/auth.js": `
    export const requireOrgMember = async () => ({ ...globalThis.__AUTH });
  `,
  "./_utils/cors.js": `
    export const preflight = () => ({ statusCode: 204 });
    export const json = (statusCode, body) => ({ statusCode, body });
    export const err  = (statusCode, message) => ({ statusCode, body: { error: message } });
  `,
  "./_utils/org.js": `
    export const orgCodeFromHeader = () => "TESTORG";
  `,
  // Identity stamping: the test asserts on hours/dates/counters, not on stamps.
  "./_utils/timestamps.js": `
    export const nowIso = () => new Date().toISOString();
    export const stampArray = (next) => next;
    export const stampObject = (next) => next;
    export const softDelete = (r) => ({ ...r, deletedAt: nowIso() });
    export const reconcileDeletions = (next) => next;
    export const changedIds = () => [];
  `,
  "./_utils/entities.js": `
    export const isLive = (r) => !r?.deletedAt;
    export const filterLive = (a) => (Array.isArray(a) ? a.filter(isLive) : a);
  `,
  "./_utils/ably-publish.js": `export const publishChange = async () => {};`,
  "./_utils/push.js": `
    export const sendSilentPush = async () => {};
    export const sendVisiblePush = async () => {};
  `,
  "./_utils/pin.js": `export const verifyPin = async () => true;`,
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return {
      url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]),
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
