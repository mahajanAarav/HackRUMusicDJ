import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";

export const POST = withRoom(async (req, room) => {
  const { name } = await readJson<{ name?: string }>(req);
  const clean = name?.trim().slice(0, 30);
  if (!clean) return fail("name required");
  return json(await store.addGuest(room.code, clean), 201);
});
