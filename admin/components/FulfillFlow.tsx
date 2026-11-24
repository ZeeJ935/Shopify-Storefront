"use client";
import { useActionState, useState } from "react";
import { fulfillAction, type FulfillState } from "@/app/actions";
import { actionBadge } from "@/lib/badges";
import { Badge } from "./ui/Badge";
import { Banner } from "./ui/Banner";
import { Button, LinkButton } from "./ui/Button";
import { Card, CardSection } from "./ui/Card";
import { Field, inputBase, inputClass } from "./ui/Field";
import { CheckIcon } from "./ui/Icons";
import { cx } from "./ui/cx";

type Line = { id: string; title: string; sku: string | null; remaining: number };
const STEPS = ["Items", "Review", "Done"] as const;

function Steps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2 text-xs font-medium" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span
            className={cx(
              "grid size-5 place-items-center rounded-full",
              i < current && "bg-primary text-on-primary",
              i === current && "bg-primary text-on-primary ring-2 ring-primary/20",
              i > current && "bg-surface-selected text-subdued",
            )}
          >
            {i < current ? <CheckIcon className="size-3" /> : i + 1}
          </span>
          <span className={i === current ? "text-fg" : "text-subdued"}>{s}</span>
          {i < STEPS.length - 1 ? <span className="h-px w-6 bg-line-strong" /> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Items → dry run → confirm exactly what will be sent. The confirm form carries a sealed
 * ticket (idempotency key + body) created once per confirm screen, so double clicks or
 * resubmits can't fulfill twice.
 */
export function FulfillFlow({ orderId, orderName, foId, lines }: { orderId: string; orderName: string; foId: string; lines: Line[] }) {
  const [state, action, pending] = useActionState<FulfillState, FormData>(fulfillAction, { step: "form" });
  const [notify, setNotify] = useState(false);
  const titles = new Map(lines.map((l) => [l.id, l]));

  if (state.step === "done") {
    const b = actionBadge(state.action.status);
    return (
      <div className="flex flex-col gap-4">
        <Steps current={2} />
        <Banner tone="success" title={state.replayed ? "Already submitted" : "Fulfillment submitted"}>
          {state.replayed ? "This confirmation was used before; nothing was sent twice." : "Shopify is creating the fulfillment. It usually takes a few seconds."}
        </Banner>
        <Card>
          <p className="flex items-center gap-2">
            Status <Badge tone={b.tone}>{b.label}</Badge>
          </p>
          <div className="mt-3 flex gap-2">
            <LinkButton variant="primary" href={`/fulfillments/${encodeURIComponent(state.action.key)}`}>
              Track progress
            </LinkButton>
            <LinkButton href={`/orders/${orderId}`}>Back to {orderName}</LinkButton>
          </div>
        </Card>
      </div>
    );
  }

  if (state.step === "confirm") {
    const send = state.wouldSend.lineItemsByFulfillmentOrder[0];
    const tracking = state.wouldSend.trackingInfo;
    return (
      <div className="flex flex-col gap-4">
        <Steps current={1} />
        {state.notify ? (
          <Banner tone="critical" title="The customer will be emailed">
            Shopify will send a shipping notification to the customer when you confirm.
          </Banner>
        ) : (
          <Banner tone="info" title="The customer won't be notified" />
        )}
        <Card title="Review fulfillment" padded={false}>
          <ul>
            {(send?.fulfillmentOrderLineItems ?? []).map((l) => (
              <li key={l.id} className="flex justify-between gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{titles.get(l.id)?.title ?? "Item"}</span>
                  <span className="text-xs text-subdued">SKU: {titles.get(l.id)?.sku ?? "—"}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">× {l.quantity}</span>
              </li>
            ))}
          </ul>
          <CardSection title="Tracking">
            {tracking ? (
              <p>
                {[tracking.company, tracking.number].filter(Boolean).join(" · ") || "—"}
                {tracking.url ? <span className="block break-all text-subdued">{tracking.url}</span> : null}
              </p>
            ) : (
              <p className="text-subdued">No tracking</p>
            )}
          </CardSection>
          <CardSection subdued>
            <details>
              <summary className="cursor-pointer text-subdued">Show exactly what will be sent to Shopify</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs">{JSON.stringify(state.wouldSend, null, 2)}</pre>
            </details>
          </CardSection>
        </Card>
        <form action={action} className="flex justify-end gap-2">
          <input type="hidden" name="ticket" value={state.ticket} />
          <Button type="submit" name="intent" value="back" disabled={pending}>
            Back
          </Button>
          <Button type="submit" name="intent" value="confirm" variant="primary" disabled={pending}>
            {pending ? "Fulfilling…" : "Confirm and fulfill"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Steps current={0} />
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="fo_id" value={foId} />
      {state.error ? <Banner tone="critical" title="Couldn't continue">{state.error}</Banner> : null}
      <Card title="Items to fulfill" padded={false}>
        <ul>
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 first:border-t-0">
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.title}</span>
                <span className="text-xs text-subdued">SKU: {l.sku ?? "—"}</span>
              </span>
              <label className="flex shrink-0 items-center gap-2">
                <span className="sr-only">Quantity for {l.title}</span>
                <input type="number" name={`qty:${l.id}`} min={0} max={l.remaining} defaultValue={l.remaining} className={`${inputBase} w-20 text-right`} />
                <span className="text-subdued tabular-nums">of {l.remaining}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Tracking information">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shipping carrier">
            <input name="tracking_company" placeholder="e.g. UPS" maxLength={100} className={inputClass} />
          </Field>
          <Field label="Tracking number">
            <input name="tracking_number" maxLength={100} className={inputClass} />
          </Field>
          <Field label="Tracking URL" hint="Optional. Needs a tracking number." className="sm:col-span-2">
            <input name="tracking_url" type="url" placeholder="https://" maxLength={500} className={inputClass} />
          </Field>
        </div>
      </Card>
      <Card title="Notification">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="notify_customer" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">Send shipment details to the customer now</span>
            <span className="block text-subdued">Off by default.</span>
          </span>
        </label>
        {notify ? (
          <div className="mt-3">
            <Banner tone="critical" title="The customer will be emailed">
              Shopify sends a real shipping notification. Leave this off for test orders.
            </Banner>
          </div>
        ) : null}
      </Card>
      <div className="flex justify-end gap-2">
        <LinkButton href={`/orders/${orderId}`}>Cancel</LinkButton>
        <Button type="submit" name="intent" value="preview" variant="primary" disabled={pending}>
          {pending ? "Checking…" : "Review fulfillment"}
        </Button>
      </div>
    </form>
  );
}
