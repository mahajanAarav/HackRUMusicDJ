import { json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { runDj, type Trigger } from "@/lib/gemini/agent";

export const maxDuration = 60;

export const POST = withRoom(async (req, room) => {
  const { trigger } = await readJson<{ trigger?: Trigger }>(req);
  const res = await runDj(store, room.code, { trigger: trigger ?? "next_song" });
  return json(res, res.error && !res.added.length && !res.skipped ? 502 : 200);
});
