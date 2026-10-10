"use client";
import { useId } from "react";

export function Sparkline({ values, width = 300, height = 64 }: { values: number[]; width?: number; height?: number }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return <div className="spark-empty" style={{ height }}>Waiting for readings…</div>;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(4, max - min);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 6 - ((v - min) / span) * (height - 14)] as const);
  // Catmull-Rom-ish smoothing via midpoints
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    d += ` Q${x0},${y0} ${(x0 + x1) / 2},${(y0 + y1) / 2}`;
  }
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" className="spark">
      <defs>
        <linearGradient id={`s${id}`} x1="0" x2="1"><stop offset="0" stopColor="var(--acc2)" /><stop offset="1" stopColor="var(--acc)" /></linearGradient>
        <linearGradient id={`f${id}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--acc)" stopOpacity=".35" /><stop offset="1" stopColor="var(--acc)" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={`${d} L${last[0]},${height} L0,${height} Z`} fill={`url(#f${id})`} />
      <path d={d} fill="none" stroke={`url(#s${id})`} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="var(--acc)" className="spark-dot" />
    </svg>
  );
}
