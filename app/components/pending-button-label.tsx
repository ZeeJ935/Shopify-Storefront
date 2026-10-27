import Spinner from "./spinner";

type PendingButtonLabelProps = {
  pending: boolean;
  idleLabel: string;
  pendingLabel: string;
  className?: string;
};

export default function PendingButtonLabel({
  pending,
  idleLabel,
  pendingLabel,
  className = "",
}: PendingButtonLabelProps) {
  return (
    <span
      className={`inline-flex min-w-[7.5rem] items-center justify-center gap-2 ${className}`.trim()}
    >
      {pending ? (
        <>
          <Spinner size="sm" />
          <span>{pendingLabel}</span>
        </>
      ) : (
        <span>{idleLabel}</span>
      )}
    </span>
  );
}
