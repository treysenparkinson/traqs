// Clock-in PIN hashing.
//
// PINs are short (4–6 digits) and low-entropy, so they were previously stored
// as PLAINTEXT in people.json. That meant a leak of the S3 bucket exposed every
// employee's PIN directly. We now store a keyed hash instead:
//
//     h1$<hex>   where hex = HMAC-SHA256(pin, PIN_PEPPER)
//
// Why keyed HMAC and not bcrypt/scrypt? The kiosk `identify` action has to scan
// EVERY live person to find whose PIN matches, so the comparison must be cheap
// and deterministic (an adaptive per-user salt would force one slow KDF call per
// person per attempt). A pepper kept in the server env (never in the DB) means a
// bucket-only leak can't be reversed offline; with 4-digit PINs that's the
// meaningful win. Set PIN_PEPPER in the deploy env for real protection — the
// fallback below only keeps dev working and is NOT secret.
import crypto from "node:crypto";

const PEPPER = process.env.PIN_PEPPER || "traqs-dev-pin-pepper-set-PIN_PEPPER-in-env";
const PREFIX = "h1$";

/** True if `v` is already a stored hash (vs. legacy plaintext). */
export function isHashed(v) {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** True if this person record has any PIN set (hashed or legacy plaintext). */
export function hasPin(person) {
  return !!(person && person.pin);
}

/**
 * Hash a raw PIN for storage. Idempotent: passing an already-hashed value
 * returns it unchanged, so it's safe to run over a whole roster on every write
 * (lazy migration of legacy plaintext PINs). Empty/nullish → "" (no PIN).
 */
export function hashPin(pin) {
  if (pin == null || pin === "") return "";
  if (isHashed(pin)) return pin;
  const hex = crypto.createHmac("sha256", PEPPER).update(String(pin)).digest("hex");
  return PREFIX + hex;
}

/**
 * Verify a candidate PIN against a stored value. Handles both new hashed values
 * and legacy plaintext (so PINs keep working until the next roster save upgrades
 * them). Constant-time comparison to avoid leaking match progress via timing.
 */
export function verifyPin(candidate, stored) {
  if (candidate == null || candidate === "" || !stored) return false;
  const expected = isHashed(stored) ? stored : String(stored);
  const actual = isHashed(stored) ? hashPin(candidate) : String(candidate);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
