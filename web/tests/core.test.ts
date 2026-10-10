import { describe, expect, it } from "vitest";
import type { Content } from "@google/genai";
import { MemoryStore } from "../lib/db/memory";
import { runDj } from "../lib/gemini/agent";
import type { LlmClient } from "../lib/gemini/llm";
import { aggregate, modeScore } from "../lib/vitals/energy";
import { computeImpact } from "../lib/vitals/impact";
import { medianFilter, smooth } from "../lib/vitals/smooth";
import type { VitalsReading } from "../lib/types";

const reading = (t: number, pulse: number, extra: Partial<VitalsReading> = {}): VitalsReading => ({
  guest_id: "g1",
  timestamp: new Date(t).toISOString(),
  pulse_bpm: pulse,
  breathing_rpm: 14,
  expression: { label: "neutral", valence: 0 },
  confidence: 0.9,
  source: "simulated",
  ...extra,
});

describe("smoothing", () => {
  it("median filter removes a single spike", () => {
    expect(medianFilter([70, 71, 140, 72, 71], 5)[2]).toBeLessThan(75);
  });
  it("smooth keeps a steady series close to its level", () => {
    const out = smooth([70, 70, 70, 70]);
    expect(out.every((x) => Math.abs(x - 70) < 0.01)).toBe(true);
  });
});

describe("aggregation", () => {
  it("drops low-confidence readings and takes the median across guests", () => {
    const rs = [
      ...[0, 3, 6, 9].map((s) => reading(s * 1000, 80)),
      ...[0, 3, 6, 9].map((s) => reading(s * 1000, 200, { confidence: 0.2 })),
      ...[0, 3, 6, 9].map((s) => reading(s * 1000, 100, { guest_id: "g2" })),
      ...[0, 3, 6, 9].map((s) => reading(s * 1000, 90, { guest_id: "g3" })),
    ];
    const a = aggregate(rs, "pulse", 0, 10_000);
    expect(a.guests).toBe(3);
    expect(a.value).toBeCloseTo(90, 0);
  });
});

describe("impact", () => {
  it("scores a pulse rise as positive in hype and negative in winddown", () => {
    const start = 100_000;
    const rs = Array.from({ length: 30 }, (_, i) => reading(start + i * 3000, 90));
    const item = { id: "q", song: "s", artist: "a", started_at: start, baseline: { pulse: 75, breathing: 14, valence: 0 } };
    const hype = computeImpact(rs, item, start + 90_000, "hype");
    const wind = computeImpact(rs, item, start + 90_000, "winddown");
    expect(hype.delta.pulse).toBeCloseTo(15, 0);
    expect(hype.score).toBeGreaterThan(0.5);
    expect(wind.score).toBeLessThan(0);
  });
  it("returns a null score without enough samples", () => {
    const item = { id: "q", song: "s", artist: "a", started_at: 0, baseline: { pulse: 75, breathing: 14, valence: 0 } };
    expect(computeImpact([], item, 60_000, "hype").score).toBeNull();
  });
  it("modeScore is bounded", () => {
    expect(modeScore("hype", { pulse: 1000, breathing: 0 }, 1)).toBe(1);
  });
});

describe("agent guardrails", () => {
  it("never trusts a model-supplied video_id: it resolves the video itself", async () => {
    const item = {
      song: "Levels", artist: "Avicii", video_id: "made-up", reason: "r", influenced_by: [],
      physiological_evidence: { metric: "pulse", summary: "s" }, announcement: "a", energy: 0.9,
    };
    let i = 0;
    const llm: LlmClient = {
      async generate() {
        const parts: Content["parts"] = i++ === 0 ? [{ functionCall: { name: "update_queue", args: { action: "add", item } } }] : [{ text: "done" }];
        return { content: { role: "model", parts }, functionCalls: parts!.flatMap((p) => (p.functionCall ? [p.functionCall] : [])), text: parts![0].text };
      },
    };
    const saved = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY; // force the mock lookup
    const store = new MemoryStore();
    const room = await store.createRoom("hype", "live");
    const res = await runDj(store, room.code, { llm });
    if (saved) process.env.YOUTUBE_API_KEY = saved;
    expect(res.added).toHaveLength(1);
    expect(res.added[0].video_id).toBe("mock:avicii-levels");
    expect(res.added[0].video_id).not.toBe("made-up");
  });
});

import { RppgMeter } from "../lib/rppg";
describe("rppg", () => {
  it("recovers pulse and breathing from a synthetic skin-color signal", () => {
    // Feed the analyzer directly: 20 s at ~30 fps, 72 bpm pulse (1.2 Hz) on a 15 rpm breathing wave (0.25 Hz) plus noise.
    const m = new RppgMeter() as unknown as { t: number[]; g: number[]; analyze: () => ReturnType<RppgMeter["analyze"]> };
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    for (let i = 0; i < 600; i++) {
      const t = i / 30;
      m.t.push(t);
      m.g.push(0.34 + 0.0004 * Math.sin(2 * Math.PI * 1.2 * t) + 0.0006 * Math.sin(2 * Math.PI * 0.25 * t) + 0.0002 * rnd());
    }
    const r = m.analyze();
    expect(r.pulse_bpm).not.toBeNull();
    expect(Math.abs(r.pulse_bpm! - 72)).toBeLessThan(3);
    expect(Math.abs((r.breathing_rpm ?? 0) - 15)).toBeLessThan(3);
  });
});

import { toGroqMessages } from "../lib/gemini/groq";
describe("groq adapter", () => {
  it("maps gemini-style tool history to openai-style messages with matching call ids", () => {
    const contents: Content[] = [
      { role: "user", parts: [{ text: "pick a song" }, { inlineData: { mimeType: "image/jpeg", data: "xx" } }] },
      { role: "model", parts: [{ functionCall: { name: "get_vitals_trend", args: {} } }, { functionCall: { name: "get_queue", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_vitals_trend", response: { a: 1 } } }, { functionResponse: { name: "get_queue", response: { b: 2 } } }] },
    ];
    const m = toGroqMessages("sys", contents) as any[];
    expect(m.map((x) => x.role)).toEqual(["system", "user", "assistant", "tool", "tool"]);
    expect(m[2].tool_calls.map((t: any) => t.id)).toEqual(["call_0", "call_1"]);
    expect(m[3].tool_call_id).toBe("call_0");
    expect(m[4].tool_call_id).toBe("call_1");
    expect(m[1].content).toContain("not visible");
  });
});
