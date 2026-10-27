import { connection } from "next/server";
import { NextResponse } from "next/server";
import { buildCustomerLogoutUrl } from "@/lib/customer-account/oauth";
import {
  clearCustomerSessionCookies,
  getCustomerSession,
} from "@/lib/customer-account/session";

export async function GET(request: Request) {
  await connection();
  const session = await getCustomerSession();

  let logoutUrl = new URL("/", request.url).toString();
  try {
    logoutUrl = await buildCustomerLogoutUrl(session?.idToken);
  } catch (error) {
    console.error("[account/logout]", error);
  }

  const response = NextResponse.redirect(logoutUrl, 302);
  clearCustomerSessionCookies(response);
  return response;
}

export async function POST(request: Request) {
  return GET(request);
}
