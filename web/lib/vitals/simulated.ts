import { now } from "../clock";
import type { Store } from "../db/store";
import type { Room, VitalsReading } from "../types";
import { clip } from "./smooth";

export const STEP_MS = 3000;
const PREFILL_MS = 120_000;
const MAX_STEPS = 400;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GuestSim { pulse: number; breathing: number; valence: number; base: { pulse: number; breathing: number } }
interface RoomSim { lastTs: number; rand: () => number; guests: Map<string, GuestSim> }

const g = globalThis as unknown as { __bdjSim?: Map<string, RoomSim> };
const sims = (g.__bdjSim ??= new Map());

const SIM_GUESTS = [
  { id: "sim-a", name: "Sim Ava" },
  { id: "sim-b", name: "Sim Ben" },
  { id: "sim-c", name: "Sim Cai" },
];

/**
 * Generates fake-but-plausible readings up to `nowMs`. Vitals relax toward a target set by the
 * playing song's `energy` (high energy lifts pulse/breathing/valence, low energy lowers them),
 * plus per-song/per-guest quirks, gaussian noise, spikes and low-confidence garbage, so the
 * smoothing and baseline logic have something real to chew on.
 */
export async function syncSimulated(store: Store, room: Room, nowMs = now()) {
  let sim = sims.get(room.code);
  if (!sim) {
    sim = { lastTs: nowMs - PREFILL_MS, rand: rng(hash(room.code)), guests: new Map() };
    sims.set(room.code, sim);
    for (const sg of SIM_GUESTS) await store.addGuest(room.code, sg.name, { id: sg.id, simulated: true, sensing: true });
  }
  const gauss = () => Math.sqrt(-2 * Math.log(1 - sim!.rand())) * Math.cos(2 * Math.PI * sim!.rand());

  const guests = (await store.listGuests(room.code)).filter((x) => x.sensing);
  const queue = await store.listQueue(room.code);
  const playing = queue.find((q) => q.status === "playing");
  const out: VitalsReading[] = [];

  const steps = Math.min(MAX_STEPS, Math.floor((nowMs - sim.lastTs) / STEP_MS));
  for (let i = 1; i <= steps; i++) {
    const t = sim.lastTs + i * STEP_MS;
    for (const guest of guests) {
      let s = sim.guests.get(guest.id);
      if (!s) {
        const base = { pulse: 68 + (hash(guest.id) % 14), breathing: 13 + (hash(guest.id + "b") % 4) };
        s = { ...base, valence: 0.1, base };
        sim.guests.set(guest.id, s);
      }
      const resp = playing
        ? clip((playing.energy - 0.5) * 2 + 0.6 * (((hash(playing.song) % 1000) / 1000) - 0.5) + 0.3 * (((hash(playing.song + guest.id) % 1000) / 1000) - 0.5))
        : 0;
      const a = 0.15;
      s.pulse += a * (s.base.pulse + 12 * resp - s.pulse);
      s.breathing += a * (s.base.breathing + 2.5 * resp - s.breathing);
      s.valence += a * (0.1 + 0.5 * resp - s.valence);

      const garbage = sim.rand() < 0.04;
      const spike = sim.rand() < 0.03 ? (sim.rand() < 0.5 ? -15 : 15) : 0;
      const valence = clip(s.valence + 0.12 * gauss());
      out.push({
        guest_id: guest.id,
        timestamp: new Date(t).toISOString(),
        pulse_bpm: garbage ? 40 + sim.rand() * 140 : Math.round((s.pulse + 2 * gauss() + spike) * 10) / 10,
        breathing_rpm: Math.round((s.breathing + 0.7 * gauss()) * 10) / 10,
        expression: { label: valence > 0.25 ? "positive" : valence < -0.25 ? "negative" : "neutral", valence: Math.round(valence * 100) / 100 },
        confidence: garbage ? 0.3 : 0.7 + 0.25 * sim.rand(),
        source: "simulated",
      });
    }
  }
  sim.lastTs += steps * STEP_MS;
  if (out.length) await store.addReadings(room.code, out);
}

export function resetSimulated(code?: string) {
  if (code) sims.delete(code);
  else sims.clear();
}
