import { NextResponse, type NextRequest } from "next/server";
import { readConfig } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session";

/** POST only, same-origin only (a cross-site form can't sign staff out). */
export async function POST(request: NextRequest) {
  const config = readConfig();
  if (request.headers.get("origin") !== new URL(config.appUrl).origin) return new NextResponse("Forbidden", { status: 403 });
  const response = NextResponse.redirect(new URL("/login", config.appUrl), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
