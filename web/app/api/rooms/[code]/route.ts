import { fail, json, readJson, withRoom } from "@/lib/api";
import { now } from "@/lib/clock";
import { store } from "@/lib/db";
import type { Mode, VitalsSourceKind } from "@/lib/types";
import { latestScans } from "@/lib/vitals/scans";
import { getRoomEnergy } from "@/lib/vitals/source";

/** One-shot snapshot the host and guest UIs poll. Media payloads are stripped. */
export const GET = withRoom(async (_req, room) => {
  const energy = await getRoomEnergy(store, room.code);
  const [guests, inputs, queue, impacts, trace] = await Promise.all([
    store.listGuests(room.code),
    store.listInputs(room.code),
    store.listQueue(room.code),
    store.listImpacts(room.code),
    store.listTrace(room.code),
  ]);
  const cur = await store.getRoom(room.code);
  const fresh = inputs.filter((i) => i.created_at > (cur?.dj_seen_ts ?? 0));
  const scanData = await latestScans(store, room.code, now());
  return json({
    scans: scanData.scans,
    scan_summary: scanData.summary,
    recent_pulse: scanData.recent_pulse,
    pending_inputs: fresh.length,
    pending_age_ms: fresh.length ? now() - Math.max(...fresh.map((i) => i.created_at)) : 0,
    room: cur,
    guests,
    inputs: inputs.map(({ data_b64, ...rest }) => ({ ...rest, has_media: !!data_b64 })),
    queue,
    impacts,
    trace: trace.slice(-80),
    energy,
  });
});

export const PATCH = withRoom(async (req, room) => {
  const body = await readJson<{ name?: string; mode?: Mode; vitals_source?: VitalsSourceKind }>(req);
  if (body.mode && !["hype", "winddown"].includes(body.mode)) return fail("bad mode");
  if (body.vitals_source && !["simulated", "live"].includes(body.vitals_source)) return fail("bad vitals_source");
  return json(await store.updateRoom(room.code, { ...(body.name?.trim() && { name: body.name.trim().slice(0, 40) }), ...(body.mode && { mode: body.mode }), ...(body.vitals_source && { vitals_source: body.vitals_source }) }));
});
