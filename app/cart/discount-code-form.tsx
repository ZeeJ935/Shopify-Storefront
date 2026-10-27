"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import PendingButtonLabel from "@/app/components/pending-button-label";
import Spinner from "@/app/components/spinner";
import { useDelayedPending } from "@/app/hooks/use-delayed-pending";
import { applyDiscountCode, removeDiscountCode } from "./actions";

type DiscountCode = {
  code: string;
  applicable: boolean;
};

type DiscountCodeFormProps = {
  discountCodes: DiscountCode[];
  onPendingChange?: (pending: boolean) => void;
};

export default function DiscountCodeForm({
  discountCodes,
  onPendingChange,
}: DiscountCodeFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removingCode, setRemovingCode] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const showPending = useDelayedPending(isPending);
  const onPendingChangeRef = useRef(onPendingChange);

  const applicableCodes = discountCodes.filter((item) => item.applicable);

  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(() => {
    onPendingChangeRef.current?.(isPending);
    return () => {
      onPendingChangeRef.current?.(false);
    };
  }, [isPending]);

  function handleApply() {
    const next = value.trim();
    if (!next || isPending) {
      return;
    }

    setRemovingCode(null);
    startTransition(async () => {
      const result = await applyDiscountCode(next);
      if (result.ok) {
        setValue("");
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }

  function handleRemove(code: string) {
    if (isPending) {
      return;
    }

    setRemovingCode(code);
    startTransition(async () => {
      const result = await removeDiscountCode(code);
      if (!result.ok) {
        setError(result.error);
      } else {
        setError(null);
      }
      setRemovingCode(null);
    });
  }

  return (
    <div className="mt-6 space-y-3 border-t border-mist pt-6">
      <label
        htmlFor="discount-code"
        className="block text-xs font-semibold uppercase tracking-[0.12em] text-ink"
      >
        Promo code
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <input
          id="discount-code"
          type="text"
          value={value}
          disabled={isPending}
          autoComplete="off"
          spellCheck={false}
          maxLength={50}
          placeholder="Enter code"
          onChange={(event) => {
            setValue(event.target.value);
            if (error) {
              setError(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleApply();
            }
          }}
          className="field min-h-11 w-full flex-1 rounded-none bg-snow px-3 text-sm"
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={isPending || value.trim().length === 0}
          aria-busy={isPending && removingCode === null}
          className="btn btn-secondary min-h-11 min-w-[7.5rem] shrink-0 rounded-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PendingButtonLabel
            pending={showPending && removingCode === null}
            idleLabel="Apply"
            pendingLabel="Applying…"
          />
        </button>
      </div>

      <p className="min-h-5 text-sm text-danger" role="status" aria-live="polite">
        {error ?? ""}
      </p>

      {applicableCodes.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {applicableCodes.map((item) => {
            const chipPending =
              showPending && removingCode?.toLowerCase() === item.code.toLowerCase();

            return (
              <li key={item.code}>
                <button
                  type="button"
                  onClick={() => handleRemove(item.code)}
                  disabled={isPending}
                  aria-busy={chipPending}
                  aria-label={`Remove discount code ${item.code}`}
                  className="inline-flex min-h-11 items-center gap-2 border border-mist bg-snow px-3 text-sm font-medium uppercase tracking-wide text-ink hover:border-steel disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{item.code}</span>
                  {chipPending ? (
                    <Spinner size="sm" className="text-steel" />
                  ) : (
                    <span aria-hidden="true" className="text-steel">
                      ×
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
