import { redirect } from "next/navigation";
import { hasCustomerSession } from "./session";

export async function requireCustomerSession() {
  if (!(await hasCustomerSession())) {
    redirect("/account/authorize");
  }
}
