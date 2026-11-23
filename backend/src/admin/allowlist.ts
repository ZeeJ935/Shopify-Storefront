/** Staff roles, lowest to highest. Each role can do everything the roles before it can. */
export const STAFF_ROLES = ["viewer", "operator", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Lower-cased email → role. */
export type Allowlist = ReadonlyMap<string, StaffRole>;

const EMAIL = /^[^\s@:,]+@[^\s@:,]+\.[^\s@:,]+$/;

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** True when `role` is at least `required` (viewer < operator < admin). */
export function roleAtLeast(role: StaffRole, required: StaffRole): boolean {
  return STAFF_ROLES.indexOf(role) >= STAFF_ROLES.indexOf(required);
}

/**
 * Parses ADMIN_ALLOWLIST: `email:role` entries separated by commas or new lines,
 * e.g. `a@x.com:admin, b@x.com:operator`. Emails are compared lower-cased.
 * Throws on a malformed entry, unknown role or duplicate email. Messages give the
 * entry number only, never its text.
 */
export function parseAllowlist(raw: string | undefined): Allowlist {
  const map = new Map<string, StaffRole>();
  const entries = (raw ?? "")
    .split(/[,\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
  entries.forEach((entry, i) => {
    const at = entry.lastIndexOf(":");
    const email = (at > 0 ? entry.slice(0, at) : "").trim().toLowerCase();
    const role = (at > 0 ? entry.slice(at + 1) : "").trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error(`ADMIN_ALLOWLIST entry ${i + 1} must look like email:role.`);
    if (!isStaffRole(role)) throw new Error(`ADMIN_ALLOWLIST entry ${i + 1} has an unknown role (use ${STAFF_ROLES.join(", ")}).`);
    if (map.has(email)) throw new Error(`ADMIN_ALLOWLIST entry ${i + 1} repeats an email.`);
    map.set(email, role);
  });
  return map;
}

/** The allowlisted role for an email, or null when it isn't on the list. */
export function roleFor(allowlist: Allowlist, email: string): StaffRole | null {
  return allowlist.get(email.trim().toLowerCase()) ?? null;
}
