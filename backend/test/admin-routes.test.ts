import { Writable } from "node:stream";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { parseAllowlist } from "../src/admin/allowlist.js";
import type { AuditEntry, AuditOutcome, AuditStore } from "../src/admin/audit.js";
import type { AdminEnv } from "../src/admin/env.js";
import { GoogleTokenError, type GoogleVerifier } from "../src/admin/google.js";
import { signStaffToken, STAFF_SESSION_MAX_SECONDS } from "../src/admin/jwt.js";
import { createRateLimiter } from "../src/admin/rate-limit.js";
import type { StaffStore } from "../src/admin/staff.js";
import { fakeCustomers, fakeFavourites, fakeWebhooks } from "./fakes.js";

const SERVICE = "service-" + "s".repeat(40);
const ADMIN = "admin-api-" + "a".repeat(40);
const ADMIN_OLD = "admin-old-" + "o".repeat(40);
const JWT = "jwt-secret-" + "j".repeat(40);
const ID_TOKEN = "google.id.token-SECRET-VALUE";
const NONCE = "nonce-" + "n".repeat(30);
const T0 = Date.UTC(2026, 10, 23, 9, 0, 0);
const DEFAULT_ALLOWLIST = "admin@x.com:admin,op@x.com:operator,view@x.com:viewer";

type Fakes = ReturnType<typeof setup>;

function setup(opts: { allowlist?: string; now?: () => number; auditFails?: boolean; logLines?: string[]; limits?: { exchange: number; refresh: number } } = {}) {
  const audit: (AuditEntry & { id: number; outcome?: AuditOutcome })[] = [];
  const auditStore: AuditStore = {
    async insert(e) {
      if (opts.auditFails) throw new Error("audit db down");
      const id = audit.length + 1;
      audit.push({ ...e, id });
      return id;
    },
    async complete(id, o) {
      const row = audit.find((a) => a.id === id);
      if (row) row.outcome = o;
    },
    async list() {
      return [];
    },
  };
  const staffIds = new Map<string, number>();
  const staff: StaffStore = {
    async upsertOnLogin({ email }) {
      if (!staffIds.has(email)) staffIds.set(email, staffIds.size + 1);
      return staffIds.get(email)!;
    },
    async exists(id, email) {
      return staffIds.get(email) === id;
    },
  };
  // Fake Google: the "id token" is the email (or "bad" → invalid signature).
  const verifyGoogle: GoogleVerifier = async (idToken, nonce) => {
    if (idToken.startsWith("bad")) throw new GoogleTokenError("invalid_token");
    if (nonce !== NONCE) throw new GoogleTokenError("nonce");
    return { sub: `sub-${idToken}`, email: idToken.replace(`${ID_TOKEN}:`, ""), hostedDomain: null };
  };
  const env: AdminEnv = {
    apiToken: ADMIN,
    apiTokenPrevious: ADMIN_OLD,
    jwtSecret: JWT,
    allowlist: parseAllowlist(opts.allowlist ?? DEFAULT_ALLOWLIST),
    googleClientId: "client",
  };
  const synced: string[] = [];
  const now = opts.now ?? (() => T0);
  const stream = new Writable({
    write(chunk, _e, done) {
      opts.logLines?.push(chunk.toString());
      done();
    },
  });
  const app = buildApp({
    serviceToken: SERVICE,
    customers: fakeCustomers(),
    favourites: fakeFavourites(),
    webhooks: fakeWebhooks().deps,
    pingDb: async () => {},
    logger: opts.logLines ? { level: "info", stream } : false,
    staffAdmin: {
      env,
      pool: {} as pg.Pool,
      verifyGoogle,
      staff,
      audit: auditStore,
      now,
      rateLimits: {
        exchange: createRateLimiter({ max: opts.limits?.exchange ?? 100, windowMs: 60_000, now }),
        refresh: createRateLimiter({ max: opts.limits?.refresh ?? 100, windowMs: 60_000, now }),
      },
      sync: {
        orders: async (reason) => {
          synced.push(`orders:${reason}`);
        },
      },
    },
  });
  const exchange = (email: string, extra: { ip?: string; nonce?: string; token?: string } = {}) =>
    app.inject({
      method: "POST",
      url: "/admin/auth/exchange",
      headers: { authorization: `Bearer ${extra.token ?? ADMIN}`, ...(extra.ip ? { "x-admin-client-ip": extra.ip } : {}) },
      payload: { idToken: email.startsWith("bad") ? email : `${ID_TOKEN}:${email}`, nonce: extra.nonce ?? NONCE },
    });
  const call = (method: "GET" | "POST", url: string, staffToken: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${ADMIN}`, "x-staff-token": staffToken, ...headers }, ...(payload ? { payload } : {}) });
  const login = async (email: string) => (await exchange(email)).json().token as string;
  return { app, audit, synced, exchange, call, login, staffIds };
}

describe("/admin token separation", () => {
  it("needs the admin token: no token, the /v1 service token, or a junk token → 401", async () => {
    const f = setup();
    for (const auth of [undefined, `Bearer ${SERVICE}`, "Bearer nope"]) {
      const res = await f.app.inject({ method: "POST", url: "/admin/auth/exchange", headers: auth ? { authorization: auth } : {}, payload: {} });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "unauthorized" });
    }
    await f.app.close();
  });

  it("the admin token does not open /v1, and the previous admin token still works (rotation)", async () => {
    const f = setup();
    expect((await f.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${ADMIN}`, "x-customer-id": "1" } })).statusCode).toBe(401);
    expect((await f.exchange("op@x.com", { token: ADMIN_OLD })).statusCode).toBe(200);
    await f.app.close();
  });
});

describe("POST /admin/auth/exchange", () => {
  it("issues a staff token for an allowlisted email and audits the sign-in", async () => {
    const f = setup();
    const res = await f.exchange("Op@X.com");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.staff).toEqual({ id: 1, email: "op@x.com", role: "operator" });
    expect(body.sessionExpiresAt).toBe(Math.floor(T0 / 1000) + STAFF_SESSION_MAX_SECONDS);
    expect(f.audit.at(-1)).toMatchObject({ action: "auth.login", result: "success", staffEmail: "op@x.com", role: "operator" });
    await f.app.close();
  });

  it("every failure looks the same (not allowlisted, bad token, bad nonce, bad body)", async () => {
    const f = setup();
    const responses = [
      await f.exchange("stranger@x.com"),
      await f.exchange("bad-token"),
      await f.exchange("op@x.com", { nonce: "wrong-nonce-" + "w".repeat(20) }),
      await f.app.inject({ method: "POST", url: "/admin/auth/exchange", headers: { authorization: `Bearer ${ADMIN}` }, payload: { idToken: 5 } }),
    ];
    for (const r of responses) {
      expect(r.statusCode).toBe(401);
      expect(r.body).toBe(JSON.stringify({ error: "sign_in_failed" }));
    }
    // Rejections are audited with a reason; the stranger's email is only a hash.
    const rejected = f.audit.filter((a) => a.result === "rejected");
    expect(rejected.map((a) => a.detail?.reason)).toEqual(["not_allowlisted", "invalid_token", "nonce", "bad_request"]);
    expect(JSON.stringify(rejected)).not.toContain("stranger");
    expect(rejected[0].detail?.email_hash).toMatch(/^[0-9a-f]{32}$/);
    await f.app.close();
  });

  it("rate limits per client IP", async () => {
    const f = setup({ limits: { exchange: 3, refresh: 100 } });
    for (let i = 0; i < 3; i++) expect((await f.exchange("stranger@x.com", { ip: "203.0.113.5" })).statusCode).toBe(401);
    const limited = await f.exchange("op@x.com", { ip: "203.0.113.5" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await f.exchange("op@x.com", { ip: "203.0.113.9" })).statusCode).toBe(200);
    await f.app.close();
  });

  it("sign-in still works when the audit write fails (best effort)", async () => {
    const f = setup({ auditFails: true });
    expect((await f.exchange("op@x.com")).statusCode).toBe(200);
    await f.app.close();
  });
});

describe("POST /admin/auth/refresh", () => {
  it("re-issues within the session, keeps the original sign-in time, and caps at 8 hours", async () => {
    let t = T0;
    const f = setup({ now: () => t });
    const token = await f.login("op@x.com");
    t = T0 + 60 * 60 * 1000; // 1 h later: the 15-min token has expired, the session hasn't
    const r1 = await f.call("POST", "/admin/auth/refresh", token);
    expect(r1.statusCode).toBe(200);
    expect(r1.json().sessionExpiresAt).toBe(Math.floor(T0 / 1000) + STAFF_SESSION_MAX_SECONDS);

    t = T0 + (STAFF_SESSION_MAX_SECONDS - 120) * 1000; // 2 min before the hard limit
    const r2 = await f.call("POST", "/admin/auth/refresh", r1.json().token);
    expect(r2.statusCode).toBe(200);
    expect(r2.json().expiresAt).toBe(Math.floor(T0 / 1000) + STAFF_SESSION_MAX_SECONDS); // not +15 min

    t = T0 + STAFF_SESSION_MAX_SECONDS * 1000; // 8 h: sign in with Google again
    const r3 = await f.call("POST", "/admin/auth/refresh", r2.json().token);
    expect(r3.statusCode).toBe(401);
    expect(r3.json()).toEqual({ error: "sign_in_failed" });
    await f.app.close();
  });

  it("re-checks the allowlist: removed staff can't refresh (same generic error)", async () => {
    const f = setup();
    const token = await f.login("op@x.com");
    // Same secrets, new allowlist without op@ (e.g. after a redeploy).
    const g = setup({ allowlist: "admin@x.com:admin" });
    await g.login("admin@x.com");
    g.staffIds.set("op@x.com", 1);
    const res = await g.call("POST", "/admin/auth/refresh", token);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "sign_in_failed" });
    expect(g.audit.at(-1)).toMatchObject({ action: "auth.refresh", result: "denied" });
    await f.app.close();
    await g.app.close();
  });

  it("rejects tampered tokens and is rate limited", async () => {
    const f = setup({ limits: { exchange: 100, refresh: 2 } });
    const token = await f.login("op@x.com");
    const [h, p] = token.split(".");
    expect((await f.call("POST", "/admin/auth/refresh", `${h}.${p}.AAAA`)).json()).toEqual({ error: "sign_in_failed" });
    expect((await f.call("POST", "/admin/auth/refresh", token)).statusCode).toBe(200);
    expect((await f.call("POST", "/admin/auth/refresh", token)).statusCode).toBe(429);
    await f.app.close();
  });
});

describe("staff routes", () => {
  it("need a valid, unexpired staff token", async () => {
    let t = T0;
    const f = setup({ now: () => t });
    const token = await f.login("view@x.com");
    expect((await f.call("GET", "/admin/me", token)).json().staff).toMatchObject({ email: "view@x.com", role: "viewer" });
    expect((await f.call("GET", "/admin/me", "")).statusCode).toBe(401);
    const forged = (await signStaffToken({ current: "z".repeat(40) }, { staffId: 1, email: "view@x.com", role: "admin", sessionStartedAt: Math.floor(T0 / 1000) }, T0)).token;
    expect((await f.call("GET", "/admin/me", forged)).statusCode).toBe(401);
    t = T0 + 20 * 60 * 1000;
    expect((await f.call("GET", "/admin/me", token)).statusCode).toBe(401);
    await f.app.close();
  });

  it("role checks: viewer can't fulfill or read audit; operator can't sync; admin can — denials are audited", async () => {
    const f = setup();
    const viewer = await f.login("view@x.com");
    const operator = await f.login("op@x.com");
    const admin = await f.login("admin@x.com");
    const fulfill = { fulfillment_order_id: "1", dry_run: true };

    const v = await f.call("POST", "/admin/fulfillments", viewer, fulfill, { "idempotency-key": "k-12345678" });
    expect(v.statusCode).toBe(403);
    expect((await f.call("GET", "/admin/audit", viewer)).statusCode).toBe(403);
    expect((await f.call("POST", "/admin/sync/orders", operator)).statusCode).toBe(403);
    const denied = f.audit.filter((a) => a.result === "denied");
    expect(denied.map((a) => [a.action, a.role, a.detail?.required_role])).toEqual([
      ["fulfillment.create", "viewer", "operator"],
      ["audit.read", "viewer", "admin"],
      ["sync", "operator", "admin"],
    ]);

    const ok = await f.call("POST", "/admin/sync/orders", admin);
    expect(ok.statusCode).toBe(202);
    expect(f.synced).toEqual(["orders:manual"]);
    expect((await f.call("POST", "/admin/sync/bogus", admin)).statusCode).toBe(404);
    expect((await f.call("POST", "/admin/sync/catalog", admin)).statusCode).toBe(503); // not configured in this app
    await f.app.close();
  });

  it("the CURRENT allowlist role applies, not the role in the token", async () => {
    const f = setup();
    const token = await f.login("op@x.com"); // operator token
    const g = setup({ allowlist: "op@x.com:viewer" }); // downgraded
    const res = await g.call("POST", "/admin/sync/orders", token);
    expect(res.statusCode).toBe(403);
    expect((await g.call("GET", "/admin/me", token)).json().staff.role).toBe("viewer");
    await f.app.close();
    await g.app.close();
  });

  it("fail closed: if the pending audit row can't be written, the change is refused", async () => {
    const f = setup();
    const admin = await f.login("admin@x.com");
    const g = setup({ auditFails: true });
    g.staffIds.set("admin@x.com", 1);
    const res = await g.call("POST", "/admin/sync/orders", admin);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "audit_unavailable" });
    expect(g.synced).toEqual([]); // the action never ran
    expect((await g.call("GET", "/admin/me", admin)).statusCode).toBe(200); // reads still work
    await f.app.close();
    await g.app.close();
  });

  it("changes get a pending row first, then the outcome", async () => {
    const f = setup();
    const admin = await f.login("admin@x.com");
    await f.call("POST", "/admin/sync/orders", admin);
    const row = f.audit.find((a) => a.action === "sync.orders")!;
    expect(row.result).toBe("pending"); // as inserted, before the action
    expect(row.outcome).toMatchObject({ result: "success", statusCode: 202 });
    await f.app.close();
  });
});

describe("no secrets in logs", () => {
  it("request logs never contain tokens, the JWT secret, the ID token or staff emails", async () => {
    const logLines: string[] = [];
    const f = setup({ logLines });
    const token = await f.login("op@x.com");
    await f.exchange("stranger@x.com");
    await f.call("POST", "/admin/auth/refresh", token);
    await f.call("GET", "/admin/me", token);
    await f.call("POST", "/admin/sync/orders", token);
    await f.app.close();
    const all = logLines.join("\n");
    expect(logLines.length).toBeGreaterThan(0);
    for (const secret of [ADMIN, JWT, SERVICE, ID_TOKEN, token, "op@x.com", "stranger@x.com", NONCE]) {
      expect(all).not.toContain(secret);
    }
  });
});
