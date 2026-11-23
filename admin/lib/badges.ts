// Pure: maps backend statuses to badge tones and labels (Shopify admin conventions).
import type { Tone } from "@/components/ui/Badge";

type BadgeSpec = { tone: Tone; label: string; dot?: "full" | "partial" | "empty" };

const title = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function paymentBadge(status: string | null): BadgeSpec {
  switch (status) {
    case "PAID":
      return { tone: "neutral", label: "Paid", dot: "full" };
    case "PENDING":
    case "AUTHORIZED":
      return { tone: "warning", label: title(status), dot: "empty" };
    case "PARTIALLY_PAID":
    case "PARTIALLY_REFUNDED":
      return { tone: "warning", label: title(status), dot: "partial" };
    case "REFUNDED":
    case "VOIDED":
      return { tone: "neutral", label: title(status), dot: "empty" };
    case null:
      return { tone: "neutral", label: "—" };
    default:
      return { tone: "neutral", label: title(status) };
  }
}

export function fulfillmentBadge(status: string | null): BadgeSpec {
  switch (status) {
    case "FULFILLED":
      return { tone: "neutral", label: "Fulfilled", dot: "full" };
    case "UNFULFILLED":
      return { tone: "attention", label: "Unfulfilled", dot: "empty" };
    case "PARTIALLY_FULFILLED":
      return { tone: "warning", label: "Partially fulfilled", dot: "partial" };
    case "ON_HOLD":
      return { tone: "warning", label: "On hold", dot: "empty" };
    case "IN_PROGRESS":
      return { tone: "info", label: "In progress", dot: "partial" };
    case null:
      return { tone: "neutral", label: "—" };
    default:
      return { tone: "neutral", label: title(status) };
  }
}

export function fulfillmentOrderBadge(status: string): BadgeSpec {
  if (status === "OPEN") return { tone: "attention", label: "Unfulfilled", dot: "empty" };
  if (status === "IN_PROGRESS") return { tone: "warning", label: "In progress", dot: "partial" };
  if (status === "CLOSED") return { tone: "neutral", label: "Fulfilled", dot: "full" };
  if (status === "ON_HOLD") return { tone: "warning", label: "On hold" };
  if (status === "CANCELLED") return { tone: "critical", label: "Cancelled" };
  return { tone: "neutral", label: title(status) };
}

export function actionBadge(status: string): BadgeSpec {
  if (status === "succeeded") return { tone: "success", label: "Succeeded" };
  if (status === "failed") return { tone: "critical", label: "Failed" };
  if (status === "dry_run") return { tone: "info", label: "Dry run" };
  return { tone: "attention", label: status === "submitting" ? "Submitting" : "Pending" };
}

export function auditBadge(result: string): BadgeSpec {
  if (result === "success") return { tone: "success", label: "Success" };
  if (result === "denied") return { tone: "critical", label: "Denied" };
  if (result === "rejected") return { tone: "warning", label: "Rejected" };
  if (result === "error") return { tone: "critical", label: "Error" };
  return { tone: "attention", label: "Pending" };
}

/** Matches the backend's LOW_STOCK_AT (5). */
export const LOW_STOCK_AT = 5;
export function stockBadge(available: number): BadgeSpec {
  if (available <= 0) return { tone: "critical", label: "Out of stock" };
  if (available <= LOW_STOCK_AT) return { tone: "attention", label: "Low stock" };
  return { tone: "success", label: "In stock" };
}

export const roleLabel = (role: string) => title(role);
