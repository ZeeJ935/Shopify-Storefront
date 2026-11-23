import "server-only";
import { notFound } from "next/navigation";
import { BackendError } from "./backend";
import { staffFetch } from "./session-server";
import type { OrderDetail } from "./types";

/** Order detail by numeric Shopify id; 404 for bad or unknown ids. */
export async function loadOrder(id: string): Promise<OrderDetail> {
  if (!/^\d{1,20}$/.test(id)) notFound();
  try {
    return await staffFetch<OrderDetail>(`/admin/orders/${id}`);
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();
    throw error;
  }
}
