// LOCAL TESTING ONLY: prints a staff JWT for an allowlisted email, so /admin routes can be
// tried with curl before the admin app exists. Refuses to run unless DATABASE_URL points at
// this machine and NODE_ENV isn't production. Usage: npm run admin:token -- you@example.com
import pg from "pg";
import { roleFor } from "./allowlist.js";
import { readAdminEnv } from "./env.js";
import { signStaffToken } from "./jwt.js";
import { createStaffStore } from "./staff.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True only for a database on this machine. */
export function isLocalDatabase(databaseUrl: string | undefined): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(databaseUrl ?? "").hostname);
  } catch {
    return false;
  }
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npm run admin:token -- you@example.com");
  if (process.env.NODE_ENV === "production" || !isLocalDatabase(process.env.DATABASE_URL)) {
    throw new Error("admin:token is for local testing only (DATABASE_URL must be localhost/127.0.0.1, NODE_ENV not production).");
  }
  const env = readAdminEnv(process.env);
  if (!env) throw new Error("Set ADMIN_API_TOKEN, ADMIN_JWT_SECRET and ADMIN_GOOGLE_CLIENT_ID in backend/.env first.");
  const role = roleFor(env.allowlist, email);
  if (!role) throw new Error(`That email is not in ADMIN_ALLOWLIST. Add e.g. ADMIN_ALLOWLIST=${email}:admin to backend/.env and restart npm run dev.`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // A real staff row, so refresh and created_by_staff_id work like after a Google sign-in.
    const staffId = await createStaffStore(pool).upsertOnLogin({ email, googleSub: `local-dev:${email}`, role });
    const { token, expiresAt } = await signStaffToken(
      { current: env.jwtSecret },
      { staffId, email, role, sessionStartedAt: Math.floor(Date.now() / 1000) },
    );
    console.error(`staff ${staffId} (${role}); token valid until ${new Date(expiresAt * 1000).toLocaleTimeString()} (15 min)`);
    console.log(token);
  } finally {
    await pool.end();
  }
}

// Run only as a script (not when imported by tests).
if (process.argv[1]?.endsWith("dev-token.ts") || process.argv[1]?.endsWith("dev-token.js")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
