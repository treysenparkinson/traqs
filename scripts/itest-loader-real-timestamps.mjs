// Same stubs as timeclock-itest-loader.mjs, but the REAL _utils/timestamps.js:
// concurrency tests need real lastModifiedAt stamps to tell a stale job copy
// from a fresh one.
import { STUBS as BASE } from "./timeclock-itest-loader.mjs";
const STUBS = { ...BASE };
delete STUBS["./_utils/timestamps.js"];

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) {
    return { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
  }
  return next(specifier, context);
}
