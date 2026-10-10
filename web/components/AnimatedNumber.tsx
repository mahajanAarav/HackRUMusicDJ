"use client";
import { useEffect, useRef, useState } from "react";

/** Tweens to the new value so changing vitals glide instead of jump. */
export function AnimatedNumber({ value, decimals = 0, fallback = "–" }: { value: number | null | undefined; decimals?: number; fallback?: string }) {
  const [shown, setShown] = useState<number | null>(value ?? null);
  const from = useRef<number | null>(value ?? null);
  useEffect(() => {
    if (value == null) { setShown(null); from.current = null; return; }
    const start = from.current ?? value;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      const v = start + (value - start) * (1 - Math.pow(1 - p, 3));
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown == null ? fallback : shown.toFixed(decimals)}</>;
}
