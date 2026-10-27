function titleCaseStatus(value: string) {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function badgeClasses(status: string) {
  const key = status.toUpperCase().replace(/\s+/g, "_");
  switch (key) {
    case "PAID":
    case "PARTIALLY_PAID":
      return "bg-success/10 text-success";
    case "FULFILLED":
      return "bg-[color-mix(in_srgb,var(--focus)_12%,white)] text-[color:var(--focus)]";
    case "UNFULFILLED":
    case "PARTIALLY_FULFILLED":
    case "IN_PROGRESS":
    case "PENDING":
      return "bg-amber-100 text-amber-800";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "bg-mist text-steel";
    case "CANCELLED":
    case "VOIDED":
      return "bg-danger/10 text-danger";
    default:
      return "bg-mist text-steel";
  }
}

type StatusBadgeProps = {
  status: string | null | undefined;
  className?: string;
};

export default function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  if (!status) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${badgeClasses(status)} ${className}`.trim()}
    >
      {titleCaseStatus(status)}
    </span>
  );
}
