import { formatMoney } from "@/lib/money";

type Money = { amount: string; currencyCode: string } | null;

type PriceSummaryProps = {
  subtotal: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  className?: string;
};

function Row({
  label,
  money,
  strong,
}: {
  label: string;
  money: Money;
  strong?: boolean;
}) {
  if (!money) return null;
  return (
    <div
      className={`flex justify-between gap-4 ${strong ? "border-t border-mist pt-3 font-semibold text-ink" : "text-sm text-steel"}`}
    >
      <span className={strong ? "text-ink" : undefined}>{label}</span>
      <span className={strong ? "text-ink" : "text-ink"}>
        {formatMoney(money.amount, money.currencyCode)}
      </span>
    </div>
  );
}

export default function PriceSummary({
  subtotal,
  shipping,
  tax,
  total,
  className = "",
}: PriceSummaryProps) {
  return (
    <div className={`space-y-3 ${className}`.trim()}>
      <Row label="Subtotal" money={subtotal} />
      <Row label="Shipping" money={shipping} />
      <Row label="Tax" money={tax} />
      <Row label="Total" money={total} strong />
    </div>
  );
}
