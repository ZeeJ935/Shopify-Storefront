"use client";

import type { CustomerAddress } from "@/lib/customer-account/api";

type AddressCardProps = {
  address: CustomerAddress;
  onEdit: (address: CustomerAddress) => void;
  onDelete: (address: CustomerAddress) => void;
  onSetDefault: (address: CustomerAddress) => void;
  busy?: boolean;
};

export default function AddressCard({
  address,
  onEdit,
  onDelete,
  onSetDefault,
  busy = false,
}: AddressCardProps) {
  const name =
    [address.firstName, address.lastName].filter(Boolean).join(" ") ||
    "Address";

  return (
    <article className="flex h-full flex-col rounded-xl border border-mist bg-snow p-5 shadow-sm transition hover:border-steel/40">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
          {name}
        </h3>
        {address.isDefault ? (
          <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
            Default
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex-1 space-y-1 text-sm text-steel">
        {address.company ? <p>{address.company}</p> : null}
        {address.formatted.map((line) => (
          <p key={line}>{line}</p>
        ))}
        {address.phoneNumber ? <p>{address.phoneNumber}</p> : null}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary !min-h-10 !px-3 !py-2 text-sm"
          onClick={() => onEdit(address)}
          disabled={busy}
        >
          Edit
        </button>
        {!address.isDefault ? (
          <button
            type="button"
            className="btn btn-secondary !min-h-10 !px-3 !py-2 text-sm"
            onClick={() => onSetDefault(address)}
            disabled={busy}
          >
            Set as default
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary !min-h-10 !px-3 !py-2 text-sm text-danger"
          onClick={() => onDelete(address)}
          disabled={busy}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
