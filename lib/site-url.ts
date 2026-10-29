/**
 * Metadata `alternates` with an absolute canonical for `path` (no query
 * string, so filtered/sorted URLs point at the clean page). Omitted when
 * SITE_URL isn't set, matching the product page.
 */
export function canonicalFor(path: string): { canonical: string } | undefined {
  const siteUrl = getSiteUrl();
  return siteUrl ? { canonical: `${siteUrl}${path}` } : undefined;
}

/** Public storefront origin. Never invent a production domain. */
export function getSiteUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
