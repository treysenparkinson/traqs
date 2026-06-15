// Shared org-code helpers for all Netlify functions.
// The org code arrives in the X-Org-Code header (case varies by client/proxy).
// Valid codes are 3–20 alphanumeric chars; anything else is rejected.

// Reads and validates the org code from the request headers.
// Returns the code, or null if it is missing or malformed.
export function orgCodeFromHeader(event) {
  const code = event.headers?.["x-org-code"] || event.headers?.["X-Org-Code"] || "";
  return /^[a-zA-Z0-9]{3,20}$/.test(code) ? code : null;
}

// Builds the S3 key `orgs/{code}/{file}` for the request's org,
// or null if the org code is missing or invalid.
export function orgKey(event, file) {
  const code = orgCodeFromHeader(event);
  return code ? `orgs/${code}/${file}` : null;
}
