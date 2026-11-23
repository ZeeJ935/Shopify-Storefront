import { connection } from "next/server";
import { NextResponse } from "next/server";
import { beginCustomerAuthorization } from "@/lib/customer-account/oauth";
import { reportError } from "@/lib/report-error";

export async function GET(request: Request) {
  await connection();
  try {
    return await beginCustomerAuthorization(request.url);
  } catch (error) {
    reportError(error, { area: "account", step: "authorize" });
    return NextResponse.redirect(
      new URL("/account/login?error=config", request.url),
      302,
    );
  }
}
