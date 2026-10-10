import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";

const MAX_B64 = 4_000_000; // ~3MB of media per input
const MIMES: Record<string, string[]> = { photo: ["image/jpeg", "image/png", "image/webp"], voice: ["audio/wav", "audio/mp3", "audio/ogg", "audio/aac", "audio/flac"] };

export const POST = withRoom(async (req, room) => {
  const b = await readJson<{ guest_id?: string; kind?: "text" | "photo" | "voice"; text?: string; mime?: string; data_b64?: string }>(req);
  const guest = (await store.listGuests(room.code)).find((g) => g.id === b.guest_id);
  if (!guest) return fail("unknown guest_id", 403);
  if (b.kind === "text") {
    const text = b.text?.trim().slice(0, 300);
    if (!text) return fail("text required");
    return json(await store.addInput(room.code, { guest_id: guest.id, guest_name: guest.name, kind: "text", text }), 201);
  }
  if (b.kind === "photo" || b.kind === "voice") {
    if (!b.data_b64 || b.data_b64.length > MAX_B64) return fail("data_b64 missing or too large");
    if (!b.mime || !MIMES[b.kind].includes(b.mime)) return fail(`mime must be one of ${MIMES[b.kind].join(", ")}`);
    const { data_b64, ...rest } = await store.addInput(room.code, { guest_id: guest.id, guest_name: guest.name, kind: b.kind, mime: b.mime, data_b64: b.data_b64, text: b.text?.slice(0, 200) });
    return json({ ...rest, has_media: true }, 201);
  }
  return fail("kind must be text, photo or voice");
});
