import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { normArtist } from "@/lib/dj/repeats";

const MAX_B64 = 4_000_000; // ~3MB of media per input
const MIMES: Record<string, string[]> = { photo: ["image/jpeg", "image/png", "image/webp"], voice: ["audio/wav", "audio/mp3", "audio/ogg", "audio/aac", "audio/flac"] };

export const POST = withRoom(async (req, room) => {
  const b = await readJson<{ guest_id?: string; kind?: "text" | "photo" | "voice" | "artist"; text?: string; mime?: string; data_b64?: string }>(req);
  const guest = (await store.listGuests(room.code)).find((g) => g.id === b.guest_id);
  if (!guest) return fail("unknown guest_id", 403);
  if (b.kind === "text") {
    const text = b.text?.trim().slice(0, 300);
    if (!text) return fail("text required");
    return json(await store.addInput(room.code, { guest_id: guest.id, guest_name: guest.name, kind: "text", text }), 201);
  }
  if (b.kind === "artist") {
    // "Drake, Doja Cat" adds two artists. Duplicates (any spelling of the same primary artist) are ignored.
    const names = (b.text ?? "").split(/[,\n;]+/).map((n) => n.trim().slice(0, 60)).filter(Boolean).slice(0, 5);
    if (!names.length) return fail("artist name required");
    const have = new Set((await store.listInputs(room.code)).filter((i) => i.kind === "artist").map((i) => normArtist(i.text ?? "")));
    const added = [];
    for (const n of names) {
      const key = normArtist(n);
      if (!key || have.has(key)) continue;
      have.add(key);
      added.push(await store.addInput(room.code, { guest_id: guest.id, guest_name: guest.name, kind: "artist", text: n }));
    }
    if (!added.length) return fail("That artist is already in the room's list", 409);
    return json({ added }, 201);
  }
  if (b.kind === "photo" || b.kind === "voice") {
    if (!b.data_b64 || b.data_b64.length > MAX_B64) return fail("data_b64 missing or too large");
    if (!b.mime || !MIMES[b.kind].includes(b.mime)) return fail(`mime must be one of ${MIMES[b.kind].join(", ")}`);
    const { data_b64, ...rest } = await store.addInput(room.code, { guest_id: guest.id, guest_name: guest.name, kind: b.kind, mime: b.mime, data_b64: b.data_b64, text: b.text?.slice(0, 200) });
    return json({ ...rest, has_media: true }, 201);
  }
  return fail("kind must be text, photo, voice or artist");
});
