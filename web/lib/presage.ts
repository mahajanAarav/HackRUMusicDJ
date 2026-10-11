import { median } from "./vitals/smooth";

/**
 * Presage Physiology API (cloud). Protocol taken from Presage's own Python client:
 *   POST /v1/upload-url {file_size, hr_br:{to_process:true}}  -> {id, urls[], upload_id}   (header x-api-key)
 *   PUT  each url with up to 5 MB of the file                  -> ETag header per part
 *   POST /v1/complete {id, upload_id, parts:[{ETag, PartNumber}]}
 *   POST /retrieve-data {id, reshape:false}                    -> 201 still processing, 200 + {hr, rr}
 * The key stays on the server. The clip is held in memory only for the duration of the request and is never saved.
 */
const BASE = () => process.env.PRESAGE_BASE_URL ?? "https://api.physiology.presagetech.com";
const CHUNK = 5 * 1024 * 1024;

export const presageConfigured = () => !!process.env.PRESAGE_API_KEY;

const headers = () => ({ "x-api-key": process.env.PRESAGE_API_KEY!, "Content-Type": "application/json" });

export async function uploadClip(bytes: Uint8Array): Promise<string> {
  const start = await fetch(`${BASE()}/v1/upload-url`, { method: "POST", headers: headers(), body: JSON.stringify({ file_size: bytes.byteLength, hr_br: { to_process: true } }) });
  if (start.status === 401) throw new Error("Presage rejected the API key (401).");
  if (!start.ok) throw new Error(`Presage upload-url failed: ${start.status} ${(await start.text()).slice(0, 160)}`);
  const { id, urls, upload_id } = (await start.json()) as { id: string; urls: string[]; upload_id: string };

  const parts: { ETag: string; PartNumber: number }[] = [];
  for (let i = 0; i < urls.length; i++) {
    const put = await fetch(urls[i], { method: "PUT", body: bytes.slice(i * CHUNK, (i + 1) * CHUNK) });
    if (!put.ok) throw new Error(`Presage part upload failed: ${put.status}`);
    parts.push({ ETag: put.headers.get("etag") ?? "", PartNumber: i + 1 });
  }
  const done = await fetch(`${BASE()}/v1/complete`, { method: "POST", headers: headers(), body: JSON.stringify({ id, upload_id, parts }) });
  if (!done.ok) throw new Error(`Presage complete failed: ${done.status} ${(await done.text()).slice(0, 160)}`);
  return id;
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

export type ScanStatus = { status: "pending" } | { status: "ready"; pulse_bpm: number | null; breathing_rpm: number | null; n_samples: number };

export async function fetchResult(id: string): Promise<ScanStatus> {
  const res = await fetch(`${BASE()}/retrieve-data`, { method: "POST", headers: headers(), body: JSON.stringify({ id, reshape: false }) });
  if (res.status === 401) throw new Error("Presage rejected the API key (401).");
  if (res.status !== 200) return { status: "pending" }; // 201 = still processing; treat other transient codes the same
  const data = (await res.json()) as { hr?: unknown; rr?: unknown };
  if (process.env.DEBUG_PRESAGE) console.log("[presage] result keys:", Object.keys(data), JSON.stringify(data).slice(0, 300));
  return { status: "ready", pulse_bpm: summarizeSeries(data.hr, 30, 220), breathing_rpm: summarizeSeries(data.rr, 4, 40), n_samples: seriesValues(data.hr).length };
}
