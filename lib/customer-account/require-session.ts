import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { RETURN_TO_HEADER } from "@/lib/return-to";
import { safeReturnTo } from "@/lib/favourites";
import { hasCustomerSession } from "./session";

export async function requireCustomerSession() {
  if (!(await hasCustomerSession())) {
    // Layouts can't see the URL; proxy.ts forwards it so login can return here.
    const returnTo = safeReturnTo((await headers()).get(RETURN_TO_HEADER));
    redirect(`/account/authorize?returnTo=${encodeURIComponent(returnTo)}`);
  }
}
