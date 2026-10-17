// Did the person who tapped a name on the roster sign in as somebody else?
//
// Decided by PERSON ID, not email. The roster you tap is the unauthenticated one, which since
// #385 carries no email — comparing emails compared the Auth0 address against `undefined` and
// showed "Wrong account" on every name-tap sign-in. /org-config reports which person the token
// resolved to (`personId`), and the roster still carries `id`.
//
// No verdict without both ids: /org-config has not answered yet, or the token matched no person
// row at all — a membership question, which the not-in-team check owns.
//
// See scripts/wrong-account-test.mjs.
export function isWrongAccount(saved, orgConfig) {
  if (saved?.id == null) return false;
  const signedIn = orgConfig?.personId;
  if (signedIn == null) return false;
  return String(saved.id) !== String(signedIn);
}
