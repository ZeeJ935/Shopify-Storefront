import type { FastifyInstance } from "fastify";

/** Open endpoint for load balancers and uptime checks. Reports the database without exposing details. */
export function healthRoutes(app: FastifyInstance, pingDb: () => Promise<void>) {
  app.get("/health", async (_request, reply) => {
    try {
      await pingDb();
      return { ok: true, db: "up" };
    } catch (error) {
      app.log.error({ err: error }, "database ping failed");
      return reply.code(503).send({ ok: false, db: "down" });
    }
  });
}
