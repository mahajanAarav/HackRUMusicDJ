import { json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { endCurrent, startNext } from "@/lib/dj/playback";

/** action "next": finish the current track (played) and start the next queued one. "skip": same but marks it skipped. */
export const POST = withRoom(async (req, room) => {
  const { action } = await readJson<{ action?: "next" | "skip" }>(req);
  if (action === "skip") await endCurrent(store, room.code, "skipped");
  const started = await startNext(store, room.code);
  return json({ now_playing: started, queue: await store.listQueue(room.code), impacts: await store.listImpacts(room.code) });
});
