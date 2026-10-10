import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { speak } from "@/lib/tts/elevenlabs";

/** Returns audio/mpeg from ElevenLabs, or 501 with the text so the client can fall back to speechSynthesis. */
export const POST = withRoom(async (req, room) => {
  const { queue_id } = await readJson<{ queue_id?: string }>(req);
  const item = (await store.listQueue(room.code)).find((q) => q.id === queue_id);
  if (!item) return fail("queue item not found", 404);
  const audio = await speak(item.announcement);
  if (!audio) return json({ fallback_text: item.announcement }, 501);
  return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
});
