import { base64url, SignJWT, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import {
  keyId,
  signStaffToken,
  STAFF_JWT_AUDIENCE,
  STAFF_JWT_ISSUER,
  STAFF_SESSION_MAX_SECONDS,
  STAFF_TOKEN_TTL_SECONDS,
  verifyStaffToken,
} from "../src/admin/jwt.js";

const CUR = "c".repeat(40);
const PREV = "p".repeat(40);
const T0 = Date.UTC(2026, 10, 23, 9, 0, 0);
const sst = Math.floor(T0 / 1000);
const claims = { staffId: 7, email: "op@x.com", role: "operator" as const, sessionStartedAt: sst };

async function reason(p: Promise<unknown>) {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { reason?: string }).reason ?? "other";
  }
}

describe("staff JWT", () => {
  it("round-trips and expires after 15 minutes (30 s tolerance)", async () => {
    const { token, expiresAt } = await signStaffToken({ current: CUR }, claims, T0);
    expect(expiresAt).toBe(sst + STAFF_TOKEN_TTL_SECONDS);
    expect(await verifyStaffToken({ current: CUR }, token, { now: T0 })).toMatchObject({ staffId: 7, email: "op@x.com", role: "operator" });
    expect(await reason(verifyStaffToken({ current: CUR }, token, { now: T0 + (STAFF_TOKEN_TTL_SECONDS + 20) * 1000 }))).toBe("ok");
    expect(await reason(verifyStaffToken({ current: CUR }, token, { now: T0 + (STAFF_TOKEN_TTL_SECONDS + 60) * 1000 }))).toBe("invalid");
  });

  it("rejects a tampered payload (role upgrade with the original signature)", async () => {
    const { token } = await signStaffToken({ current: CUR }, claims, T0);
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(new TextDecoder().decode(base64url.decode(p)));
    const forged = [h, base64url.encode(JSON.stringify({ ...payload, role: "admin" })), s].join(".");
    expect(await reason(verifyStaffToken({ current: CUR }, forged, { now: T0 }))).toBe("invalid");
  });

  it("rejects alg none, other algorithms, unknown keys and wrong issuer/audience", async () => {
    const enc = (o: object) => base64url.encode(JSON.stringify(o));
    const payload = { sub: "7", email: "op@x.com", role: "admin", sst, iat: sst, exp: sst + 600, iss: STAFF_JWT_ISSUER, aud: STAFF_JWT_AUDIENCE };
    const none = `${enc({ alg: "none", kid: keyId(CUR) })}.${enc(payload)}.`;
    expect(await reason(verifyStaffToken({ current: CUR }, none, { now: T0 }))).toBe("bad_alg");

    const hs512 = await new SignJWT(payload).setProtectedHeader({ alg: "HS512", kid: keyId(CUR) }).sign(new TextEncoder().encode(CUR));
    expect(await reason(verifyStaffToken({ current: CUR }, hs512, { now: T0 }))).toBe("bad_alg");

    const { privateKey } = await generateKeyPair("RS256");
    const rs = await new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: keyId(CUR) }).sign(privateKey);
    expect(await reason(verifyStaffToken({ current: CUR }, rs, { now: T0 }))).toBe("bad_alg");

    // Our kid but signed with another secret.
    const wrongSecret = await new SignJWT(payload).setProtectedHeader({ alg: "HS256", kid: keyId(CUR) }).sign(new TextEncoder().encode("x".repeat(40)));
    expect(await reason(verifyStaffToken({ current: CUR }, wrongSecret, { now: T0 }))).toBe("invalid");

    const other = await signStaffToken({ current: "o".repeat(40) }, claims, T0);
    expect(await reason(verifyStaffToken({ current: CUR }, other.token, { now: T0 }))).toBe("unknown_key");

    const wrongAud = await new SignJWT({ ...payload, aud: "someone-else" }).setProtectedHeader({ alg: "HS256", kid: keyId(CUR) }).sign(new TextEncoder().encode(CUR));
    expect(await reason(verifyStaffToken({ current: CUR }, wrongAud, { now: T0 }))).toBe("invalid");
    expect(await reason(verifyStaffToken({ current: CUR }, "not.a.jwt", { now: T0 }))).toBe("malformed");
  });

  it("rotation: previous-key tokens verify until the previous key is removed", async () => {
    const old = await signStaffToken({ current: PREV }, claims, T0);
    expect(await reason(verifyStaffToken({ current: CUR, previous: PREV }, old.token, { now: T0 }))).toBe("ok");
    expect(await reason(verifyStaffToken({ current: CUR }, old.token, { now: T0 }))).toBe("unknown_key");
  });

  it("hard 8-hour session limit: expiry is capped and nothing verifies after it", async () => {
    const late = T0 + (STAFF_SESSION_MAX_SECONDS - 5 * 60) * 1000; // 7h55m in
    const { token, expiresAt } = await signStaffToken({ current: CUR }, claims, late);
    expect(expiresAt).toBe(sst + STAFF_SESSION_MAX_SECONDS); // not late + 15 min
    const end = T0 + STAFF_SESSION_MAX_SECONDS * 1000;
    expect(await reason(verifyStaffToken({ current: CUR }, token, { now: end, allowExpired: true }))).toBe("session_expired");
    expect(await reason(signStaffToken({ current: CUR }, claims, end))).toBe("session_expired");
  });

  it("allowExpired (refresh) still checks the signature", async () => {
    const { token } = await signStaffToken({ current: CUR }, claims, T0);
    const later = T0 + 60 * 60 * 1000; // expired 45 min ago, session still open
    expect(await reason(verifyStaffToken({ current: CUR }, token, { now: later }))).toBe("invalid");
    expect(await reason(verifyStaffToken({ current: CUR }, token, { now: later, allowExpired: true }))).toBe("ok");
    const [h, p] = token.split(".");
    expect(await reason(verifyStaffToken({ current: CUR }, `${h}.${p}.AAAA`, { now: later, allowExpired: true }))).toBe("invalid");
  });
});
