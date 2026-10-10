import type { Metric, Mode, RoomEnergy, Triple, VitalsReading } from "../types";
import { clip, mean, median, smooth } from "./smooth";

export const MIN_CONFIDENCE = 0.5;

const pick = (r: VitalsReading, m: Metric): number | null =>
  m === "pulse" ? r.pulse_bpm : m === "breathing" ? r.breathing_rpm : (r.expression?.valence ?? null);

const perGuestSeries = (readings: VitalsReading[], metric: Metric, fromMs: number, toMs: number) => {
  const by = new Map<string, { t: number; v: number }[]>();
  for (const r of readings) {
    const t = Date.parse(r.timestamp);
    const v = pick(r, metric);
    if (v == null || r.confidence < MIN_CONFIDENCE || t < fromMs || t > toMs) continue;
    (by.get(r.guest_id) ?? by.set(r.guest_id, []).get(r.guest_id)!).push({ t, v });
  }
  for (const s of by.values()) s.sort((a, b) => a.t - b.t);
  return by;
};

/** Room-level value of a metric: smooth each guest's series, reduce it, take the median across guests. */
export function aggregate(
  readings: VitalsReading[],
  metric: Metric,
  fromMs: number,
  toMs: number,
  reduce: "mean" | "last" = "mean",
): { value: number | null; guests: number; samples: number } {
  const vals: number[] = [];
  let samples = 0;
  for (const s of perGuestSeries(readings, metric, fromMs, toMs).values()) {
    const sm = smooth(s.map((p) => p.v));
    samples += sm.length;
    vals.push(reduce === "last" ? sm[sm.length - 1] : mean(sm)!);
  }
  return { value: median(vals), guests: vals.length, samples };
}

export function aggregateTriple(readings: VitalsReading[], fromMs: number, toMs: number, reduce: "mean" | "last" = "mean") {
  const p = aggregate(readings, "pulse", fromMs, toMs, reduce);
  const b = aggregate(readings, "breathing", fromMs, toMs, reduce);
  const v = aggregate(readings, "valence", fromMs, toMs, reduce);
  return {
    triple: { pulse: p.value, breathing: b.value, valence: v.value } as Triple,
    guests: Math.max(p.guests, b.guests, v.guests),
    samples: Math.max(p.samples, b.samples, v.samples),
  };
}

export const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);

/**
 * Progress toward the mode's goal, in -1..1 (positive = good).
 *  hype:     rising pulse + positive expression
 *  winddown: falling breathing rate and pulse
 */
export function modeScore(mode: Mode, d: { pulse: number | null; breathing: number | null }, valence: number | null): number | null {
  if (mode === "hype") {
    if (d.pulse == null && valence == null) return null;
    return clip(0.6 * ((d.pulse ?? 0) / 10) + 0.4 * (valence ?? 0));
  }
  if (d.breathing == null && d.pulse == null) return null;
  return clip(0.6 * (-(d.breathing ?? 0) / 4) + 0.4 * (-(d.pulse ?? 0) / 10));
}

function trendOf(readings: VitalsReading[], mode: Mode, fromMs: number, toMs: number): RoomEnergy["trend"] {
  const metric: Metric = mode === "hype" ? "pulse" : "breathing";
  const thresh = mode === "hype" ? 2 : 0.8;
  const slopes: number[] = [];
  for (const s of perGuestSeries(readings, metric, fromMs, toMs).values()) {
    if (s.length < 6) continue;
    const sm = smooth(s.map((p) => p.v));
    const n = Math.floor(sm.length / 3);
    slopes.push(mean(sm.slice(-n))! - mean(sm.slice(0, n))!);
  }
  const m = median(slopes);
  if (m == null) return "unknown";
  return m > thresh ? "rising" : m < -thresh ? "falling" : "flat";
}

export function computeRoomEnergy(
  readings: VitalsReading[],
  opts: { mode: Mode; nowMs: number; windowS?: number; baseline: Triple | null },
): RoomEnergy {
  const windowS = opts.windowS ?? 30;
  const from = opts.nowMs - windowS * 1000;
  const cur = aggregateTriple(readings, from, opts.nowMs, "last");
  const base = opts.baseline ?? cur.triple;
  const delta = { pulse: diff(cur.triple.pulse, base.pulse), breathing: diff(cur.triple.breathing, base.breathing) };
  const round = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
  return {
    mode: opts.mode,
    score: round2(modeScore(opts.mode, delta, cur.triple.valence)),
    pulse: { baseline: round(base.pulse), current: round(cur.triple.pulse), delta: round(delta.pulse) },
    breathing: { baseline: round(base.breathing), current: round(cur.triple.breathing), delta: round(delta.breathing) },
    valence: { current: cur.triple.valence == null ? null : Math.round(cur.triple.valence * 100) / 100 },
    trend: trendOf(readings, opts.mode, from, opts.nowMs),
    n_guests_sensing: cur.guests,
    window_s: windowS,
  };
}

const round2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
