import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Page } from "@/components/ui/Page";
import { BackendError } from "@/lib/backend";
import { actionBadge } from "@/lib/badges";
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
  const badge = actionBadge(action.status);
  const done = action.status === "succeeded" || action.status === "failed" || action.status === "dry_run";
  return (
    <Page
      title="Fulfillment request"
      backHref="/orders"
      narrow
      titleMeta={<Badge tone={badge.tone}>{badge.label}</Badge>}
      actions={!done ? <LinkButton href={`/fulfillments/${encodeURIComponent(key)}`}>Refresh</LinkButton> : null}
    >
      {action.status === "succeeded" ? <Banner tone="success" title="Fulfilled in Shopify" /> : null}
      {action.status === "failed" ? (
        <Banner tone="critical" title="This fulfillment failed">
          {action.lastError}
        </Banner>
      ) : null}
      {!done ? <Banner tone="info" title="Working on it">Shopify is processing the request. Refresh in a few seconds.</Banner> : null}
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-subdued">Attempts</dt>
          <dd>{action.attempts}</dd>
          <dt className="text-subdued">Shopify fulfillment</dt>
          <dd className="break-all">{action.shopifyFulfillmentId ?? "—"}</dd>
          <dt className="text-subdued">Requested</dt>
          <dd>{formatDate(action.createdAt)}</dd>
          <dt className="text-subdued">Last update</dt>
          <dd>{formatDate(action.updatedAt)}</dd>
          <dt className="text-subdued">Reference</dt>
          <dd className="font-mono text-xs break-all">{action.key}</dd>
        </dl>
      </Card>
    </Page>
  );
}
