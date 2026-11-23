import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createGoogleVerifier, type GoogleVerifier } from "../src/admin/google.js";

const CLIENT = "client.apps.googleusercontent.com";
const NONCE = "n".repeat(32);
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let sign: (claims: Record<string, unknown>, opts?: { key?: PrivateKey; exp?: string }) => Promise<string>;
let otherKey: PrivateKey;
let verify: GoogleVerifier;
let verifyHd: GoogleVerifier;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  verify = createGoogleVerifier({ clientId: CLIENT, keySet });
  verifyHd = createGoogleVerifier({ clientId: CLIENT, hostedDomain: "x.com", keySet });
  sign = (claims, opts = {}) =>
    new SignJWT({ email: "Op@X.com", email_verified: true, nonce: NONCE, hd: "x.com", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer((claims.iss as string) ?? "https://accounts.google.com")
      .setAudience((claims.aud as string) ?? CLIENT)
      .setSubject("google-sub-1")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(opts.key ?? privateKey);
});

async function reason(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { reason?: string }).reason ?? "other";
  }
}

describe("Google ID token verification", () => {
  it("accepts a valid token and lower-cases the email", async () => {
    expect(await verify(await sign({}), NONCE)).toEqual({ sub: "google-sub-1", email: "op@x.com", hostedDomain: "x.com" });
  });

  it("rejects wrong audience, issuer, signing key and expired tokens", async () => {
    expect(await reason(verify(await sign({ aud: "other-client" }), NONCE))).toBe("invalid_token");
    expect(await reason(verify(await sign({ iss: "https://evil.example" }), NONCE))).toBe("invalid_token");
    expect(await reason(verify(await sign({}, { key: otherKey }), NONCE))).toBe("invalid_token");
    expect(await reason(verify(await sign({}, { exp: "-10m" }), NONCE))).toBe("invalid_token");
  });

  it("rejects a nonce mismatch, unverified email, and the wrong Workspace domain", async () => {
    expect(await reason(verify(await sign({}), "x".repeat(32)))).toBe("nonce");
    expect(await reason(verify(await sign({ nonce: undefined }), NONCE))).toBe("nonce");
    expect(await reason(verify(await sign({ email_verified: false }), NONCE))).toBe("email_unverified");
    expect(await reason(verifyHd(await sign({ hd: "gmail.com" }), NONCE))).toBe("hosted_domain");
    expect(await reason(verifyHd(await sign({ hd: undefined }), NONCE))).toBe("hosted_domain");
  });
});
