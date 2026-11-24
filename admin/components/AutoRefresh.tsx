"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the page every `ms` while `active` (e.g. until a push is done). */
export function AutoRefresh({ active, ms = 3000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}
