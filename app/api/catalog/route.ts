import { NextResponse } from "next/server";
import { parseCatalogParams } from "@/lib/catalog-query";
import { queryCatalog } from "@/lib/catalog-source";
import { reportError } from "@/lib/report-error";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { filters, sort, page, scope } = parseCatalogParams(searchParams);

  try {
    const result = await queryCatalog({
      scope,
      filters,
      sort,
      page,
    });

    return NextResponse.json({
      products: result.products,
      total: result.total,
      page: result.page,
      pageCount: result.pageCount,
      hasNextPage: result.hasNextPage,
      facets: result.facets,
      priceBounds: result.priceBounds,
      sort: result.sort,
      sortOptions: result.sortOptions,
    });
  } catch (error) {
    reportError(error, { area: "catalog", step: "api" });
    return NextResponse.json(
      { error: "Unable to load catalog", products: [], total: 0, page: 1 },
      { status: 500 },
    );
  }
}
