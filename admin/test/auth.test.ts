import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { adminFetch, BackendError } from "../lib/backend";
import { clientIpFrom } from "../lib/client-ip";
import { buildCsp } from "../lib/csp";
import { readConfig, type AdminAppConfig } from "../lib/env";
import { authorizationUrl, createAttempt, exchangeCode, safeEqual } from "../lib/google";
import { seal, unseal } from "../lib/seal";
import { OAUTH_COOKIE_MAX_AGE, parseOAuthAttempt, parseSession, sessionAction, sessionCookieOptions, type AdminSession } from "../lib/session";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000;
const session: AdminSession = {
  token: "staff.jwt.token",
  tokenExpiresAt: NOW + 900,
  sessionExpiresAt: NOW + 8 * 3600,
  staff: { id: 1, email: "op@x.com", role: "operator" },
};
const config: AdminAppConfig = {
  backendUrl: "http://backend.test",
  adminApiToken: "ADMIN-API-TOKEN-" + "a".repeat(32),
  googleClientId: "client.apps.googleusercontent.com",
  googleClientSecret: "GOOGLE-SECRET-VALUE",
  sessionSecret: SECRET,
  appUrl: "https://admin.example.com",
  secureCookies: true,
};

describe("sealed session cookie", () => {
  it("round-trips, and rejects tampering or another secret", () => {
    const sealed = seal(session, SECRET);
    assert.deepEqual(parseSession(unseal(sealed, SECRET)), session);
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    assert.equal(unseal(flipped, SECRET), null);
    assert.equal(unseal(sealed, "x".repeat(40)), null);
    assert.equal(parseSession({ ...session, staff: { ...session.staff, role: "owner" } }), null);
  });

  it("refreshes near expiry and never outlives the 8-hour limit", () => {
    assert.equal(sessionAction(null, NOW), "login");
    assert.equal(sessionAction(session, NOW), "ok");
    assert.equal(sessionAction(session, session.tokenExpiresAt - 60), "refresh");
    assert.equal(sessionAction(session, session.tokenExpiresAt + 3600), "refresh"); // expired token, open session
    assert.equal(sessionAction(session, session.sessionExpiresAt), "login");
    const opts = sessionCookieOptions(session, NOW + 7 * 3600, true);
    assert.equal(opts.maxAge, 3600);
    assert.deepEqual([opts.httpOnly, opts.secure, opts.sameSite], [true, true, "lax"]);
  });
});

describe("Google sign-in", () => {
  it("builds an authorization URL with PKCE S256, state and nonce — and no secret", () => {
    const attempt = createAttempt(NOW);
    const url = new URL(authorizationUrl({ clientId: config.googleClientId, appUrl: config.appUrl, ...attempt }));
    const p = url.searchParams;
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(p.get("redirect_uri"), "https://admin.example.com/auth/callback");
    assert.equal(p.get("scope"), "openid email");
    assert.equal(p.get("code_challenge_method"), "S256");
    assert.equal(p.get("code_challenge"), createHash("sha256").update(attempt.verifier).digest("base64url"));
    assert.equal(p.get("state"), attempt.state);
    assert.equal(p.get("nonce"), attempt.nonce);
    assert.ok(!url.toString().includes(config.googleClientSecret));
    assert.ok(!url.toString().includes(attempt.verifier));
  });

  it("each attempt is random and expires after 10 minutes; state compares exactly", () => {
    const a = createAttempt(NOW);
    const b = createAttempt(NOW);
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.nonce, b.nonce);
    assert.ok(parseOAuthAttempt(a, NOW + OAUTH_COOKIE_MAX_AGE));
    assert.equal(parseOAuthAttempt(a, NOW + OAUTH_COOKIE_MAX_AGE + 1), null);
    assert.equal(safeEqual(a.state, a.state), true);
    assert.equal(safeEqual(a.state, b.state), false);
    assert.equal(safeEqual(a.state, a.state + "x"), false);
  });

  it("exchanges the code with the PKCE verifier and returns the ID token", async () => {
    let sent: URLSearchParams | null = null;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = init.body as URLSearchParams;
      return new Response(JSON.stringify({ id_token: "google.id.token" }), { status: 200 });
    }) as typeof fetch;
    const idToken = await exchangeCode({ clientId: "c", clientSecret: "sec", appUrl: config.appUrl, code: "the-code", verifier: "v" }, fakeFetch);
    assert.equal(idToken, "google.id.token");
    assert.equal(sent!.get("code_verifier"), "v");
    assert.equal(sent!.get("grant_type"), "authorization_code");
    const failing = (async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    await assert.rejects(exchangeCode({ clientId: "c", clientSecret: "sec", appUrl: config.appUrl, code: "x", verifier: "v" }, failing), /400/);
  });
});

describe("backend client", () => {
  it("sends the admin token, staff token, client IP and idempotency key; errors carry no tokens", async () => {
    let headers: Record<string, string> = {};
    const ok = (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await adminFetch(config, "/admin/me", { staffToken: "STAFF", clientIp: "203.0.113.1", idempotencyKey: "k-12345678" }, ok);
    assert.equal(headers.authorization, `Bearer ${config.adminApiToken}`);
    assert.equal(headers["x-staff-token"], "STAFF");
    assert.equal(headers["x-admin-client-ip"], "203.0.113.1");
    assert.equal(headers["idempotency-key"], "k-12345678");

    const denied = (async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })) as unknown as typeof fetch;
    const error = await adminFetch(config, "/admin/sync/orders?x=1", { staffToken: "STAFF" }, denied).catch((e) => e);
    assert.ok(error instanceof BackendError);
    assert.equal(error.status, 403);
    assert.equal(error.path, "/admin/sync/orders");
    assert.ok(!String(error.message).includes("STAFF") && !String(error.message).includes(config.adminApiToken));
  });

  it("reads the client IP from x-forwarded-for, rejecting junk", () => {
    assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    assert.equal(clientIpFrom(new Headers({ "x-forwarded-for": "<script>" })), undefined);
  });
});

describe("config", () => {
  it("names missing variables without echoing values", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      BACKEND_URL: "http://b",
      ADMIN_API_TOKEN: "t",
      GOOGLE_CLIENT_ID: "c",
      GOOGLE_CLIENT_SECRET: "VALUE-SHOULD-NOT-APPEAR",
      ADMIN_SESSION_SECRET: "short",
      ADMIN_APP_URL: "http://localhost:3001",
    };
    let message = "";
    try {
      readConfig(env);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.match(message, /ADMIN_SESSION_SECRET/);
    assert.ok(!message.includes("VALUE-SHOULD-NOT-APPEAR"));
    assert.equal(readConfig({ ...env, ADMIN_SESSION_SECRET: SECRET }).secureCookies, false);
    assert.throws(() => readConfig({ ...env, ADMIN_SESSION_SECRET: SECRET, GOOGLE_CLIENT_ID: "" }), /GOOGLE_CLIENT_ID/);
  });
});

describe("CSP", () => {
  it("is strict: nonce scripts, no framing, no inline in production", () => {
    const csp = buildCsp("abc123", { dev: false, https: true, sentryDsn: "https://key@o1.ingest.sentry.io/42" });
    assert.match(csp, /upgrade-insecure-requests/);
    assert.ok(!buildCsp("n", { dev: false, https: false }).includes("upgrade-insecure-requests"));
    assert.match(csp, /script-src 'self' 'nonce-abc123' 'strict-dynamic'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /connect-src 'self' https:\/\/o1\.ingest\.sentry\.io/);
    assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"));
  });
});
