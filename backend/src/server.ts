import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { readEnv } from "./env.js";

const env = readEnv();
const db = createDb(env.databaseUrl);
const app = buildApp({
  serviceToken: env.serviceToken,
  customers: db.customers,
  pingDb: db.ping,
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});

const shutdown = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: env.host, port: env.port });
