import { createHash, randomBytes } from "node:crypto";

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createCodeVerifier() {
  return base64Url(randomBytes(32));
}

export function createCodeChallenge(verifier: string) {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function createOAuthState() {
  return base64Url(randomBytes(16));
}
