// Which identity provider an Auth0 user signed in with, read off the JWT `sub`.
//
// Auth0 prefixes every sub with the connection strategy that minted it:
//   google-oauth2|1234      Google
//   windowslive|abcd        Microsoft personal account
//   waad|…                  Microsoft Entra ID (Azure AD) enterprise connection
//   auth0|…, email|…        database / passwordless — neither provider
//
// Settings › Organization › Sign-in domain stores the allowed set on the org
// config as `identityProviders: ["google", "microsoft"]`. Absent or empty means
// unrestricted, which is every org that predates the setting.

export const IDENTITY_PROVIDERS = ["google", "microsoft"];

export function providerForSub(sub) {
  const strategy = String(sub || "").split("|")[0].toLowerCase();
  if (strategy === "google-oauth2") return "google";
  if (strategy === "windowslive" || strategy === "waad" || strategy.startsWith("microsoft")) return "microsoft";
  return "other";
}

/** The org's allowed set, or null when sign-in is not restricted by provider. */
export function allowedProviders(config) {
  const list = Array.isArray(config?.identityProviders)
    ? config.identityProviders.filter((p) => IDENTITY_PROVIDERS.includes(p))
    : [];
  return list.length ? list : null;
}
