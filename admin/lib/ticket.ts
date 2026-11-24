// Pure: sealed confirm tickets. The idempotency key is created once per confirm screen and
// sealed with the exact request body, so the browser can't change either, and a double
// click (or resubmit) replays the same key instead of acting twice.
import { seal, unseal } from "./seal";

export const TICKET_TTL_SECONDS = 15 * 60;
const KEY = /^[A-Za-z0-9._:-]{8,200}$/;

type Ticket<T> = { key: string; body: T; staffId: number; exp: number; kind: string };

export function sealTicket<T>(kind: string, body: T, staffId: number, secret: string, nowSeconds: number, key: string = crypto.randomUUID()): string {
  return seal({ kind, key, body, staffId, exp: nowSeconds + TICKET_TTL_SECONDS } satisfies Ticket<T>, secret);
}

/** Null when tampered, for another kind of action, another staff member, or expired. */
export function openSealedTicket<T>(kind: string, ticket: string, staffId: number, secret: string, nowSeconds: number): { key: string; body: T } | null {
  const t = unseal<Ticket<T>>(ticket, secret);
  if (!t || t.kind !== kind || typeof t.key !== "string" || !KEY.test(t.key) || t.body == null || typeof t.exp !== "number") return null;
  if (t.staffId !== staffId || nowSeconds > t.exp) return null;
  return { key: t.key, body: t.body };
}
