import type { QueueItem } from "../types";

/** "Levels (Original Mix) - Remastered" and "levels" are the same song. */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(feat|ft)\b\.?.*$/, " ")
    .replace(/\s-\s.*$/, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Primary artist only: "David Guetta ft. Sia" and "David Guetta" match. */
export function normArtist(s: string): string {
  return s
    .toLowerCase()
    .split(/,|&|\bfeat\b|\bft\b|\bx\b|\band\b|\bwith\b/)[0]
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const ARTIST_COOLDOWN = 4; // an artist can't appear again within this many tracks

/** Why `candidate` must not be queued, or null if it is fine. Considers everything ever queued in the room. */
export function repeatReason(candidate: { song: string; artist: string; video_id?: string }, queue: QueueItem[]): string | null {
  const t = normTitle(candidate.song);
  const a = normArtist(candidate.artist);
  for (const q of queue) {
    if (candidate.video_id && q.video_id === candidate.video_id) return `"${q.song}" by ${q.artist} was already used tonight. Pick a different song.`;
    if (normTitle(q.song) === t && normArtist(q.artist) === a) return `"${q.song}" by ${q.artist} was already used tonight. Pick a different song.`;
  }
  const recent = [...queue].sort((x, y) => x.added_at - y.added_at).slice(-ARTIST_COOLDOWN);
  if (recent.some((q) => normArtist(q.artist) === a)) return `${candidate.artist} was used in the last ${ARTIST_COOLDOWN} tracks. Pick a different artist.`;
  return null;
}

/** Compact list for prompts so the model avoids repeats before the server has to reject them. */
export function usedList(queue: QueueItem[], max = 60): string[] {
  return queue.slice(-max).map((q) => `${q.song} - ${q.artist}`);
}
