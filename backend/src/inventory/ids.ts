/** Build a Shopify GID from a REST numeric id when needed. */
export function toGid(resource: "InventoryItem" | "Location" | "Product" | "ProductVariant", id: string | number): string {
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/${resource}/${s}`;
}

export function numericIdFromGid(gid: string): string {
  const m = gid.match(/\/(\d+)(?:\?|$)/);
  return m?.[1] ?? gid;
}
