import { now } from "../clock";
import type { Store } from "../db/store";
import type { Room, RoomEnergy, Triple } from "../types";
import { computeRoomEnergy, aggregateTriple } from "./energy";
import { syncSimulated } from "./simulated";

/**
 * Make sure the store holds readings up to `nowMs`.
 *  simulated: generate them. live: the iOS app POSTs them, nothing to do.
 * Every consumer (API, Gemini tools, host UI) goes through this, so swapping Presage in for the
 * simulator is just flipping room.vitals_source.
 */
export async function syncVitals(store: Store, room: Room, nowMs = now()) {
  if (room.vitals_source === "simulated") await syncSimulated(store, room, nowMs);
}

/** The current song's pre-roll baseline, or (between songs) the room's recent past. */
export async function currentBaseline(store: Store, room: Room, nowMs = now()): Promise<Triple | null> {
  const playing = (await store.listQueue(room.code)).find((q) => q.status === "playing");
  if (playing?.baseline) return playing.baseline;
  const readings = await store.getReadings(room.code, nowMs - 120_000);
  const older = aggregateTriple(readings, nowMs - 120_000, nowMs - 30_000, "mean");
  return older.samples >= 3 ? older.triple : null;
}

export async function getRoomEnergy(store: Store, code: string, opts: { windowS?: number; nowMs?: number } = {}): Promise<RoomEnergy> {
  const room = await store.getRoom(code);
  if (!room) throw new Error(`Room ${code} not found`);
  const nowMs = opts.nowMs ?? now();
  await syncVitals(store, room, nowMs);
  const windowS = opts.windowS ?? 30;
  const readings = await store.getReadings(code, nowMs - Math.max(windowS, 120) * 1000);
  return computeRoomEnergy(readings, { mode: room.mode, nowMs, windowS, baseline: await currentBaseline(store, room, nowMs) });
}
