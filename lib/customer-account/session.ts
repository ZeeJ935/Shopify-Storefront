import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getCustomerAccountConfig } from "./config";
import { customerIdFromClaims, decodeJwtPayload } from "./id-token";
import { parseSessionPayload, seal, unseal } from "./seal";

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
  /** Storefront API customer token; links carts to the customer for checkout. */
  storefrontToken?: string;
  /** Shopify customer ID (the ID token's `sub`). Undefined only for old sessions that predate it. */
  customerId?: string;
};

export type PkcePayload = {
  state: string;
  verifier: string;
  returnTo?: string;
};

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
        storefrontToken: session.storefrontToken,
        customerId: session.customerId,
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

    const session = parseSessionPayload(unseal(value, sessionSecret));
    if (!session) return null;

    let idToken: string | undefined;
    const idValue = await readChunkedCookie(CUSTOMER_ID_TOKEN_COOKIE);
    if (idValue) {
      const sealed = unseal<{ idToken?: string }>(idValue, sessionSecret);
      idToken = sealed?.idToken;
    }

    // Sessions created before the ID was stored: recover it from the sealed ID
    // token. If that fails it stays undefined and hasCustomerSession() is false.
    const customerId =
      session.customerId ??
      (idToken ? customerIdFromClaims(decodeJwtPayload(idToken)) : null) ??
      undefined;

    return { ...session, idToken, customerId };
  } catch {
    return null;
  }
}

/**
 * Signed in = a valid session that knows who the customer is. An old session
 * without a customer ID counts as signed out, so protected pages send the
 * shopper through login again (silent if they're still signed in at Shopify).
 */
export async function hasCustomerSession() {
  return Boolean((await getCustomerSession())?.customerId);
}

export async function getCustomerId(): Promise<string | null> {
  return (await getCustomerSession())?.customerId ?? null;
}

export function isSessionExpiringSoon(session: CustomerSession) {
  return session.expiresAt <= Date.now() + 60_000;
}
