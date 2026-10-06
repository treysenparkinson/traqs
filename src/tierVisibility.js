// Is a Business-only control visible, given what we know about the tier? (#421)
//
// `billingTier` is not a fact the app has at mount. It initialises from
// `localStorage.getItem("tq_tier_" + orgCode) || "basic"` and is corrected when
// `fetchBilling` resolves; `billingLoaded` is how you tell "fetched, and the
// answer is Basic" from "not fetched yet". Before this, every tier gate read the
// tier directly, so on a Business org's FIRST load in a fresh browser the nav was
// built from the "basic" default and Business entries were absent until the fetch
// landed — then appeared.
//
// TREY'S RULING, and the reason it goes this way round:
//
//   "Show the Business set while the tier is unknown, then remove what doesn't
//    apply once it loads. A missing row that appears is confusing; a present row
//    that vanishes at least shows something happened, and the enforced features
//    all have server checks behind them so nothing is given away by rendering a
//    nav entry for a second. Gate on billingLoaded for the REMOVAL, not the
//    render."
//
// So an unknown tier shows everything and the gate only ever TAKES AWAY. That is
// safe precisely because the three enforced features — Clients, Approval
// templates and the email-domain allowlist — are checked server-side as well
// (`org.js` on the domain and identity providers, `clients.js` on client writes).
// Hiding a control is a suggestion; the server is the boundary.
//
// NOT USED FOR EDITABLE FIELDS, deliberately. The "Sign-in domain" row stays
// gated on the tier alone: it sits in a section with a draft and an explicit
// Save, so showing it and taking it away a moment later could drop something
// half-typed. A nav entry that vanishes costs nothing; a field that vanishes
// mid-edit costs the edit.

/**
 * Whether a Business-only NAV entry should be shown.
 * @param {string} billingTier  "basic" | "business" — may still be the default
 * @param {boolean} billingLoaded  true once fetchBilling has answered
 */
export function businessOnlyVisible(billingTier, billingLoaded) {
  if (!billingLoaded) return true;          // unknown — show, and remove later
  return billingTier === "business";
}
