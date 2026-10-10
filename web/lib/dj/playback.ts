import { now } from "../clock";
import type { Store } from "../db/store";
import type { QueueItem, SongImpact } from "../types";
import { computeBaseline, computeImpact, BASELINE_WINDOW_S } from "../vitals/impact";
import { syncVitals } from "../vitals/source";

const MIN_PLAY_FOR_IMPACT_MS = 15_000;

/** Finish the playing track (played or skipped), scoring its impact against the pre-song baseline. */
export async function endCurrent(store: Store, code: string, status: "played" | "skipped"): Promise<{ item: QueueItem; impact: SongImpact | null } | null> {
  const room = await store.getRoom(code);
  const cur = (await store.listQueue(code)).find((q) => q.status === "playing");
  if (!room || !cur) return null;
  const endMs = now();
  await syncVitals(store, room, endMs);
  let impact: SongImpact | null = null;
  if (endMs - cur.started_at! >= MIN_PLAY_FOR_IMPACT_MS) {
    const readings = await store.getReadings(code, cur.started_at!);
    impact = computeImpact(readings, cur, endMs);
    await store.addImpact(code, impact);
  }
  const item = await store.updateQueueItem(code, cur.id, { status, ended_at: endMs });
  return { item, impact };
}

/** Finish whatever is playing and start the next queued track, recording its baseline first. */
export async function startNext(store: Store, code: string): Promise<QueueItem | null> {
  const room = await store.getRoom(code);
  if (!room) throw new Error(`Room ${code} not found`);
  await endCurrent(store, code, "played");
  const next = (await store.listQueue(code)).filter((q) => q.status === "queued").sort((a, b) => a.added_at - b.added_at)[0];
  if (!next) return null;
  const startMs = now();
  await syncVitals(store, room, startMs);
  const baseline = computeBaseline(await store.getReadings(code, startMs - BASELINE_WINDOW_S * 1000), startMs);
  return store.updateQueueItem(code, next.id, { status: "playing", started_at: startMs, baseline });
}
