import { median } from "./vitals/smooth";

/**
 * Presage scans go through our own Python processor (presage-processor/), which runs Presage's official preprocessing library
 * on the clip and sends only the resulting trace to Presage's Physiology API. The browser never talks to Presage, and the clip
 * is deleted by the processor right after. Configure with PRESAGE_PROCESSOR_URL and PROCESSOR_SECRET.
 *
 * (Presage's older raw-video /v1 endpoints no longer exist; checked live on 2026-10-11.)
 */
const processorUrl = () => process.env.PRESAGE_PROCESSOR_URL?.replace(/\/+$/, "");
export const presageConfigured = () => !!processorUrl();
const authHeaders = () => ({ "x-processor-secret": process.env.PROCESSOR_SECRET ?? "" });

export async function submitClip(bytes: Uint8Array, mime: string): Promise<string> {
  const res = await fetch(`${processorUrl()}/jobs`, { method: "POST", headers: { ...authHeaders(), "Content-Type": mime || "video/mp4" }, body: new Blob([bytes as BlobPart], { type: mime || "video/mp4" }) });
  const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !j.id) throw new Error(`Presage processor refused the clip: ${res.status} ${j.error ?? ""}`.trim());
  return j.id;
}

/** Pull plausible numbers out of whatever shape a vitals series arrives in (object of time->value, array of numbers, array of [t, v] or {value}). */
export function seriesValues(x: unknown): number[] {
  const out: number[] = [];
  const visit = (v: unknown, depth = 0) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out.push(Number(v));
    else if (depth < 3 && Array.isArray(v)) v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" ? out.push(v[1]) : v.forEach((e) => visit(e, depth + 1));
    else if (depth < 3 && v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("value" in o) visit(o.value, depth + 1);
      else if ("rate" in o) visit(o.rate, depth + 1);
      else Object.values(o).forEach((e) => visit(e, depth + 1));
    }
  };
  visit(x);
  return out;
}

/** Median of the plausible values, ignoring the first fifth of the clip while the estimate settles. */
export function summarizeSeries(x: unknown, lo: number, hi: number): number | null {
  const all = seriesValues(x).filter((v) => v >= lo && v <= hi);
  if (!all.length) return null;
  const settled = all.slice(Math.floor(all.length * 0.2));
  const m = median(settled.length ? settled : all);
  return m == null ? null : Math.round(m * 10) / 10;
}

export type ScanStatus = { status: "pending"; stage?: string } | { status: "ready"; pulse_bpm: number | null; breathing_rpm: number | null; n_samples: number };

export async function fetchResult(id: string): Promise<ScanStatus> {
  const res = await fetch(`${processorUrl()}/jobs/${encodeURIComponent(id)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Presage processor error: ${res.status}`);
  const data = (await res.json()) as { status: string; hr?: unknown; rr?: unknown; error?: string; stage?: string };
  if (data.status === "error") throw new Error(data.error ?? "Presage processing failed");
  if (data.status !== "ready") return { status: "pending", stage: data.stage };
  if (process.env.DEBUG_PRESAGE) console.log("[presage] result keys:", Object.keys(data), JSON.stringify(data).slice(0, 300));
  return { status: "ready", pulse_bpm: summarizeSeries(data.hr, 30, 220), breathing_rpm: summarizeSeries(data.rr, 4, 40), n_samples: seriesValues(data.hr).length };
}
