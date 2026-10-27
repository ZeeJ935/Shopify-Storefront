import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import { getCustomerAccountConfig } from "./config";

export const CUSTOMER_SESSION_COOKIE = "zj-customer-session";
export const CUSTOMER_ID_TOKEN_COOKIE = "zj-customer-id";
export const CUSTOMER_PKCE_COOKIE = "zj-customer-pkce";

/** Stay under typical ~4KB browser cookie limits (name + attributes). */
const COOKIE_CHUNK_SIZE = 3000;
const MAX_CHUNKS = 8;

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
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1" ||
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_CALLBACK_URL?.startsWith("https://") ===
      true;

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure,
  };
}

function chunkName(base: string, index: number) {
  return `${base}.${index}`;
}

async function clearChunkedCookie(base: string) {
  const store = await cookies();
  const opts = cookieBase(0);
  store.set(base, "", opts);
  for (let i = 0; i < MAX_CHUNKS; i++) {
    store.set(chunkName(base, i), "", opts);
  }
}

async function setChunkedCookie(base: string, value: string, maxAge: number) {
  const store = await cookies();
  await clearChunkedCookie(base);
  const opts = cookieBase(maxAge);

  if (value.length <= COOKIE_CHUNK_SIZE) {
    store.set(base, value, opts);
    return;
  }

  const chunks = Math.ceil(value.length / COOKIE_CHUNK_SIZE);
  if (chunks > MAX_CHUNKS) {
    throw new Error("Customer session cookie is too large.");
  }

  for (let i = 0; i < chunks; i++) {
    store.set(
      chunkName(base, i),
      value.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE),
      opts,
    );
  }
}

async function getChunkedCookie(base: string): Promise<string | null> {
  const store = await cookies();
  const single = store.get(base)?.value;
  if (single) return single;

  const parts: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = store.get(chunkName(base, i))?.value;
    if (!part) break;
    parts.push(part);
  }
  if (parts.length === 0) return null;
  return parts.join("");
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
  const maxAge = 60 * 60 * 24 * 30;

  const core = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };

  await setChunkedCookie(
    CUSTOMER_SESSION_COOKIE,
    seal(core, sessionSecret),
    maxAge,
  );

  if (session.idToken) {
    await setChunkedCookie(
      CUSTOMER_ID_TOKEN_COOKIE,
      seal({ idToken: session.idToken }, sessionSecret),
      maxAge,
    );
  }
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  try {
    const { sessionSecret } = getCustomerAccountConfig();
    const value = await getChunkedCookie(CUSTOMER_SESSION_COOKIE);
    if (!value) return null;

    const session = unseal<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      idToken?: string;
    }>(value, sessionSecret);

    if (!session?.accessToken || !session.refreshToken || !session.expiresAt) {
      return null;
    }

    if (!Number.isFinite(session.expiresAt)) {
      return null;
    }

    let idToken = session.idToken;
    if (!idToken) {
      const idValue = await getChunkedCookie(CUSTOMER_ID_TOKEN_COOKIE);
      if (idValue) {
        const sealed = unseal<{ idToken?: string }>(idValue, sessionSecret);
        idToken = sealed?.idToken;
      }
    }

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      idToken,
    };
  } catch {
    return null;
  }
}

export async function clearCustomerSession() {
  await clearChunkedCookie(CUSTOMER_SESSION_COOKIE);
  await clearChunkedCookie(CUSTOMER_ID_TOKEN_COOKIE);
}

export async function hasCustomerSession() {
  return Boolean(await getCustomerSession());
}
