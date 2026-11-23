/** Build a Shopify Order GID from a REST numeric id when needed. */
export function toOrderGid(id: string | number): string {
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/Order/${s}`;
}
