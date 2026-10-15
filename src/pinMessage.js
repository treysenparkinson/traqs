// What a failed Time Clock PIN action should SAY. The server checks the PIN before
// it does anything else, so only its "Invalid PIN" means the PIN was wrong; every
// other failure happened to an accepted PIN and is reported in the server's words.
// Null means "wrong PIN": the keypad shakes and reads "Incorrect PIN".
// See scripts/pin-message-test.mjs.
export const pinErrorMessage = res =>
  res?.error === "Invalid PIN" ? null : (res?.error || "Something went wrong. Try again.");
