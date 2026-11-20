import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { isServiceTokenValid } from "@/lib/service-token";
import { CATALOG_TAG } from "@/lib/shopify";

/**
 * Called by the backend after it processes a catalog webhook (product,
 * collection or stock change). Needs the shared BACKEND_SERVICE_TOKEN and
 * clears the catalog cache tag; it does nothing else.
 */
export async function POST(request: Request) {
  const token = process.env.BACKEND_SERVICE_TOKEN?.trim();
  if (!token) {
    // 503 so the backend's queue retries once the token is configured.
    console.error("[revalidate] BACKEND_SERVICE_TOKEN is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (!isServiceTokenValid(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // From outside a Server Action, expire immediately: the next visitor gets fresh data.
  revalidateTag(CATALOG_TAG, { expire: 0 });
  console.info("[revalidate] catalog cache cleared");
  return NextResponse.json({ revalidated: true });
}
