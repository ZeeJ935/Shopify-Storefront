import { NextResponse } from "next/server";
import { predictiveSearch } from "@/lib/search";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";

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
