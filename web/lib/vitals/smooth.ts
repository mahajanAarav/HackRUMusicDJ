export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Sliding median (window k, centered, shrinks at the edges). Kills single-sample spikes. */
export function medianFilter(xs: number[], k = 5): number[] {
  const h = k >> 1;
  return xs.map((_, i) => median(xs.slice(Math.max(0, i - h), Math.min(xs.length, i + h + 1)))!);
}

export function ema(xs: number[], alpha = 0.4): number[] {
  const out: number[] = [];
  xs.forEach((x, i) => out.push(i === 0 ? x : alpha * x + (1 - alpha) * out[i - 1]));
  return out;
}

/** Median filter then EMA: the standard cleanup applied to every vitals series. */
export function smooth(xs: number[]): number[] {
  return ema(medianFilter(xs, 5), 0.4);
}

export const clip = (x: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
