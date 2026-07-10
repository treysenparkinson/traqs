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
const PREFIX = "h1$";       // legacy one-way HMAC (unrevealable)
const ENC_PREFIX = "e1$";   // reversible AES-256-GCM (admin-revealable)

// 32-byte key derived from the env pepper. Kept out of the DB, so a bucket-only
// leak still can't decrypt PINs without the server env.
const ENC_KEY = crypto.createHash("sha256").update(PEPPER).digest();

/** True if `v` is a legacy one-way hash. */
export function isHashed(v) {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** True if `v` is a reversible (encrypted) PIN. */
export function isEncrypted(v) {
  return typeof v === "string" && v.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a raw PIN for storage as `e1$<iv>$<ct>$<tag>` (base64). Reversible so
 * admins can reveal it. Idempotent for already-encrypted values; legacy one-way
 * hashes are returned unchanged (they can't be reversed, so they stay hashed and
 * unrevealable until the PIN is re-entered). Empty/nullish → "" (no PIN).
 */
export function encryptPin(pin) {
  if (pin == null || pin === "") return "";
  if (isEncrypted(pin)) return pin;
  if (isHashed(pin)) return pin; // can't recover the original to re-encrypt
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const ct = Buffer.concat([c.update(String(pin), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return ENC_PREFIX + [iv.toString("base64"), ct.toString("base64"), tag.toString("base64")].join("$");
}

/**
 * Reveal a stored PIN. Returns the plaintext for an encrypted or legacy-plaintext
 * value, or null when it can't be recovered (legacy one-way hash / bad data).
 */
export function decryptPin(stored) {
  if (stored == null || stored === "") return "";
  if (isHashed(stored)) return null;          // one-way — unrevealable
  if (!isEncrypted(stored)) return String(stored); // legacy plaintext
  try {
    const [, ivB, ctB, tagB] = stored.split("$");
    const iv = Buffer.from(ivB, "base64");
    const ct = Buffer.from(ctB, "base64");
    const tag = Buffer.from(tagB, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
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
  // Reversible PINs: decrypt then compare the plaintext.
  if (isEncrypted(stored)) {
    const plain = decryptPin(stored);
    if (plain == null) return false;
    const a = Buffer.from(String(candidate));
    const b = Buffer.from(String(plain));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const expected = isHashed(stored) ? stored : String(stored);
  const actual = isHashed(stored) ? hashPin(candidate) : String(candidate);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
