import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * True when an `Authorization` header is exactly `Bearer <expected>`.
 * Compares SHA-256 digests in constant time, so timing reveals nothing about the token.
 */
export function isServiceTokenValid(header: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(expected));
}
