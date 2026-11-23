/**
 * Backend first, in-memory snapshot as the fallback, so the site never shows an
 * empty catalog. Pure (dependencies passed in) so it's unit tested without a server.
 */
export async function withCatalogFallback<T>(options: {
  /** False when BACKEND_URL / BACKEND_SERVICE_TOKEN aren't set: use the snapshot, as before. */
  configured: boolean;
  fromBackend: () => Promise<T & { empty?: boolean }>;
  fromSnapshot: () => Promise<T>;
  /** For the log line, e.g. "catalog" or "overview". */
  label: string;
  log?: (message: string) => void;
}): Promise<{ value: T; source: "backend" | "snapshot" }> {
  const log = options.log ?? ((message: string) => console.error(message));
  if (!options.configured) return { value: await options.fromSnapshot(), source: "snapshot" };
  try {
    const value = await options.fromBackend();
    if (!value.empty) return { value, source: "backend" };
    log(`[catalog] ${options.label} fallback: backend catalog is empty`);
  } catch (error) {
    log(`[catalog] ${options.label} fallback: ${error instanceof Error ? error.message.slice(0, 200) : "backend error"}`);
  }
  return { value: await options.fromSnapshot(), source: "snapshot" };
}
