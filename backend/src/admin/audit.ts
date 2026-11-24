import { createHmac } from "node:crypto";
import type pg from "pg";
import type { StaffRole } from "./allowlist.js";

export type AuditResult = "pending" | "success" | "denied" | "rejected" | "error";

export type AuditEntry = {
  staffId?: number | null;
  staffEmail?: string | null;
  role?: StaffRole | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  result: AuditResult;
  statusCode?: number | null;
  requestId?: string | null;
  detail?: Record<string, unknown> | null;
};

export type AuditOutcome = {
  result: Exclude<AuditResult, "pending">;
  statusCode: number;
  resourceId?: string | null;
  detail?: Record<string, unknown> | null;
};

export type AuditStore = {
  /** Inserts a row; throws on failure (callers decide best-effort vs fail-closed). */
  insert(entry: AuditEntry): Promise<number>;
  /** Sets the outcome of a pending row. */
  complete(id: number, outcome: AuditOutcome): Promise<void>;
  list(opts: { before?: number | null; limit: number }): Promise<AuditRow[]>;
};

export type AuditRow = {
  id: number;
  at: string;
  staffId: number | null;
  staffEmail: string | null;
  role: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: string;
  statusCode: number | null;
  requestId: string | null;
  detail: Record<string, unknown> | null;
  completedAt: string | null;
};

/**
 * Only these detail keys are ever stored, and only primitive values: no request bodies,
 * customer data, tokens or free text from callers.
 */
export const AUDIT_DETAIL_KEYS: ReadonlySet<string> = new Set([
  "reason",
  "dry_run",
  "idempotency_key",
  "replayed",
  "notify_customer",
  "line_count",
  "queue",
  "email_hash",
  "required_role",
  "route",
  "sku",
  "quantity",
  "previous_quantity",
  "item_count",
  "allow_large_decrease",
  "push_mode",
]);

export function sanitizeDetail(detail: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (!AUDIT_DETAIL_KEYS.has(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Keyed hash of an email for rejected sign-ins: correlatable, not reversible without the key. */
export function emailHash(key: string, email: string): string {
  return createHmac("sha256", key).update(`audit-email:${email.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

/** jsonb parameter: SQL NULL (not the JSON value null) when there is nothing to store. */
function detailParam(detail: Record<string, unknown> | null | undefined): string | null {
  const clean = sanitizeDetail(detail);
  return clean ? JSON.stringify(clean) : null;
}

export function createAuditStore(pool: pg.Pool): AuditStore {
  return {
    async insert(e) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into audit_log (staff_id, staff_email, role, action, resource_type, resource_id, result, status_code, request_id, detail, completed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, case when $7 = 'pending' then null else now() end)
         returning id`,
        [
          e.staffId ?? null,
          e.staffEmail ?? null,
          e.role ?? null,
          e.action,
          e.resourceType ?? null,
          e.resourceId ?? null,
          e.result,
          e.statusCode ?? null,
          e.requestId ?? null,
          detailParam(e.detail),
        ],
      );
      return Number(rows[0].id);
    },
    async complete(id, o) {
      await pool.query(
        `update audit_log set result = $2, status_code = $3, resource_id = coalesce($4, resource_id),
           detail = case when $5::jsonb is null then detail else coalesce(detail, '{}'::jsonb) || $5::jsonb end,
           completed_at = now()
         where id = $1 and result = 'pending'`,
        [id, o.result, o.statusCode, o.resourceId ?? null, detailParam(o.detail)],
      );
    },
    async list({ before, limit }) {
      const { rows } = await pool.query<{
        id: string;
        at: Date;
        staff_id: string | null;
        staff_email: string | null;
        role: string | null;
        action: string;
        resource_type: string | null;
        resource_id: string | null;
        result: string;
        status_code: number | null;
        request_id: string | null;
        detail: Record<string, unknown> | null;
        completed_at: Date | null;
      }>(
        `select id, at, staff_id, staff_email, role, action, resource_type, resource_id, result, status_code, request_id, detail, completed_at
         from audit_log where ($1::bigint is null or id < $1) order by id desc limit $2`,
        [before ?? null, limit],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        at: r.at.toISOString(),
        staffId: r.staff_id == null ? null : Number(r.staff_id),
        staffEmail: r.staff_email,
        role: r.role,
        action: r.action,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        result: r.result,
        statusCode: r.status_code,
        requestId: r.request_id,
        detail: r.detail,
        completedAt: r.completed_at ? r.completed_at.toISOString() : null,
      }));
    },
  };
}
