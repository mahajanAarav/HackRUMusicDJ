import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { summarizeRatings } from "@/lib/dj/ratings";

/** A guest rates how well a song matched the vibe (1-5). Re-rating replaces their earlier rating. */
export const POST = withRoom(async (req, room) => {
  const { guest_id, queue_id, value } = await readJson<{ guest_id?: string; queue_id?: string; value?: number }>(req);
  if (!(await store.listGuests(room.code)).some((g) => g.id === guest_id)) return fail("unknown guest_id", 403);
  if (!(await store.listQueue(room.code)).some((q) => q.id === queue_id)) return fail("unknown song", 404);
  const v = Math.round(Number(value));
  if (!Number.isFinite(v) || v < 1 || v > 5) return fail("value must be 1 to 5");
  await store.setRating(room.code, { queue_id: queue_id!, guest_id: guest_id!, value: v });
  return json(summarizeRatings(await store.listRatings(room.code))[queue_id!]);
});
