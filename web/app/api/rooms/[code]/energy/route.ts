import { json, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { getRoomEnergy } from "@/lib/vitals/source";

export const GET = withRoom(async (req, room) => {
  const w = Number(new URL(req.url).searchParams.get("window_s")) || undefined;
  return json(await getRoomEnergy(store, room.code, { windowS: w }));
});
