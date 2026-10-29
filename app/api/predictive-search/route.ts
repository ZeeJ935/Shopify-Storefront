import { NextResponse } from "next/server";
import { predictiveSearch } from "@/lib/search";

const MAX_QUERY_LENGTH = 100;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

  // Real searches are short; long strings only cost Shopify API budget.
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }

  if (!q.trim()) {
    return NextResponse.json({
      products: [],
      collections: [],
      queries: [],
    });
  }

  try {
    const result = await predictiveSearch(q);
    return NextResponse.json({
      products: result.products.map((p) => ({
        id: p.id,
        handle: p.handle,
        title: p.title,
        vendor: p.vendor,
        featuredImage: p.featuredImage,
        priceRange: p.priceRange,
      })),
      collections: result.collections,
      queries: result.queries,
    });
  } catch {
    return NextResponse.json(
      { products: [], collections: [], queries: [], error: true },
      { status: 200 },
    );
  }
}
