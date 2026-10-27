import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getCustomerAccountConfig } from "./config";

export const CUSTOMER_SESSION_COOKIE = "zj-ca-session";
export const CUSTOMER_ID_TOKEN_COOKIE = "zj-ca-id";
export const CUSTOMER_PKCE_COOKIE = "zj-ca-pkce";

const COOKIE_CHUNK_SIZE = 2800;
const MAX_CHUNKS = 6;

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

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    // Secure on Vercel/production; allow plain HTTP for local `next dev`
    secure: process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL),
  };
}

function chunkName(base: string, index: number) {
  return `${base}.${index}`;
}

function clearChunkedOnResponse(response: NextResponse, base: string) {
  const opts = cookieOptions(0);
  response.cookies.set(base, "", opts);
  for (let i = 0; i < MAX_CHUNKS; i++) {
    response.cookies.set(chunkName(base, i), "", opts);
  }
}

function setChunkedOnResponse(
  response: NextResponse,
  base: string,
  value: string,
  maxAge: number,
) {
  clearChunkedOnResponse(response, base);
  const opts = cookieOptions(maxAge);

  if (value.length <= COOKIE_CHUNK_SIZE) {
    response.cookies.set(base, value, opts);
    return;
  }

  const chunks = Math.ceil(value.length / COOKIE_CHUNK_SIZE);
  if (chunks > MAX_CHUNKS) {
    throw new Error("Customer session cookie is too large.");
  }

  for (let i = 0; i < chunks; i++) {
    response.cookies.set(
      chunkName(base, i),
      value.slice(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE),
      opts,
    );
  }
}

async function readChunkedCookie(base: string): Promise<string | null> {
  const store = await cookies();
  const single = store.get(base)?.value;
  if (single) return single;

  const parts: string[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = store.get(chunkName(base, i))?.value;
    if (!part) break;
    parts.push(part);
  }
  return parts.length ? parts.join("") : null;
}

export function applyPkceCookie(response: NextResponse, payload: PkcePayload) {
  const { sessionSecret } = getCustomerAccountConfig();
  response.cookies.set(
    CUSTOMER_PKCE_COOKIE,
    seal(payload, sessionSecret),
    cookieOptions(600),
  );
}

export async function getPkceCookie(): Promise<PkcePayload | null> {
  const { sessionSecret } = getCustomerAccountConfig();
  const store = await cookies();
  const value = store.get(CUSTOMER_PKCE_COOKIE)?.value;
  if (!value) return null;
  return unseal<PkcePayload>(value, sessionSecret);
}

export function clearPkceCookie(response: NextResponse) {
  response.cookies.set(CUSTOMER_PKCE_COOKIE, "", cookieOptions(0));
}

export function applyCustomerSession(
  response: NextResponse,
  session: CustomerSession,
) {
  const { sessionSecret } = getCustomerAccountConfig();
  const maxAge = 60 * 60 * 24 * 30;

  setChunkedOnResponse(
    response,
    CUSTOMER_SESSION_COOKIE,
    seal(
      {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      },
      sessionSecret,
    ),
    maxAge,
  );

  if (session.idToken) {
    setChunkedOnResponse(
      response,
      CUSTOMER_ID_TOKEN_COOKIE,
      seal({ idToken: session.idToken }, sessionSecret),
      maxAge,
    );
  }
}

export function clearCustomerSessionCookies(response: NextResponse) {
  clearChunkedOnResponse(response, CUSTOMER_SESSION_COOKIE);
  clearChunkedOnResponse(response, CUSTOMER_ID_TOKEN_COOKIE);
  response.cookies.set(CUSTOMER_PKCE_COOKIE, "", cookieOptions(0));
  // Clear legacy cookie names from earlier iterations
  response.cookies.set("zj-customer-session", "", cookieOptions(0));
  response.cookies.set("zj-customer-id", "", cookieOptions(0));
  response.cookies.set("zj-customer-pkce", "", cookieOptions(0));
  for (let i = 0; i < MAX_CHUNKS; i++) {
    response.cookies.set(`zj-customer-session.${i}`, "", cookieOptions(0));
    response.cookies.set(`zj-customer-id.${i}`, "", cookieOptions(0));
  }
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  try {
    const { sessionSecret } = getCustomerAccountConfig();
    const value = await readChunkedCookie(CUSTOMER_SESSION_COOKIE);
    if (!value) return null;

    const session = unseal<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }>(value, sessionSecret);

    if (
      !session?.accessToken ||
      !session.refreshToken ||
      !Number.isFinite(session.expiresAt)
    ) {
      return null;
    }

    let idToken: string | undefined;
    const idValue = await readChunkedCookie(CUSTOMER_ID_TOKEN_COOKIE);
    if (idValue) {
      const sealed = unseal<{ idToken?: string }>(idValue, sessionSecret);
      idToken = sealed?.idToken;
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

export async function hasCustomerSession() {
  return Boolean(await getCustomerSession());
}

export function isSessionExpiringSoon(session: CustomerSession) {
  return session.expiresAt <= Date.now() + 60_000;
}
