import type { QueueItem, SongImpact, Triple, VitalsReading } from "../types";
import { aggregateTriple, arousalChange, diff } from "./energy";

export const BASELINE_WINDOW_S = 30;
export const SETTLE_S = 10; // ignore the first seconds of a song while vitals respond
export const MIN_IMPACT_SAMPLES = 3;

/** Median of the BASELINE_WINDOW_S before a song starts. */
export function computeBaseline(readings: VitalsReading[], startMs: number): Triple {
  return aggregateTriple(readings, startMs - BASELINE_WINDOW_S * 1000, startMs, "mean").triple;
}

/** Smoothed in-song average vs the pre-song baseline, reduced to a signed arousal change. */
export function computeImpact(
  readings: VitalsReading[],
  item: Pick<QueueItem, "id" | "song" | "artist" | "baseline" | "started_at">,
  endMs: number,
): SongImpact {
  const start = item.started_at!;
  const { triple: during, samples } = aggregateTriple(readings, start + SETTLE_S * 1000, endMs, "mean");
  const baseline: Triple = item.baseline ?? { pulse: null, breathing: null, valence: null };
  const delta: Triple = {
    pulse: diff(during.pulse, baseline.pulse),
    breathing: diff(during.breathing, baseline.breathing),
    valence: during.valence, // valence is already signed; no baseline needed
  };
  const score = samples >= MIN_IMPACT_SAMPLES ? arousalChange(delta) : null;
  return {
    queue_id: item.id,
    song: item.song,
    artist: item.artist,
    baseline,
    during,
    delta,
    score: score == null ? null : Math.round(score * 100) / 100,
    n_samples: samples,
  };
}
