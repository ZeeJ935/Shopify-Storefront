/**
 * Classify product tags for facets. Brand/type/gender/sport are excluded from Color.
 */

const GENDER = new Set(["men", "women", "kids", "unisex"]);
const TYPE = new Set(["shoes", "clothing", "accessories"]);
const BRAND = new Set(["adidas", "nike"]);
const SPORT = new Set([
  "originals",
  "training",
  "soccer",
  "swim",
  "essentials",
  "running",
  "basketball",
  "tennis",
  "golf",
  "outdoor",
]);
const COLOR = new Set([
  "black",
  "white",
  "red",
  "blue",
  "green",
  "pink",
  "grey",
  "gray",
  "navy",
  "beige",
  "brown",
  "orange",
  "yellow",
  "purple",
  "burgundy",
  "multicolor",
  "multi",
  "gold",
  "silver",
]);

export type TagClass =
  | "brand"
  | "type"
  | "gender"
  | "color"
  | "sport"
  | "other";

export function classifyTag(tag: string): TagClass {
  const key = tag.trim().toLowerCase();
  if (BRAND.has(key)) return "brand";
  if (TYPE.has(key)) return "type";
  if (GENDER.has(key)) return "gender";
  if (COLOR.has(key)) return "color";
  if (SPORT.has(key)) return "sport";
  return "other";
}

export function colorTagsFromProduct(tags: string[]): string[] {
  return tags.filter((t) => classifyTag(t) === "color");
}

export function genderTagsFromProduct(tags: string[]): string[] {
  return tags.filter((t) => classifyTag(t) === "gender");
}

export function primaryColorTag(tags: string[]): string | null {
  const colors = colorTagsFromProduct(tags);
  return colors[0] ?? null;
}

export const COLOR_VOCABULARY = COLOR;
