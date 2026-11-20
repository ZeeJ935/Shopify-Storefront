export type Env = {
  host: string;
  port: number;
  databaseUrl: string;
  serviceToken: string;
};

/** Reads and validates the service's environment. Throws with a clear message when something is missing. */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source.DATABASE_URL?.trim();
  const serviceToken = source.BACKEND_SERVICE_TOKEN?.trim();
  const port = Number(source.PORT ?? 4000);

  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!serviceToken || serviceToken.length < 32) {
    throw new Error("BACKEND_SERVICE_TOKEN is required and must be at least 32 characters.");
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid port number.");
  }

  return { host: source.HOST?.trim() || "127.0.0.1", port, databaseUrl, serviceToken };
}
