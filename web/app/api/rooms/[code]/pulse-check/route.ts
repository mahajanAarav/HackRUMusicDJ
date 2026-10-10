import { fail, json, readJson, withRoom } from "@/lib/api";
import { store } from "@/lib/db";
import { now } from "@/lib/clock";
import { runDj } from "@/lib/gemini/agent";
import { aggregate } from "@/lib/vitals/energy";
import { syncVitals } from "@/lib/vitals/source";

const DURATION_S = 20;

/**
 * Two-step demo moment. The guest must have opted in to sensing.
 *  {action:"start"}  marks the start of the ~20s window (the phone looks at their face)
 *  {action:"finish"} aggregates that guest's readings (or uses `measured` from the browser webcam reader),
 *                    then runs the DJ with trigger=pulse_check
 */
export const POST = withRoom(async (req, room) => {
  const { guest_id, action, measured } = await readJson<{ guest_id?: string; action?: "start" | "finish"; measured?: { pulse_bpm: number | null; breathing_rpm: number | null; confidence?: number; n_samples?: number } }>(req);
  const guest = (await store.listGuests(room.code)).find((g) => g.id === guest_id);
  if (!guest) return fail("unknown guest_id", 403);
  if (!guest.sensing) return fail("guest has not opted in to sensing", 403);

  if (action === "start") {
    const pc = { guest_id: guest.id, started_at: now(), duration_s: DURATION_S };
    await store.updateRoom(room.code, { pulse_check: pc });
    return json(pc);
  }
  if (action !== "finish") return fail("action must be start or finish");
  const pc = room.pulse_check;
  if (!pc || pc.guest_id !== guest.id) return fail("no pulse check in progress for this guest");

  if (measured) {
    // Browser webcam (rPPG) reading: numbers only. Stored as a reading too when the room is on live vitals.
    const pulse = measured.pulse_bpm != null && measured.pulse_bpm >= 30 && measured.pulse_bpm <= 220 ? measured.pulse_bpm : null;
    const breathing = measured.breathing_rpm != null && measured.breathing_rpm >= 4 && measured.breathing_rpm <= 40 ? measured.breathing_rpm : null;
    if (pulse == null) return fail("no usable pulse in the measurement");
    if (room.vitals_source === "live") {
      await store.addReadings(room.code, [{ guest_id: guest.id, timestamp: new Date(now()).toISOString(), pulse_bpm: pulse, breathing_rpm: breathing, expression: null, confidence: measured.confidence ?? 0.5, source: "webcam" }]);
    }
    const result = { pulse_bpm: pulse, breathing_rpm: breathing, valence: null as number | null, n_samples: measured.n_samples ?? 0 };
    await store.updateRoom(room.code, { pulse_check: { ...pc, result } });
    const dj = await runDj(store, room.code, { trigger: "pulse_check" });
    return json({ result, dj });
  }

  await syncVitals(store, room);
  const readings = (await store.getReadings(room.code, pc.started_at)).filter((r) => r.guest_id === guest.id);
  const t1 = now();
  const p = aggregate(readings, "pulse", pc.started_at, t1);
  const b = aggregate(readings, "breathing", pc.started_at, t1);
  const v = aggregate(readings, "valence", pc.started_at, t1);
  const round = (x: number | null, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
  const result = { pulse_bpm: round(p.value), breathing_rpm: round(b.value), valence: round(v.value, 2), n_samples: p.samples };
  await store.updateRoom(room.code, { pulse_check: { ...pc, result } });
  const dj = await runDj(store, room.code, { trigger: "pulse_check" });
  return json({ result, dj });
});
