import { createRemoteJWKSet, jwtVerify } from "jose";

const domain = process.env.AUTH0_DOMAIN;
const audience = process.env.AUTH0_AUDIENCE;

let JWKS;

function getJWKS() {
  if (!JWKS) {
    JWKS = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
  }
  return JWKS;
}

/**
 * Validate the Authorization: Bearer <token> header.
 * Returns the decoded JWT payload on success.
 * Throws an Error with a human-readable message on failure.
 */
export async function validateToken(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }

  const token = authHeader.slice(7);

  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: `https://${domain}/`,
    audience: audience,
  });

  return payload;
}
