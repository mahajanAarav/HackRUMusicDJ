"use client";

/**
 * Bridge to the iPhone shell app (ios/PresageSensor), which hosts this site in a web view and runs the
 * Presage SmartSpectra SDK natively. The browser can't run that SDK, so when we're inside the shell the
 * scan is handed to native code and only the resulting numbers come back.
 *
 *   web -> native:  window.webkit.messageHandlers.presage.postMessage({ type: "start", seconds })
 *   native -> web:  window.dispatchEvent(new CustomEvent("presage-event", { detail }))
 */
export interface NativeResult {
  pulse_bpm: number | null;
  breathing_rpm: number | null;
  hrv_ms?: number | null;
  confidence?: number;
  n_samples?: number;
}
type NativeEvent =
  | ({ type: "result" } & NativeResult)
  | { type: "progress"; seconds_left: number; pulse_bpm?: number | null; breathing_rpm?: number | null }
  | { type: "error"; message: string }
  | { type: "cancelled" };

type W = Window & { presageNative?: { available?: boolean; simulated?: boolean }; webkit?: { messageHandlers?: { presage?: { postMessage(m: unknown): void } } } };
const w = () => window as W;

/** True when the app's sensor is the testing stub, not the real Presage SDK. Results are then labeled "simulated". */
export const isSimulatedNative = () => typeof window !== "undefined" && !!w().presageNative?.simulated;

/** True only inside the iPhone shell, where the Presage SDK is available. */
export const isNative = () => typeof window !== "undefined" && !!w().presageNative?.available && !!w().webkit?.messageHandlers?.presage;

export function runNativeScan(seconds: number, onProgress: (p: { seconds_left: number; pulse_bpm?: number | null }) => void): Promise<NativeResult> {
  return new Promise((resolve, reject) => {
    const done = () => { window.removeEventListener("presage-event", handler); clearTimeout(guard); };
    const handler = (ev: Event) => {
      const e = (ev as CustomEvent<NativeEvent>).detail;
      if (e.type === "progress") onProgress(e);
      else if (e.type === "result") { done(); resolve(e); }
      else if (e.type === "error") { done(); reject(new Error(e.message)); }
      else if (e.type === "cancelled") { done(); reject(new Error("Scan cancelled")); }
    };
    const guard = setTimeout(() => { done(); reject(new Error("The scan timed out. Try again.")); }, (seconds + 45) * 1000);
    window.addEventListener("presage-event", handler);
    w().webkit!.messageHandlers!.presage!.postMessage({ type: "start", seconds });
  });
}

/** Dev only (open the guest page with ?fakenative): pretends to be the iPhone shell so the flow can be tested in a browser. */
export function installFakeNative() {
  const win = w();
  if (win.presageNative) return;
  win.presageNative = { available: true };
  win.webkit = {
    messageHandlers: {
      presage: {
        postMessage: (m: any) => {
          if (m?.type !== "start") return;
          const total: number = m.seconds ?? 20;
          let left = total;
          const t = setInterval(() => {
            left--;
            const detail: NativeEvent = left > 0 ? { type: "progress", seconds_left: left, pulse_bpm: left < total - 6 ? 71 + (left % 3) : null } : { type: "result", pulse_bpm: 72.4, breathing_rpm: 14.6, hrv_ms: 48, confidence: 0.9, n_samples: total * 2 };
            window.dispatchEvent(new CustomEvent("presage-event", { detail }));
            if (left <= 0) clearInterval(t);
          }, 1000);
        },
      },
    },
  };
}
