import type { FastifyInstance } from "fastify";
import { requireCustomer } from "../auth.js";
import type { CustomersRepo } from "../db/client.js";

/**
 * Test endpoint for the service-token + customer-ID auth. Records that the
 * storefront has seen this customer and returns when we first saw them.
 */
export function meRoutes(app: FastifyInstance, customers: CustomersRepo) {
  app.get("/v1/me", { preHandler: requireCustomer }, async (request) => {
    const record = await customers.touch(request.customerId!);
    return { customerId: record.customerId, firstSeenAt: record.firstSeenAt.toISOString() };
  });
}
