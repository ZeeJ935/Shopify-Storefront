// Pure (no next/* imports) so it can be unit tested. Same scheme as the storefront's
// lib/customer-account/seal.ts: AES-256-GCM, base64url(iv[12] | tag[16] | ciphertext).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const keyFromSecret = (secret: string) => createHash("sha256").update(`zj-admin:${secret}`).digest();

export function seal(payload: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

/** Null for anything tampered, truncated or sealed with another secret. */
export function unseal<T>(token: string, secret: string): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 28) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}
