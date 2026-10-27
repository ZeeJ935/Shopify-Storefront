import { connection } from "next/server";
import { NextResponse } from "next/server";
import { refreshCustomerSessionTokens } from "@/lib/customer-account/oauth";
import {
  applyCustomerSession,
  clearCustomerSessionCookies,
  getCustomerSession,
} from "@/lib/customer-account/session";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const returnToRaw = searchParams.get("return_to") || "/account";
  const returnTo = returnToRaw.startsWith("/") ? returnToRaw : "/account";

  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.redirect(
      new URL("/account/authorize", request.url),
      302,
    );
  }

  try {
    const refreshed = await refreshCustomerSessionTokens(session);
    const response = NextResponse.redirect(new URL(returnTo, request.url), 302);
    applyCustomerSession(response, refreshed);
    return response;
  } catch (error) {
    console.error("[account/refresh]", error);
    const response = NextResponse.redirect(
      new URL("/account/login?error=oauth", request.url),
      302,
    );
    clearCustomerSessionCookies(response);
    return response;
  }
}
