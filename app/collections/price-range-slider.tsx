"use client";

import { useId, useRef, useState } from "react";

type PriceRangeSliderProps = {
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  onCommit: (min: number, max: number) => void;
};

/** Remount with key={`${valueMin}-${valueMax}`} when URL bounds change. */
export default function PriceRangeSlider({
  min,
  max,
  valueMin,
  valueMax,
  onCommit,
}: PriceRangeSliderProps) {
  const id = useId();
  const [lo, setLo] = useState(valueMin);
  const [hi, setHi] = useState(valueMax);
  const debounceRef = useRef<number | null>(null);

  function scheduleCommit(nextLo: number, nextHi: number) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      onCommit(nextLo, nextHi);
    }, 250);
  }

  if (max <= min) return null;

  const range = max - min || 1;
  const leftPct = ((lo - min) / range) * 100;
  const rightPct = ((hi - min) / range) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="sr-only">Minimum price</span>$
          <input
            type="number"
            className="field min-h-9 w-20 py-1 text-sm"
            min={min}
            max={hi}
            value={lo}
            onChange={(e) => {
              const v = Math.min(
                hi,
                Math.max(min, Number(e.target.value) || min),
              );
              setLo(v);
              scheduleCommit(v, hi);
            }}
          />
        </label>
        <span className="text-steel">–</span>
        <label className="flex items-center gap-1">
          <span className="sr-only">Maximum price</span>$
          <input
            type="number"
            className="field min-h-9 w-20 py-1 text-sm"
            min={lo}
            max={max}
            value={hi}
            onChange={(e) => {
              const v = Math.max(
                lo,
                Math.min(max, Number(e.target.value) || max),
              );
              setHi(v);
              scheduleCommit(lo, v);
            }}
          />
        </label>
      </div>

      <div className="relative h-11">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded bg-mist" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-ink"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        <input
          id={`${id}-min`}
          type="range"
          min={min}
          max={max}
          value={lo}
          aria-label="Minimum price"
          className="pointer-events-none absolute inset-0 m-0 h-11 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink"
          style={{ zIndex: lo > max - (hi - lo) ? 5 : 3 }}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), hi);
            setLo(v);
            scheduleCommit(v, hi);
          }}
        />
        <input
          id={`${id}-max`}
          type="range"
          min={min}
          max={max}
          value={hi}
          aria-label="Maximum price"
          className="pointer-events-none absolute inset-0 m-0 h-11 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink"
          style={{ zIndex: 4 }}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), lo);
            setHi(v);
            scheduleCommit(lo, v);
          }}
        />
      </div>
    </div>
  );
}
