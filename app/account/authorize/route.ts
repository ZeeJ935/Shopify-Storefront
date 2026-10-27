import { NextResponse } from "next/server";
import { beginCustomerAuthorization } from "@/lib/customer-account/oauth";

export async function GET(request: Request) {
  try {
    const url = await beginCustomerAuthorization();
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.redirect(
      new URL("/account/login?error=config", request.url),
      302,
    );
  }
}
