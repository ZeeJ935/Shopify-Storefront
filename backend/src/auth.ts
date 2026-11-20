import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireCustomer; the Shopify customer ID the storefront is acting for. */
    customerId?: string;
  }
}

// Shopify's numeric ID today; also allows gid:// style IDs if that ever changes.
const CUSTOMER_ID = /^[A-Za-z0-9:/._-]{1,255}$/;

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/** Constant-time comparison of a presented bearer token with the expected service token. */
export function isValidServiceToken(header: string | undefined, expected: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return false;
  // Comparing fixed-length digests keeps the check constant-time regardless of input length.
  return timingSafeEqual(digest(match[1]), digest(expected));
}

export function isValidCustomerId(value: unknown): value is string {
  return typeof value === "string" && CUSTOMER_ID.test(value);
}

/** Only the Next.js server holds the token; the browser never calls this service. */
export function requireServiceToken(expected: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isValidServiceToken(request.headers.authorization, expected)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
}

/** Runs after requireServiceToken, so header rules are never revealed to unauthenticated callers. */
export async function requireCustomer(request: FastifyRequest, reply: FastifyReply) {
  const id = request.headers["x-customer-id"];
  if (!isValidCustomerId(id)) {
    return reply.code(400).send({ error: "invalid_customer_id" });
  }
  request.customerId = id;
}
