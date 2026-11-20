// Pure session helpers (no next/* imports) so they can be unit tested with tsx.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function keyFromSecret(secret: string) {
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM: base64url(iv[12] | tag[16] | ciphertext). */
export function seal(payload: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

/** Returns null for anything tampered, truncated or sealed with another secret. */
export function unseal<T>(token: string, secret: string): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFromSecret(secret),
      iv,
    );
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** What the main session cookie holds once unsealed. */
export type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  storefrontToken?: string;
  /** Shopify customer ID (the ID token's `sub`). Missing in sessions created before it was stored. */
  customerId?: string;
};

/** Validates an unsealed session cookie. Older cookies without `customerId` are still valid. */
export function parseSessionPayload(raw: unknown): SessionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (
    typeof s.accessToken !== "string" ||
    !s.accessToken ||
    typeof s.refreshToken !== "string" ||
    !s.refreshToken ||
    typeof s.expiresAt !== "number" ||
    !Number.isFinite(s.expiresAt)
  ) {
    return null;
  }
  return {
    accessToken: s.accessToken,
    refreshToken: s.refreshToken,
    expiresAt: s.expiresAt,
    storefrontToken:
      typeof s.storefrontToken === "string" ? s.storefrontToken : undefined,
    customerId:
      typeof s.customerId === "string" && s.customerId ? s.customerId : undefined,
  };
}
