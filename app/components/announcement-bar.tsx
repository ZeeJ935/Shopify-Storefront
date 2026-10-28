"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { AnnouncementMessage } from "@/lib/site-content";
import SiteContainer from "./site-container";

type AnnouncementBarProps = {
  messages: AnnouncementMessage[];
};

const INTERVAL_MS = 5000;

export default function AnnouncementBar({ messages }: AnnouncementBarProps) {
  const labelId = useId();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (messages.length <= 1 || paused || reducedMotion) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % messages.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [messages.length, paused, reducedMotion]);

  if (messages.length === 0) return null;

  const current = messages[index] ?? messages[0];
  const content = current.text;

  return (
    <div
      ref={regionRef}
      className="bg-ink text-snow"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!regionRef.current?.contains(e.relatedTarget as Node)) {
          setPaused(false);
        }
      }}
    >
      <SiteContainer className="flex items-center gap-2 py-2">
        {messages.length > 1 && (
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-mist hover:text-snow"
            aria-label="Previous announcement"
            onClick={() =>
              setIndex((i) => (i - 1 + messages.length) % messages.length)
            }
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}

        <div
          className="min-w-0 flex-1 text-center text-xs font-medium tracking-wide sm:text-sm"
          aria-live="polite"
          aria-atomic="true"
          id={labelId}
        >
          {current.href ? (
            <Link
              href={current.href}
              className="inline-block max-w-full truncate hover:underline"
            >
              {content}
            </Link>
          ) : (
            <p className="truncate">{content}</p>
          )}
        </div>

        {messages.length > 1 && (
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-mist hover:text-snow"
            aria-label="Next announcement"
            onClick={() => setIndex((i) => (i + 1) % messages.length)}
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
      </SiteContainer>
    </div>
  );
}
