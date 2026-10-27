import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { getCustomerAccountConfig } from "./config";

export const CUSTOMER_SESSION_COOKIE = "zj-customer-session";
export const CUSTOMER_PKCE_COOKIE = "zj-customer-pkce";

export type CustomerSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  idToken?: string;
};

export type PkcePayload = {
  state: string;
  verifier: string;
};

function keyFromSecret(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function seal(payload: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function unseal<T>(token: string, secret: string): T | null {
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

function cookieBase(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  };
}

export async function setPkceCookie(payload: PkcePayload) {
  const { sessionSecret } = getCustomerAccountConfig();
  const store = await cookies();
  store.set(CUSTOMER_PKCE_COOKIE, seal(payload, sessionSecret), cookieBase(600));
}

export async function getPkceCookie(): Promise<PkcePayload | null> {
  const { sessionSecret } = getCustomerAccountConfig();
  const store = await cookies();
  const value = store.get(CUSTOMER_PKCE_COOKIE)?.value;
  if (!value) return null;
  return unseal<PkcePayload>(value, sessionSecret);
}

export async function clearPkceCookie() {
  const store = await cookies();
  store.set(CUSTOMER_PKCE_COOKIE, "", cookieBase(0));
}

export async function setCustomerSession(session: CustomerSession) {
  const { sessionSecret } = getCustomerAccountConfig();
  const store = await cookies();
  store.set(
    CUSTOMER_SESSION_COOKIE,
    seal(session, sessionSecret),
    cookieBase(60 * 60 * 24 * 30),
  );
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  try {
    const { sessionSecret } = getCustomerAccountConfig();
    const store = await cookies();
    const value = store.get(CUSTOMER_SESSION_COOKIE)?.value;
    if (!value) return null;
    const session = unseal<CustomerSession>(value, sessionSecret);
    if (!session?.accessToken || !session.refreshToken || !session.expiresAt) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

export async function clearCustomerSession() {
  const store = await cookies();
  store.set(CUSTOMER_SESSION_COOKIE, "", cookieBase(0));
}

export async function hasCustomerSession() {
  return Boolean(await getCustomerSession());
}
