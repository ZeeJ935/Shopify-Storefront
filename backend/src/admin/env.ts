import { parseAllowlist, type Allowlist } from "./allowlist.js";

/** Staff admin API config. Absent when ADMIN_API_TOKEN, ADMIN_JWT_SECRET and ADMIN_GOOGLE_CLIENT_ID are all unset. */
export type AdminEnv = {
  /** Shared secret between the admin app's server and /admin/* (separate from BACKEND_SERVICE_TOKEN). */
  apiToken: string;
  /** Accepted during rotation, alongside apiToken. */
  apiTokenPrevious?: string;
  /** Signs staff JWTs (HS256). */
  jwtSecret: string;
  /** Still verifies tokens during rotation; never signs. */
  jwtSecretPrevious?: string;
  allowlist: Allowlist;
  /** Audience of Google ID tokens (the admin app's OAuth client id). */
  googleClientId: string;
  /** Optional Google Workspace domain every staff account must belong to (`hd` claim). */
  googleHostedDomain?: string;
};

const MIN_SECRET = 32;
const REQUIRED = ["ADMIN_API_TOKEN", "ADMIN_JWT_SECRET", "ADMIN_GOOGLE_CLIENT_ID"] as const;

/**
 * Reads the staff admin config. All of ADMIN_API_TOKEN, ADMIN_JWT_SECRET and
 * ADMIN_GOOGLE_CLIENT_ID unset → undefined (/admin stays off). Some but not all set,
 * short secrets, a reused secret, or a bad ADMIN_ALLOWLIST → throws (never echoing values).
 */
export function readAdminEnv(source: NodeJS.ProcessEnv): AdminEnv | undefined {
  const get = (name: string) => source[name]?.trim() || undefined;
  const present = REQUIRED.filter((n) => get(n));
  if (present.length === 0) return undefined;
  if (present.length < REQUIRED.length) {
    const missing = REQUIRED.filter((n) => !get(n));
    throw new Error(`Staff admin is partly configured: also set ${missing.join(", ")} (or unset all of ${REQUIRED.join(", ")}).`);
  }

  const apiToken = get("ADMIN_API_TOKEN")!;
  const apiTokenPrevious = get("ADMIN_API_TOKEN_PREVIOUS");
  const jwtSecret = get("ADMIN_JWT_SECRET")!;
  const jwtSecretPrevious = get("ADMIN_JWT_SECRET_PREVIOUS");

  for (const [name, value] of [
    ["ADMIN_API_TOKEN", apiToken],
    ["ADMIN_API_TOKEN_PREVIOUS", apiTokenPrevious],
    ["ADMIN_JWT_SECRET", jwtSecret],
    ["ADMIN_JWT_SECRET_PREVIOUS", jwtSecretPrevious],
  ] as const) {
    if (value !== undefined && value.length < MIN_SECRET) throw new Error(`${name} must be at least ${MIN_SECRET} characters.`);
  }
  const secrets = [apiToken, apiTokenPrevious, jwtSecret, jwtSecretPrevious, get("BACKEND_SERVICE_TOKEN")].filter(Boolean);
  if (new Set(secrets).size !== secrets.length) {
    throw new Error("ADMIN_API_TOKEN, ADMIN_JWT_SECRET (and their _PREVIOUS values) and BACKEND_SERVICE_TOKEN must all be different.");
  }

  return {
    apiToken,
    apiTokenPrevious,
    jwtSecret,
    jwtSecretPrevious,
    allowlist: parseAllowlist(source.ADMIN_ALLOWLIST),
    googleClientId: get("ADMIN_GOOGLE_CLIENT_ID")!,
    googleHostedDomain: get("ADMIN_GOOGLE_HOSTED_DOMAIN")?.toLowerCase(),
  };
}
