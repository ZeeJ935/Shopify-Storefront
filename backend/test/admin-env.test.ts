import { describe, expect, it } from "vitest";
import { parseAllowlist, roleAtLeast, roleFor } from "../src/admin/allowlist.js";
import { readAdminEnv } from "../src/admin/env.js";
import { readEnv } from "../src/env.js";

const A = "a".repeat(40);
const J = "j".repeat(40);
const S = "s".repeat(40);
const base = { ADMIN_API_TOKEN: A, ADMIN_JWT_SECRET: J, ADMIN_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com" };

describe("ADMIN_ALLOWLIST", () => {
  it("parses email:role entries (commas or new lines), lower-casing emails", () => {
    const list = parseAllowlist(" Alice@X.com:admin,\nbob@x.com:Operator , carol@x.com:viewer ");
    expect([...list]).toEqual([
      ["alice@x.com", "admin"],
      ["bob@x.com", "operator"],
      ["carol@x.com", "viewer"],
    ]);
    expect(roleFor(list, "ALICE@x.com")).toBe("admin");
    expect(roleFor(list, "nobody@x.com")).toBeNull();
    expect(parseAllowlist(undefined).size).toBe(0);
  });

  it("rejects bad entries without echoing them", () => {
    for (const bad of ["alice@x.com", "alice@x.com:owner", "not-an-email:admin", "a@x.com:admin,A@x.com:viewer"]) {
      let message = "";
      try {
        parseAllowlist(bad);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(/ADMIN_ALLOWLIST entry \d/);
      expect(message).not.toMatch(/alice|not-an-email|owner/);
    }
  });

  it("orders roles viewer < operator < admin", () => {
    expect(roleAtLeast("admin", "operator")).toBe(true);
    expect(roleAtLeast("operator", "operator")).toBe(true);
    expect(roleAtLeast("viewer", "operator")).toBe(false);
    expect(roleAtLeast("operator", "admin")).toBe(false);
  });
});

describe("staff admin env", () => {
  it("is off when none of the required vars are set", () => {
    expect(readAdminEnv({})).toBeUndefined();
    expect(readEnv({ DATABASE_URL: "postgres://x/y", BACKEND_SERVICE_TOKEN: S }).staffAdmin).toBeUndefined();
  });

  it("parses a full config", () => {
    const env = readAdminEnv({ ...base, ADMIN_ALLOWLIST: "a@x.com:admin", ADMIN_GOOGLE_HOSTED_DOMAIN: "X.com" });
    expect(env).toMatchObject({ apiToken: A, jwtSecret: J, googleClientId: base.ADMIN_GOOGLE_CLIENT_ID, googleHostedDomain: "x.com" });
    expect(env?.allowlist.get("a@x.com")).toBe("admin");
  });

  it("fails closed on partial config, short or reused secrets — without echoing values", () => {
    const cases: Record<string, string>[] = [
      { ADMIN_API_TOKEN: A },
      { ...base, ADMIN_JWT_SECRET: "short" },
      { ...base, ADMIN_API_TOKEN_PREVIOUS: "short" },
      { ...base, ADMIN_JWT_SECRET: A },
      { ...base, BACKEND_SERVICE_TOKEN: A },
    ];
    for (const env of cases) {
      let message = "";
      try {
        readAdminEnv(env);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(A);
      expect(message).not.toContain(J);
    }
  });
});

describe("admin:token (local only)", () => {
  it("only accepts a database on this machine", async () => {
    const { isLocalDatabase } = await import("../src/admin/dev-token.js");
    expect(isLocalDatabase("postgres://zj:zj@127.0.0.1:5433/zj_backend")).toBe(true);
    expect(isLocalDatabase("postgres://zj:zj@localhost/zj")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@dpg-abc.oregon-postgres.render.com/db")).toBe(false);
    expect(isLocalDatabase(undefined)).toBe(false);
  });
});
