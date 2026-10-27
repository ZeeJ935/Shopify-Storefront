type AllowedHostInput = string | null | undefined | Array<string | null | undefined>;

function collectAllowedHosts(allowedHost?: AllowedHostInput): Set<string> {
  const allowed = new Set<string>(["checkout.shopify.com"]);

  const add = (value: string | null | undefined) => {
    const host = value?.trim().toLowerCase();
    if (host) {
      allowed.add(host);
    }
  };

  if (Array.isArray(allowedHost)) {
    for (const value of allowedHost) {
      add(value);
    }
  } else {
    add(allowedHost);
  }

  const siteUrl = process.env.SITE_URL?.trim();
  if (siteUrl) {
    try {
      add(new URL(siteUrl).hostname);
    } catch {
      // ignore malformed SITE_URL
    }
  }

  return allowed;
}

/**
 * Reject open redirects before navigating to Shopify checkout.
 * Allowed hosts: checkout.shopify.com, configured store/site hosts only.
 */
export function isSafeShopifyCheckoutUrl(
  url: string,
  allowedHost?: AllowedHostInput,
): boolean {
  if (typeof url !== "string" || url.trim().length === 0) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  if (parsed.username || parsed.password) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return collectAllowedHosts(allowedHost).has(host);
}

/** Hostnames used when sanitizing checkout URLs on the server. */
export function getCheckoutAllowedHosts(): string[] {
  const hosts: string[] = [];
  const store = process.env.SHOPIFY_STORE_DOMAIN?.trim().toLowerCase();
  if (store) {
    hosts.push(store);
  }
  const siteUrl = process.env.SITE_URL?.trim();
  if (siteUrl) {
    try {
      const siteHost = new URL(siteUrl).hostname.toLowerCase();
      if (siteHost && !hosts.includes(siteHost)) {
        hosts.push(siteHost);
      }
    } catch {
      // ignore
    }
  }
  return hosts;
}
