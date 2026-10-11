import { fail, json, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { fetchResult, presageConfigured, uploadClip } from "@/lib/presage";

export const maxDuration = 60;
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Presage cloud scan. POST: the browser sends the recorded clip; we forward it to Presage and return an id (the clip is not stored).
 * GET ?id=: the browser polls until Presage has processed it, then gets the numbers.
 * Requires the guest to have opted in to sensing.
 */
export const POST = withRoom(async (req, room) => {
  if (!presageConfigured()) return fail("Presage cloud scanning is not configured", 501);
  const url = new URL(req.url);
  const guest = (await store.listGuests(room.code)).find((g) => g.id === url.searchParams.get("guest_id"));
  if (!guest) return fail("unknown guest_id", 403);
  if (!guest.sensing) return fail("guest has not opted in to sensing", 403);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength < 10_000) return fail("clip too small");
  if (bytes.byteLength > MAX_BYTES) return fail("clip too large", 413);
  return json({ id: await uploadClip(bytes) }, 201);
});

export const GET = withRoom(async (req, room) => {
  if (!presageConfigured()) return fail("Presage cloud scanning is not configured", 501);
  const url = new URL(req.url);
  const guest = (await store.listGuests(room.code)).find((g) => g.id === url.searchParams.get("guest_id"));
  if (!guest?.sensing) return fail("guest has not opted in to sensing", 403);
  const id = url.searchParams.get("id");
  if (!id) return fail("id required");
  return json(await fetchResult(id));
});
