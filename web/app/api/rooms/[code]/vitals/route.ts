import { z } from "zod";
import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import type { VitalsReading } from "@/lib/types";

const Reading = z.object({
  guest_id: z.string(),
  timestamp: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "bad timestamp"),
  pulse_bpm: z.number().min(30).max(220).nullable(),
  breathing_rpm: z.number().min(4).max(40).nullable(),
  expression: z.object({ label: z.enum(["positive", "neutral", "negative"]), valence: z.number().min(-1).max(1) }).nullable(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["presage", "simulated", "webcam"]).default("presage"),
});

/** Receives readings from the iOS app (single object or array). Rejects guests who have not opted in. */
export const POST = withRoom(async (req, room) => {
  const body = await readJson(req);
  const parsed = z.array(Reading).safeParse(Array.isArray(body) ? body : [body]);
  if (!parsed.success) return fail(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const guests = await store.listGuests(room.code);
  const ok: VitalsReading[] = [];
  for (const r of parsed.data) {
    const g = guests.find((x) => x.id === r.guest_id);
    if (!g) return fail(`unknown guest_id ${r.guest_id}`, 403);
    if (!g.sensing) return fail("guest has not opted in to sensing", 403);
    ok.push(r);
  }
  await store.addReadings(room.code, ok);
  return json({ stored: ok.length }, 201);
});
