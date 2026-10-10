import { json, withRoom } from "@/lib/api";
import { store } from "@/lib/db";

/** Qualitative only: raw pulse/breathing deltas are private. */
export const GET = withRoom(async (_req, room) =>
  json((await store.listImpacts(room.code)).map((i) => ({ queue_id: i.queue_id, effect: i.delta.pulse == null ? null : i.delta.pulse > 3 ? "lift" : i.delta.pulse < -3 ? "settle" : "steady" }))),
);
