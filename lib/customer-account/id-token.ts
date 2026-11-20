// Reads the customer ID from the OpenID Connect ID token (no next/* imports, unit tested).
//
// The signature is not verified: the token comes straight from Shopify's token
// endpoint over TLS with client authentication, which OIDC Core (3.1.3.7) allows.
// We still check who issued it, who it is for, and that it names a customer.

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `sub` from already-trusted claims (for example an ID token we sealed into our own cookie). */
export function customerIdFromClaims(
  claims: Record<string, unknown> | null,
): string | null {
  const sub = claims?.sub;
  return typeof sub === "string" && sub.trim() ? sub.trim() : null;
}

/** `sub` from a fresh ID token, after checking `iss` and `aud`. Null if anything is off. */
export function customerIdFromIdToken(
  idToken: string | undefined,
  expected: { clientId: string; issuer: string },
): string | null {
  if (!idToken) return null;
  const claims = decodeJwtPayload(idToken);
  if (!claims) return null;

  const issuer = typeof claims.iss === "string" ? claims.iss : "";
  if (issuer.replace(/\/+$/, "") !== expected.issuer.replace(/\/+$/, "")) {
    return null;
  }

  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(expected.clientId)) return null;

  return customerIdFromClaims(claims);
}
