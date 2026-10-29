"use server";

import { revalidatePath } from "next/cache";
// Lets an expired session's refresh redirect escape the catch below.
import { unstable_rethrow } from "next/navigation";
import {
  updateCustomerProfile,
  type MutationResult,
} from "@/lib/customer-account/api";

export async function updateProfileAction(
  formData: FormData,
): Promise<MutationResult> {
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  if (!firstName) fieldErrors.firstName = "First name is required.";
  if (!lastName) fieldErrors.lastName = "Last name is required.";
  if (Object.keys(fieldErrors).length) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors,
    };
  }

  try {
    const result = await updateCustomerProfile({ firstName, lastName });
    if (result.ok) {
      revalidatePath("/account");
      revalidatePath("/account/profile");
    }
    return result.ok
      ? { ok: true, message: "Profile saved." }
      : result;
  } catch (error) {
    unstable_rethrow(error);
    // Log the API detail; the shopper only needs to know it didn't save.
    console.error("[account/profile] updateProfile", error);
    return {
      ok: false,
      message: "Could not save profile. Please try again.",
    };
  }
}
