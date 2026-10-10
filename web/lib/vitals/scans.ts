import type { Store } from "../db/store";
import { median } from "./smooth";
import { isUsable } from "./energy";

export interface Scan {
  guest_id: string;
  name: string;
  pulse_bpm: number | null;
  breathing_rpm: number | null;
  age_s: number;
  source: string;
}

export const SCAN_WINDOW_MS = 10 * 60_000;

/** Each guest's most recent real reading (camera scan) from the last 10 minutes. Nothing here is ever invented. */
export async function latestScans(store: Store, code: string, nowMs: number): Promise<{ scans: Scan[]; summary: { pulse: number | null; breathing: number | null; n: number }; recent_pulse: number[] }> {
  const [readings, guests] = await Promise.all([store.getReadings(code, nowMs - SCAN_WINDOW_MS), store.listGuests(code)]);
  const usable = readings.filter(isUsable).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const last = new Map<string, (typeof usable)[number]>();
  for (const r of usable) if (r.pulse_bpm != null) last.set(r.guest_id, r);
  const scans: Scan[] = [...last.values()].map((r) => ({
    guest_id: r.guest_id,
    name: guests.find((g) => g.id === r.guest_id)?.name ?? "Guest",
    pulse_bpm: r.pulse_bpm,
    breathing_rpm: r.breathing_rpm,
    age_s: Math.max(0, Math.round((nowMs - Date.parse(r.timestamp)) / 1000)),
    source: r.source,
  }));
  const round = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
  return {
    scans,
    summary: {
      pulse: round(median(scans.flatMap((s) => (s.pulse_bpm == null ? [] : [s.pulse_bpm])))),
      breathing: round(median(scans.flatMap((s) => (s.breathing_rpm == null ? [] : [s.breathing_rpm])))),
      n: scans.length,
    },
    recent_pulse: usable.filter((r) => r.pulse_bpm != null).slice(-60).map((r) => r.pulse_bpm as number),
  };
}
