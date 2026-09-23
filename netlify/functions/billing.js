// An org's tier.
//
//   GET   auth  — { tier, requestedTier, ... } for this org
//   POST  auth + orgSettings — register interest in Business
//
// WHY A SEPARATE FILE and not a field on config.json: config.json is
// PUBLIC-READ through org-lookup.js, which the unauthenticated sign-in screen
// uses to show an org's name. A tier field there would expose every org's plan
// to anyone who can walk the code space — and worse, it would stay exposed by
// default, so one carelessly added billing field later leaks with it. Behind
// auth is the safer default to start from.
//
// Business is NOT self-serve. POST records that an admin asked; it does not
// change the tier. Provisioning is manual, which is also how Matrix got its.

import { readJson, writeJson } from "./_utils/s3.js";
import { preflight, json, err } from "./_utils/cors.js";
import { requireOrgMember } from "./_utils/auth.js";
import { requirePerm } from "./_utils/can.js";
import { nowIso } from "./_utils/timestamps.js";

const billingKey = (code) => `orgs/${code}/billing.json`;

// An org with no billing.json is Basic. Absence means "never provisioned",
// which is exactly Basic — so there is nothing to backfill and no migration.
const DEFAULT = { tier: "basic", requestedTier: null, requestedAt: null, requestedBy: null };

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflight();

  let member;
  try { member = await requireOrgMember(event); }
  catch (e) { return err(e.statusCode || 401, e.message); }
  const code = member.orgCode;

  if (event.httpMethod === "GET") {
    const billing = (await readJson(billingKey(code)).catch(() => null)) ?? {};
    return json(200, { ...DEFAULT, ...billing });
  }

  // Register interest. The tier is never changed here — an endpoint that could
  // upgrade an org on request would be a self-serve purchase flow, which this
  // deliberately is not.
  if (event.httpMethod === "POST") {
    try { requirePerm(member, "orgSettings"); } catch (e) { return err(e.statusCode, e.message); }
    const existing = (await readJson(billingKey(code)).catch(() => null)) ?? {};
    if (existing.tier === "business") return err(409, "This organization is already on Business");

    const next = {
      ...DEFAULT,
      ...existing,
      requestedTier: "business",
      requestedAt: nowIso(),
      requestedBy: member.email,
      lastModifiedAt: nowIso(),
    };
    await writeJson(billingKey(code), next);
    return json(200, { ok: true, ...next });
  }

  return err(405, "Method not allowed");
}
