function toMs(value: Date | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Last-write-wins by timestamp for later order/inventory handlers.
 * Apply when incoming is equal or newer, or when either side is missing/unparseable.
 * Ignore only when incoming is strictly older than what is already stored.
 */
export function shouldApply(
  existingUpdatedAt: Date | string | null | undefined,
  incomingUpdatedAt: Date | string | null | undefined,
): boolean {
  const existing = toMs(existingUpdatedAt);
  const incoming = toMs(incomingUpdatedAt);
  if (existing == null || incoming == null) return true;
  return incoming >= existing;
}
