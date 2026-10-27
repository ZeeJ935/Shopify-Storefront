import { NextResponse } from "next/server";
import { buildCustomerLogoutUrl } from "@/lib/customer-account/oauth";
import {
  clearCustomerSession,
  getCustomerSession,
} from "@/lib/customer-account/session";

export async function GET(request: Request) {
  const session = await getCustomerSession();
  await clearCustomerSession();

  try {
    const logoutUrl = await buildCustomerLogoutUrl(session?.idToken);
    return NextResponse.redirect(logoutUrl, 302);
  } catch {
    return NextResponse.redirect(new URL("/", request.url), 302);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
