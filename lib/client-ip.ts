/**
 * The visitor's IP for rate limiting, read only from a header the platform sets.
 *
 * On Vercel, `x-vercel-forwarded-for` / `x-forwarded-for` are set from the TCP
 * connection and any client-sent value is overwritten, so they can't be spoofed
 * (as long as Vercel is the outermost proxy, as it is here). Elsewhere (local
 * dev) there is no trusted header, so client-supplied values are never used and
 * everyone shares one key.
 */
export function clientIp(headers: Headers, env: { VERCEL?: string }): string {
  if (!env.VERCEL) return "local";
  const first = (value: string | null) => value?.split(",")[0]?.trim() || "";
  return first(headers.get("x-vercel-forwarded-for")) || first(headers.get("x-forwarded-for")) || "unknown";
}
