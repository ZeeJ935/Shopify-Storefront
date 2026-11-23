import Link from "next/link";
import { notFound } from "next/navigation";
import { BackendError } from "@/lib/backend";
import { formatDate } from "@/lib/fulfill";
import { staffFetch } from "@/lib/session-server";
import type { FulfillmentAction } from "@/lib/types";

export default async function FulfillmentStatusPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) notFound();
  let action: FulfillmentAction;
  try {
    ({ action } = await staffFetch<{ action: FulfillmentAction }>(`/admin/fulfillments/${encodeURIComponent(key)}`));
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) notFound();
    throw error;
  }
  const done = action.status === "succeeded" || action.status === "failed" || action.status === "dry_run";
  return (
    <>
      <h1>Fulfillment</h1>
      <div className="card">
        <p>
          Status: <strong className={action.status === "failed" ? "error" : undefined}>{action.status}</strong> · attempts {action.attempts}
        </p>
        {action.shopifyFulfillmentId ? <p className="muted">Shopify fulfillment {action.shopifyFulfillmentId}</p> : null}
        {action.lastError ? <p className="error">{action.lastError}</p> : null}
        <p className="muted">
          Created {formatDate(action.createdAt)} · updated {formatDate(action.updatedAt)}
        </p>
        {!done ? (
          <Link className="button" href={`/fulfillments/${encodeURIComponent(key)}`}>
            Refresh
          </Link>
        ) : null}
      </div>
      <p>
        <Link href="/orders">← Orders</Link>
      </p>
    </>
  );
}
