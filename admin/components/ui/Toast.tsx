"use client";
import { useEffect, useState } from "react";
import { CheckIcon } from "./Icons";

/** Short confirmation at the bottom of the screen; hides itself after 4 s. `id` re-shows it. */
export function Toast({ message, id }: { message: string; id: string | number }) {
  const [visible, setVisible] = useState(true);
  const [shownFor, setShownFor] = useState(id);
  if (shownFor !== id) {
    setShownFor(id);
    setVisible(true);
  }
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, [id]);
  if (!visible) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-[#1a1a1a] px-4 py-2.5 text-sm text-white shadow-lg">
      <CheckIcon className="size-4" />
      {message}
    </div>
  );
}
