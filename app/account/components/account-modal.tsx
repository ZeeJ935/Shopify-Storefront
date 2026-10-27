"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

type AccountModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

export default function AccountModal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: AccountModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("is-scroll-locked");
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel || !focusables?.length) return;
      const list = Array.from(focusables);
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("is-scroll-locked");
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 bg-ink/40"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-xl border border-mist bg-snow p-5 shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6 ${
          wide ? "sm:w-[36rem]" : "sm:w-[28rem]"
        }`}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2
            id={titleId}
            className="font-display text-xl font-semibold text-ink"
          >
            {title}
          </h2>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded text-2xl text-steel hover:bg-mist/60 hover:text-ink"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
