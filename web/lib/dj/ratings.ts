import type { QueueItem, Rating } from "../types";

export interface RatingSummary {
  avg: number;
  n: number;
}

/** Average 1-5 rating and count per song. Individual guests' ratings are never exposed. */
export function summarizeRatings(ratings: Rating[]): Record<string, RatingSummary> {
  const by = new Map<string, number[]>();
  for (const r of ratings) (by.get(r.queue_id) ?? by.set(r.queue_id, []).get(r.queue_id)!).push(r.value);
  const out: Record<string, RatingSummary> = {};
  for (const [id, vs] of by) out[id] = { avg: Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 10) / 10, n: vs.length };
  return out;
}

/** One line per rated song, for the DJ's prompt: what the room said about how well each pick matched the vibe. */
export function ratingsForPrompt(queue: QueueItem[], ratings: Rating[]): string[] {
  const sum = summarizeRatings(ratings);
  return queue
    .filter((q) => sum[q.id])
    .slice(-12)
    .map((q) => `${q.song} - ${q.artist}: ${sum[q.id].avg}/5 from ${sum[q.id].n} guest${sum[q.id].n > 1 ? "s" : ""}${q.artist_basis ? ` (${q.artist_basis})` : ""}`);
}
