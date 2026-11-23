import { createHash } from "node:crypto";
import type pg from "pg";
import type { CatalogFilters, CatalogRaw, CatalogSort, FacetValue, ProductListItem } from "../catalog-shared/types.js";
import { isTracked, key } from "./derive.js";

export const DEFAULT_LIMIT = 24; // the storefront's PAGE_SIZE
export const MAX_LIMIT = 100;

export type CatalogQuery = {
  scope: string | null;
  filters: CatalogFilters;
  sort: CatalogSort;
  page: number;
  limit: number;
  cursor: string | null;
  q: string | null;
};

export type CatalogQueryResponse = CatalogRaw & { nextCursor: string | null; empty: boolean };

/** Positional SQL parameters. */
class Params {
  values: unknown[] = [];
  add(value: unknown) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

type FilterKey = keyof CatalogFilters | "q";

type SortSpec = { expr: string; dir: "asc" | "desc"; cast: string };

/** ORDER BY for each sort, always ending with catalog_position so ties keep Shopify's order (as the old stable sort did). */
function sortSpecs(sort: CatalogSort, scoped: boolean): SortSpec[] {
  const bestSelling: SortSpec = { expr: "coalesce(p.best_selling_rank, 2147483647)", dir: "asc", cast: "int" };
  const primary: SortSpec = (() => {
    switch (sort) {
      case "latest":
        return { expr: "coalesce(p.created_at, 'epoch'::timestamptz)", dir: "desc", cast: "timestamptz" };
      case "price-asc":
        return { expr: "p.min_price", dir: "asc", cast: "numeric" };
      case "price-desc":
        return { expr: "p.min_price", dir: "desc", cast: "numeric" };
      case "name-asc":
        return { expr: "p.title_group", dir: "asc", cast: "int" };
      case "name-desc":
        return { expr: "p.title_group", dir: "desc", cast: "int" };
      case "best-selling":
        return bestSelling;
      case "featured":
      default:
        return scoped ? { expr: "pc.position", dir: "asc", cast: "int" } : bestSelling;
    }
  })();
  return [primary, { expr: "p.catalog_position", dir: "asc", cast: "int" }];
}

/** Where a query's base set comes from: a tracked collection, or the whole catalog. */
function baseFrom(scope: string | null, params: Params) {
  return scope
    ? `products p join product_collections pc on pc.product_id = p.id and pc.collection_handle = ${params.add(scope)}`
    : "products p";
}

function whereSql(query: CatalogQuery, params: Params, except: FilterKey | null): string {
  const f = query.filters;
  const parts: string[] = ["true"];
  const keys = (values: string[]) => [...new Set(values.map(key).filter(Boolean))];
  if (except !== "brand" && f.brand.length) parts.push(`p.vendor_key = any(${params.add(keys(f.brand))}::text[])`);
  if (except !== "type" && f.type.length) parts.push(`p.type_key = any(${params.add(keys(f.type))}::text[])`);
  if (except !== "gender" && f.gender.length) parts.push(`p.gender_keys && ${params.add(keys(f.gender))}::text[]`);
  if (except !== "size" && f.size.length) parts.push(`p.size_keys && ${params.add(keys(f.size))}::text[]`);
  if (except !== "color" && f.color.length) parts.push(`p.color_key = any(${params.add(keys(f.color))}::text[])`);
  if (except !== "sale" && f.sale === true) parts.push("p.on_sale");
  if (except !== "available" && f.available === true) parts.push("p.available");
  if (except !== "available" && f.available === false) parts.push("not p.available");
  if (except !== "priceMin" && f.priceMin !== null) parts.push(`p.min_price >= ${params.add(f.priceMin)}::numeric`);
  if (except !== "priceMax" && f.priceMax !== null) parts.push(`p.min_price <= ${params.add(f.priceMax)}::numeric`);
  if (except !== "q" && query.q) {
    const pattern = params.add(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    parts.push(`(p.title ilike ${pattern} or p.vendor ilike ${pattern} or p.product_type ilike ${pattern})`);
  }
  return parts.join(" and ");
}

const FACET_LABELS = {
  brand: "array[p.vendor]",
  type: "array[p.product_type]",
  gender: "p.gender_tags",
  size: "p.sizes",
  color: "array[p.color]",
} as const;

type FacetGroupKey = keyof typeof FACET_LABELS;

/**
 * Facet values for one group, counted like the old countFacet: per product,
 * each case-insensitive value once; label and order from the first product
 * (in catalog order) that has it.
 */
async function facetValues(pool: pg.Pool, query: CatalogQuery, scope: string | null, group: FacetGroupKey, filtered: boolean) {
  const params = new Params();
  const from = baseFrom(scope, params);
  const where = filtered ? whereSql(query, params, group) : "true";
  const { rows } = await pool.query<{ label: string; count: string }>(
    `with v as (
       select p.id, p.catalog_position, trim(t.label) as label, t.ord
       from ${from} cross join lateral unnest(${FACET_LABELS[group]}) with ordinality as t(label, ord)
       where ${where} and coalesce(trim(t.label), '') <> ''
     ),
     d as (
       select distinct on (id, lower(label)) id, catalog_position, label, ord, lower(label) as k
       from v order by id, lower(label), ord
     )
     select (array_agg(label order by catalog_position, ord))[1] as label, count(*) as count
     from d group by k
     order by min(catalog_position), (array_agg(ord order by catalog_position, ord))[1]`,
    params.values,
  );
  return rows.map((r): FacetValue => ({ value: r.label, label: r.label, count: Number(r.count) }));
}

async function countWith(pool: pg.Pool, query: CatalogQuery, scope: string | null, except: FilterKey, column: string) {
  const params = new Params();
  const from = baseFrom(scope, params);
  const where = whereSql(query, params, except);
  const { rows } = await pool.query<{ yes: string; total: string }>(
    `select count(*) filter (where ${column}) as yes, count(*) as total from ${from} where ${where}`,
    params.values,
  );
  return { yes: Number(rows[0].yes), total: Number(rows[0].total) };
}

function fingerprint(query: CatalogQuery) {
  const { cursor: _cursor, page: _page, ...rest } = query;
  return createHash("sha256").update(JSON.stringify(rest)).digest("base64url").slice(0, 16);
}

type CursorData = { f: string; k: string[] };
const encodeCursor = (data: CursorData) => Buffer.from(JSON.stringify(data)).toString("base64url");
export class InvalidCursorError extends Error {}
function decodeCursor(cursor: string, expected: string, size: number): string[] {
  try {
    const data = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorData;
    if (data.f !== expected || !Array.isArray(data.k) || data.k.length !== size || !data.k.every((v) => typeof v === "string")) {
      throw new Error("mismatch");
    }
    return data.k;
  } catch {
    throw new InvalidCursorError("Cursor doesn't match this query");
  }
}

/** Keyset condition: rows strictly after `values` in the given ORDER BY. */
function afterSql(specs: SortSpec[], values: string[], params: Params) {
  const ors = specs.map((spec, i) => {
    const eqs = specs.slice(0, i).map((s, j) => `${s.expr} = ${params.add(values[j])}::${s.cast}`);
    const op = spec.dir === "asc" ? ">" : "<";
    return `(${[...eqs, `${spec.expr} ${op} ${params.add(values[i])}::${spec.cast}`].join(" and ")})`;
  });
  return `(${ors.join(" or ")})`;
}

export async function queryCatalogSql(pool: pg.Pool, query: CatalogQuery): Promise<CatalogQueryResponse> {
  const scope = query.scope && query.scope !== "all" && isTracked(query.scope) ? query.scope : null;
  const specs = sortSpecs(query.sort, scope !== null);
  const orderBy = specs.map((s) => `${s.expr} ${s.dir}`).join(", ");
  const fp = fingerprint(query);

  const [{ rows: countRows }, { rows: stateRows }] = await Promise.all([
    pool.query<{ n: string }>("select count(*) as n from products"),
    pool.query<{ best_selling_count: number }>("select best_selling_count from catalog_state where id = 1"),
  ]);
  const hasBestSelling = (stateRows[0]?.best_selling_count ?? 0) > 0;
  if (Number(countRows[0].n) === 0) {
    return {
      ...emptyRaw(query.page, hasBestSelling),
      nextCursor: null,
      empty: true,
    };
  }

  // Products for this page (or after the cursor).
  const params = new Params();
  const from = baseFrom(scope, params);
  let where = whereSql(query, params, null);
  if (query.cursor) where += ` and ${afterSql(specs, decodeCursor(query.cursor, fp, specs.length), params)}`;
  const offset = query.cursor ? 0 : (query.page - 1) * query.limit;
  const keyCols = specs.map((s, i) => `(${s.expr})::text as k${i}`).join(", ");
  const productsSql = `select p.data, ${keyCols} from ${from} where ${where} order by ${orderBy} limit ${query.limit + 1} offset ${offset}`;

  const tp = new Params();
  const totalSql = `select count(*) as n from ${baseFrom(scope, tp)} where ${whereSql(query, tp, null)}`;
  const [productRows, totalRow, bounds, brand, type, gender, size, color, sale, avail, bBrand, bType, bGender, bSize, bColor] =
    await Promise.all([
      pool.query<Record<string, unknown> & { data: ProductListItem }>(productsSql, params.values),
      pool.query<{ n: string }>(totalSql, tp.values),
      (async () => {
        const bp = new Params();
        const { rows } = await pool.query<{ min: string | null; max: string | null }>(
          `select floor(min(p.min_price)) as min, ceil(max(p.min_price)) as max from ${baseFrom(scope, bp)}`,
          bp.values,
        );
        return { min: Number(rows[0].min ?? 0), max: Number(rows[0].max ?? 0) };
      })(),
      facetValues(pool, query, scope, "brand", true),
      facetValues(pool, query, scope, "type", true),
      facetValues(pool, query, scope, "gender", true),
      facetValues(pool, query, scope, "size", true),
      facetValues(pool, query, scope, "color", true),
      countWith(pool, query, scope, "sale", "p.on_sale"),
      countWith(pool, query, scope, "available", "p.available"),
      facetValues(pool, query, scope, "brand", false),
      facetValues(pool, query, scope, "type", false),
      facetValues(pool, query, scope, "gender", false),
      facetValues(pool, query, scope, "size", false),
      facetValues(pool, query, scope, "color", false),
    ]);

  const rows = productRows.rows;
  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  const total = Number(totalRow.rows[0].n);
  const pageCount = Math.max(1, Math.ceil(total / query.limit));
  const last = pageRows[pageRows.length - 1];

  return {
    products: pageRows.map((r) => r.data),
    total,
    page: query.cursor ? 0 : query.page,
    pageCount,
    hasNextPage: query.cursor ? hasMore : query.page < pageCount,
    nextCursor: hasMore && last ? encodeCursor({ f: fp, k: specs.map((_, i) => String(last[`k${i}`])) }) : null,
    priceBounds: bounds,
    hasBestSelling,
    facets: {
      brand,
      type,
      gender,
      size,
      color,
      saleCount: sale.yes,
      saleBase: sale.total,
      inStock: avail.yes,
      outOfStock: avail.total - avail.yes,
    },
    baseDistinct: {
      brand: bBrand.length,
      type: bType.length,
      gender: bGender.length,
      size: bSize.length,
      color: bColor.length,
    },
    empty: false,
  };
}

function emptyRaw(page: number, hasBestSelling: boolean): CatalogRaw {
  return {
    products: [],
    total: 0,
    page,
    pageCount: 1,
    hasNextPage: false,
    priceBounds: { min: 0, max: 0 },
    hasBestSelling,
    facets: { brand: [], type: [], gender: [], size: [], color: [], saleCount: 0, saleBase: 0, inStock: 0, outOfStock: 0 },
    baseDistinct: { brand: 0, type: 0, gender: 0, size: 0, color: 0 },
  };
}

/** Products in the order asked; unknown IDs are skipped. */
export async function productsByIds(pool: pg.Pool, ids: string[]): Promise<ProductListItem[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<{ data: ProductListItem }>(
    `select p.data from unnest($1::text[]) with ordinality as x(id, ord) join products p on p.id = x.id order by x.ord`,
    [ids],
  );
  return rows.map((r) => r.data);
}

export type OverviewProduct = Pick<ProductListItem, "handle" | "vendor" | "createdAt" | "featuredImage" | "images"> & {
  updatedAt: string | null;
};

/** Light product list in catalog order, for the storefront's nav (brand tiles) and sitemap. */
export async function catalogOverview(pool: pg.Pool): Promise<{ products: OverviewProduct[]; empty: boolean }> {
  const { rows } = await pool.query<{
    handle: string;
    vendor: string;
    created_at: string | null;
    featured: ProductListItem["featuredImage"];
    first_image: ProductListItem["featuredImage"];
    updated_at: Date | null;
  }>(
    `select handle, vendor, data->>'createdAt' as created_at, data->'featuredImage' as featured,
            data->'images'->0 as first_image, updated_at
     from products order by catalog_position`,
  );
  return {
    empty: rows.length === 0,
    products: rows.map((r) => ({
      handle: r.handle,
      vendor: r.vendor,
      createdAt: r.created_at ?? undefined,
      featuredImage: r.featured ?? null,
      images: r.first_image ? [r.first_image] : [],
      updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
    })),
  };
}
