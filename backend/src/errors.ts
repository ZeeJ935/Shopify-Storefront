// Logging helpers that never include query values. Drizzle's errors put the
// SQL parameters (customer IDs, product IDs) in their message, so we log the
// underlying database error instead: its type, Postgres code and message.

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };

/** The innermost cause, which for a failed query is the Postgres error. */
function rootCause(error: unknown): ErrorLike {
  let current = error as ErrorLike;
  for (let depth = 0; depth < 5 && current?.cause && typeof current.cause === "object"; depth++) {
    current = current.cause as ErrorLike;
  }
  return current ?? {};
}

/** A log-safe summary: no SQL text, no parameters. */
export function safeError(error: unknown) {
  const outer = (error ?? {}) as ErrorLike;
  const root = rootCause(error);
  const message = typeof root.message === "string" ? root.message : "unknown error";
  return {
    type: typeof outer.name === "string" ? outer.name : "Error",
    // Postgres SQLSTATE (e.g. 42P01 = table missing) when there is one.
    code: typeof root.code === "string" ? root.code : undefined,
    // A Postgres message describes the failure without values; drop anything after "params:" just in case.
    message: message.split(/\bparams:/)[0].trim().slice(0, 300),
  };
}
