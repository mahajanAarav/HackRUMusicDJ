import type { Metric, RoomEnergy, Triple, VitalsReading } from "../types";
import { clip, mean, median, smooth } from "./smooth";

export const MIN_CONFIDENCE = 0.5;
const WEBCAM_MIN_CONFIDENCE = 0.2;

/** Presage reports 0..1 quality (use >= 0.5). The browser camera reader's peak-dominance score runs lower and is already gated at 0.2 client-side. */
export const isUsable = (r: Pick<VitalsReading, "confidence" | "source">) => r.confidence >= (r.source === "webcam" ? WEBCAM_MIN_CONFIDENCE : MIN_CONFIDENCE);

const pick = (r: VitalsReading, m: Metric): number | null =>
  m === "pulse" ? r.pulse_bpm : m === "breathing" ? r.breathing_rpm : (r.expression?.valence ?? null);

const perGuestSeries = (readings: VitalsReading[], metric: Metric, fromMs: number, toMs: number) => {
  const by = new Map<string, { t: number; v: number }[]>();
  for (const r of readings) {
    const t = Date.parse(r.timestamp);
    const v = pick(r, metric);
    if (v == null || !isUsable(r) || t < fromMs || t > toMs) continue;
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
 * Signed arousal change, -1..1. Rising pulse and breathing push it up, falling pushes it down.
 * It is deliberately goal-free: whether "up" or "down" was the right move depends on what the
 * guests asked for, which the DJ (Gemini) judges from their inputs.
 */
export function arousalChange(d: { pulse: number | null; breathing: number | null }): number | null {
  if (d.pulse == null && d.breathing == null) return null;
  const wp = d.pulse == null ? 0 : 0.7, wb = d.breathing == null ? 0 : 0.3;
  return clip(((wp * (d.pulse ?? 0)) / 10 + (wb * (d.breathing ?? 0)) / 3) / (wp + wb));
}

function trendOf(readings: VitalsReading[], fromMs: number, toMs: number): RoomEnergy["trend"] {
  for (const [metric, thresh] of [["pulse", 2], ["breathing", 0.8]] as [Metric, number][]) {
    const slopes: number[] = [];
    for (const s of perGuestSeries(readings, metric, fromMs, toMs).values()) {
      if (s.length < 6) continue;
      const sm = smooth(s.map((p) => p.v));
      const n = Math.floor(sm.length / 3);
      slopes.push(mean(sm.slice(-n))! - mean(sm.slice(0, n))!);
    }
    const m = median(slopes);
    if (m != null) return m > thresh ? "rising" : m < -thresh ? "falling" : "flat";
  }
  return "unknown";
}

export function computeRoomEnergy(
  readings: VitalsReading[],
  opts: { nowMs: number; windowS?: number; baseline: Triple | null },
): RoomEnergy {
  const windowS = opts.windowS ?? 30;
  const from = opts.nowMs - windowS * 1000;
  const cur = aggregateTriple(readings, from, opts.nowMs, "last");
  const base = opts.baseline ?? cur.triple;
  const delta = { pulse: diff(cur.triple.pulse, base.pulse), breathing: diff(cur.triple.breathing, base.breathing) };
  const round = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
  return {
    arousal_change: round2(arousalChange(delta)),
    pulse: { baseline: round(base.pulse), current: round(cur.triple.pulse), delta: round(delta.pulse) },
    breathing: { baseline: round(base.breathing), current: round(cur.triple.breathing), delta: round(delta.breathing) },
    valence: { current: cur.triple.valence == null ? null : Math.round(cur.triple.valence * 100) / 100 },
    trend: trendOf(readings, from, opts.nowMs),
    n_guests_sensing: cur.guests,
    window_s: windowS,
  };
}

const round2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
