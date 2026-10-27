"use server";

import { revalidatePath } from "next/cache";
import {
  createCustomerAddress,
  deleteCustomerAddress,
  updateCustomerAddress,
  type CustomerAddressInput,
  type MutationResult,
} from "@/lib/customer-account/api";

function parseAddress(formData: FormData): CustomerAddressInput {
  return {
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    company: String(formData.get("company") ?? ""),
    address1: String(formData.get("address1") ?? ""),
    address2: String(formData.get("address2") ?? ""),
    city: String(formData.get("city") ?? ""),
    zip: String(formData.get("zip") ?? ""),
    countryCode: String(formData.get("countryCode") ?? "").toUpperCase(),
    zoneCode: String(formData.get("zoneCode") ?? "").toUpperCase() || null,
    phoneNumber: String(formData.get("phoneNumber") ?? ""),
  };
}

function validateAddress(input: CustomerAddressInput): MutationResult | null {
  const fieldErrors: Record<string, string> = {};
  if (!input.firstName?.trim()) fieldErrors.firstName = "First name is required.";
  if (!input.lastName?.trim()) fieldErrors.lastName = "Last name is required.";
  if (!input.address1?.trim()) fieldErrors.address1 = "Address is required.";
  if (!input.city?.trim()) fieldErrors.city = "City is required.";
  if (!input.zip?.trim()) fieldErrors.zip = "ZIP / postal code is required.";
  if (!input.countryCode?.trim() || input.countryCode.length !== 2) {
    fieldErrors.countryCode = "Use a 2-letter country code (e.g. US, PK).";
  }
  if (Object.keys(fieldErrors).length) {
    return { ok: false, message: "Please fix the highlighted fields.", fieldErrors };
  }
  return null;
}

export async function createAddressAction(
  formData: FormData,
): Promise<MutationResult> {
  const input = parseAddress(formData);
  const invalid = validateAddress(input);
  if (invalid) return invalid;

  const defaultAddress = formData.get("defaultAddress") === "on";
  try {
    const result = await createCustomerAddress(input, defaultAddress);
    if (result.ok) revalidatePath("/account/addresses");
    return result.ok
      ? { ok: true, message: "Address added." }
      : result;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Could not add address.",
    };
  }
}

export async function updateAddressAction(
  formData: FormData,
): Promise<MutationResult> {
  const addressId = String(formData.get("addressId") ?? "");
  if (!addressId) return { ok: false, message: "Missing address id." };

  const input = parseAddress(formData);
  const invalid = validateAddress(input);
  if (invalid) return invalid;

  const defaultAddress = formData.get("defaultAddress") === "on";
  try {
    const result = await updateCustomerAddress(
      addressId,
      input,
      defaultAddress,
    );
    if (result.ok) revalidatePath("/account/addresses");
    return result.ok
      ? { ok: true, message: "Address updated." }
      : result;
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not update address.",
    };
  }
}

export async function setDefaultAddressAction(
  addressId: string,
): Promise<MutationResult> {
  if (!addressId) return { ok: false, message: "Missing address id." };
  try {
    const result = await updateCustomerAddress(addressId, {}, true);
    if (result.ok) revalidatePath("/account/addresses");
    return result.ok
      ? { ok: true, message: "Default address updated." }
      : result;
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not set default address.",
    };
  }
}

export async function deleteAddressAction(
  addressId: string,
): Promise<MutationResult> {
  if (!addressId) return { ok: false, message: "Missing address id." };
  try {
    const result = await deleteCustomerAddress(addressId);
    if (result.ok) {
      revalidatePath("/account/addresses");
      revalidatePath("/account");
    }
    return result.ok
      ? { ok: true, message: "Address deleted." }
      : result;
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not delete address.",
    };
  }
}
