import { connection } from "next/server";
import { NextResponse } from "next/server";
import { completeCustomerAuthorization } from "@/lib/customer-account/oauth";

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    const reason = error === "access_denied" ? "cancelled" : "oauth";
    return NextResponse.redirect(
      new URL(`/account/login?error=${reason}`, request.url),
      302,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/account/login?error=oauth", request.url),
      302,
    );
  }

  try {
    return await completeCustomerAuthorization({
      code,
      state,
      requestUrl: request.url,
    });
  } catch (err) {
    console.error("[account/callback]", err);
    return NextResponse.redirect(
      new URL("/account/login?error=oauth", request.url),
      302,
    );
  }
}
