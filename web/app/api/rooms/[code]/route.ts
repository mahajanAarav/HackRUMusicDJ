import { fail, json, readJson, withRoom } from "@/lib/api";
import { now } from "@/lib/clock";
import { store } from "@/lib/db";
import type { VitalsSourceKind } from "@/lib/types";
import { publicRoom, publicTrace } from "@/lib/dj/privacy";
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
    // Heart-rate numbers are never sent to browsers. The room only gets a qualitative read.
    feel: { n: scanData.summary.n, trend: energy.trend },
    pending_inputs: fresh.length,
    pending_age_ms: fresh.length ? now() - Math.max(...fresh.map((i) => i.created_at)) : 0,
    room: publicRoom(cur),
    guests,
    inputs: inputs.map(({ data_b64, ...rest }) => ({ ...rest, has_media: !!data_b64 })),
    // Baselines and per-song deltas are pulse/breathing numbers: reduce them to a qualitative effect.
    queue: queue.map(({ baseline: _b, ...q }) => q),
    impacts: impacts.map((i) => ({ queue_id: i.queue_id, effect: i.delta.pulse == null ? null : i.delta.pulse > 3 ? "lift" : i.delta.pulse < -3 ? "settle" : "steady" })),
    trace: publicTrace(trace.slice(-80)),
  });
});

export const PATCH = withRoom(async (req, room) => {
  const body = await readJson<{ name?: string; dj_style?: string; vitals_source?: VitalsSourceKind }>(req);
  if (body.dj_style && !["hype", "latenight", "dramatic"].includes(body.dj_style)) return fail("bad dj_style");
  if (body.vitals_source && !["simulated", "live"].includes(body.vitals_source)) return fail("bad vitals_source");
  return json(publicRoom(await store.updateRoom(room.code, { ...(body.name?.trim() && { name: body.name.trim().slice(0, 40) }), ...(body.dj_style && { dj_style: body.dj_style as "hype" | "latenight" | "dramatic" }), ...(body.vitals_source && { vitals_source: body.vitals_source }) })));
});
