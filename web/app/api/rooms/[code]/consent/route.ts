import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";

export const POST = withRoom(async (req, room) => {
  const { guest_id, sensing } = await readJson<{ guest_id?: string; sensing?: boolean }>(req);
  if (!guest_id || typeof sensing !== "boolean") return fail("guest_id and sensing(boolean) required");
  if (!(await store.listGuests(room.code)).some((g) => g.id === guest_id)) return fail("unknown guest_id", 403);
  return json(await store.updateGuest(room.code, guest_id, { sensing }));
});
