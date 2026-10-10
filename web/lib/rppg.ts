"use client";

/**
 * Browser-side remote photoplethysmography (rPPG): estimates pulse and breathing from the tiny color
 * changes of skin on the forehead. Only the resulting numbers leave the browser; frames are averaged
 * into one number each and discarded immediately.
 *
 * This is a demo-grade fallback (needs good light and a still face). Presage on the iPhone is the accurate source.
 */
export interface RppgResult {
  pulse_bpm: number | null;
  breathing_rpm: number | null;
  confidence: number;
  n_samples: number;
}

const FS = 30; // resample rate (Hz)

function resample(t: number[], x: number[]): number[] {
  const out: number[] = [];
  const t0 = t[0], t1 = t[t.length - 1];
  let j = 0;
  for (let tt = t0; tt <= t1; tt += 1 / FS) {
    while (j < t.length - 2 && t[j + 1] < tt) j++;
    const f = (tt - t[j]) / Math.max(1e-6, t[j + 1] - t[j]);
    out.push(x[j] + (x[j + 1] - x[j]) * Math.min(1, Math.max(0, f)));
  }
  return out;
}

function movingAvg(x: number[], w: number): number[] {
  const out: number[] = [];
  let sum = 0;
  const q: number[] = [];
  for (const v of x) {
    q.push(v); sum += v;
    if (q.length > w) sum -= q.shift()!;
    out.push(sum / q.length);
  }
  return out;
}

/** Strongest frequency in [lo, hi] Hz via a direct DFT, plus how dominant that peak is (0..1). */
function dominant(x: number[], lo: number, hi: number, step: number): { f: number | null; conf: number } {
  const n = x.length;
  const win = x.map((v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))); // Hann
  let best = 0, bestF = 0, total = 0;
  const powers: [number, number][] = [];
  for (let f = lo; f <= hi; f += step) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * f * i) / FS;
      re += win[i] * Math.cos(a);
      im -= win[i] * Math.sin(a);
    }
    const p = re * re + im * im;
    powers.push([f, p]);
    total += p;
    if (p > best) { best = p; bestF = f; }
  }
  if (!total) return { f: null, conf: 0 };
  const near = powers.filter(([f]) => Math.abs(f - bestF) <= (hi - lo) * 0.04).reduce((s, [, p]) => s + p, 0);
  return { f: bestF, conf: near / total };
}

export class RppgMeter {
  private t: number[] = [];
  private g: number[] = [];
  private canvas?: HTMLCanvasElement;
  private ctx?: CanvasRenderingContext2D;

  /** Call once per video frame. Samples a forehead-sized patch near the top-center of the face oval. */
  sample(video: HTMLVideoElement) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = 48;
      this.canvas.height = 36;
      this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
    }
    this.ctx!.drawImage(video, vw * 0.36, vh * 0.2, vw * 0.28, vh * 0.2, 0, 0, this.canvas.width, this.canvas.height);
    const d = this.ctx!.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const sum = r + g + b;
    if (!sum) return;
    this.t.push(performance.now() / 1000);
    this.g.push(g / sum); // chromaticity: cancels overall brightness flicker
  }

  get count() { return this.t.length; }

  analyze(lastSeconds?: number): RppgResult {
    let t = this.t, g = this.g;
    if (lastSeconds) {
      const cut = t[t.length - 1] - lastSeconds;
      const k = t.findIndex((x) => x >= cut);
      t = t.slice(Math.max(0, k)); g = g.slice(Math.max(0, k));
    }
    if (t.length < FS * 6 || t[t.length - 1] - t[0] < 6) return { pulse_bpm: null, breathing_rpm: null, confidence: 0, n_samples: t.length };
    const x = resample(t, g);

    // pulse: remove everything slower than ~0.7 Hz, search 0.75-3.0 Hz (45-180 bpm)
    const slow = movingAvg(x, Math.round(FS * 1.5));
    const hp = x.map((v, i) => v - slow[i]);
    const p = dominant(hp, 0.75, 3.0, 0.0125);

    // breathing: smooth out the pulse, remove slow drift, search 0.1-0.5 Hz (6-30 rpm)
    const sm = movingAvg(x, Math.round(FS * 0.8));
    const drift = movingAvg(sm, Math.round(FS * 10));
    const br = dominant(sm.map((v, i) => v - drift[i]), 0.15, 0.5, 0.005); // 9-30 rpm; slower is indistinguishable from drift in 20 s

    const ok = p.conf >= 0.2;
    return {
      pulse_bpm: ok && p.f ? Math.round(p.f * 600) / 10 : null,
      breathing_rpm: br.conf >= 0.25 && br.f && br.f > 0.16 ? Math.round(br.f * 600) / 10 : null,
      confidence: Math.round(p.conf * 100) / 100,
      n_samples: t.length,
    };
  }
}
