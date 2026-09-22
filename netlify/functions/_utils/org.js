// Shared org-key helpers for all Netlify functions.
//
// The org code arrives in the X-Org-Code header (casing varies by client and
// proxy). What counts as a valid code is defined once, in orgcode.js — this
// module held its own copy of that rule, which is how the format came to be
// enforced in five separate places.
import { orgCodeFromHeader } from "./orgcode.js";

export { orgCodeFromHeader };

// Builds the S3 key `orgs/{code}/{file}` for the request's org,
// or null if the org code is missing or invalid.
export function orgKey(event, file) {
  const code = orgCodeFromHeader(event);
  return code ? `orgs/${code}/${file}` : null;
}
