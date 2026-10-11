import { describe, expect, it } from "vitest";
import type { Content } from "@google/genai";
import { MemoryStore } from "../lib/db/memory";
import { runDj } from "../lib/gemini/agent";
import type { LlmClient } from "../lib/gemini/llm";
import { aggregate, arousalChange } from "../lib/vitals/energy";
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
  it("scores a pulse rise as positive arousal change and a fall as negative", () => {
    const start = 100_000;
    const up = Array.from({ length: 30 }, (_, i) => reading(start + i * 3000, 90));
    const down = Array.from({ length: 30 }, (_, i) => reading(start + i * 3000, 60));
    const item = { id: "q", song: "s", artist: "a", started_at: start, baseline: { pulse: 75, breathing: 14, valence: 0 } };
    const rise = computeImpact(up, item, start + 90_000);
    const fall = computeImpact(down, item, start + 90_000);
    expect(rise.delta.pulse).toBeCloseTo(15, 0);
    expect(rise.score).toBeGreaterThan(0.5);
    expect(fall.score).toBeLessThan(-0.3);
  });
  it("returns a null score without enough samples", () => {
    const item = { id: "q", song: "s", artist: "a", started_at: 0, baseline: { pulse: 75, breathing: 14, valence: 0 } };
    expect(computeImpact([], item, 60_000).score).toBeNull();
  });
  it("arousalChange is bounded", () => {
    expect(arousalChange({ pulse: 1000, breathing: 0 })).toBe(1);
    expect(arousalChange({ pulse: -1000, breathing: null })).toBe(-1);
    expect(arousalChange({ pulse: null, breathing: null })).toBeNull();
  });
});

describe("agent guardrails", () => {
  it("never trusts a model-supplied video_id: it resolves the video itself", async () => {
    const item = {
      song: "Levels", artist: "Avicii", video_id: "made-up", reason: "r", influenced_by: [],
      physiological_evidence: { metric: "pulse", summary: "s" }, announcement: "a", energy: 0.9, has_vocals: true,
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
    const room = await store.createRoom("live");
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

import { latestScans } from "../lib/vitals/scans";
describe("scan counter", () => {
  it("counts a webcam scan whose confidence is below the Presage cutoff", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const g = await store.addGuest(room.code, "Aarav", { sensing: true });
    const t = Date.now();
    await store.addReadings(room.code, [{ guest_id: g.id, timestamp: new Date(t).toISOString(), pulse_bpm: 70.5, breathing_rpm: 14, expression: null, confidence: 0.3, source: "webcam" }]);
    const res = await latestScans(store, room.code, t + 5000);
    expect(res.summary.n).toBe(1);
    expect(res.summary.pulse).toBe(70.5);
  });
  it("still ignores low-confidence Presage readings", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const g = await store.addGuest(room.code, "Aarav", { sensing: true });
    const t = Date.now();
    await store.addReadings(room.code, [{ guest_id: g.id, timestamp: new Date(t).toISOString(), pulse_bpm: 70, breathing_rpm: 14, expression: null, confidence: 0.3, source: "presage" }]);
    expect((await latestScans(store, room.code, t + 5000)).summary.n).toBe(0);
  });
});

import { repeatReason, normTitle, normArtist } from "../lib/dj/repeats";
import type { QueueItem } from "../lib/types";
const qi = (song: string, artist: string, n: number, video_id = `v${n}`): QueueItem => ({
  id: `q${n}`, status: "played", added_at: n, song, artist, video_id, reason: "", influenced_by: [],
  physiological_evidence: { metric: "pulse", summary: "" }, announcement: "", energy: 0.5, has_vocals: true,
});
describe("repeat protection", () => {
  it("normalizes titles and artists", () => {
    expect(normTitle("Levels (Original Mix) - Remastered 2011")).toBe("levels");
    expect(normTitle("Titanium ft. Sia")).toBe("titanium");
    expect(normArtist("David Guetta ft. Sia")).toBe("david guetta");
    expect(normArtist("Florence + The Machine")).toBe("florence the machine");
  });
  it("blocks the same song in another version, regardless of age", () => {
    const q = [qi("Levels", "Avicii", 1), ...Array.from({ length: 8 }, (_, i) => qi(`Other ${i}`, `Artist ${i}`, i + 2))];
    expect(repeatReason({ song: "Levels (Radio Edit)", artist: "AVICII" }, q)).toMatch(/already used/);
  });
  it("blocks the same video id under a different title", () => {
    expect(repeatReason({ song: "Totally New Name", artist: "Someone", video_id: "v1" }, [qi("Levels", "Avicii", 1)])).toMatch(/already used/);
  });
  it("blocks an artist inside the cooldown window but allows them later", () => {
    const q = [qi("A", "Drake", 1), qi("B", "Adele", 2), qi("C", "Beyonce", 3)];
    expect(repeatReason({ song: "New Song", artist: "Drake" }, q)).toMatch(/last 4 tracks/);
    const later = [...q, qi("D", "Eminem", 4), qi("E", "Queen", 5), qi("F", "ABBA", 6), qi("G", "Prince", 7)];
    expect(repeatReason({ song: "New Song", artist: "Drake" }, later)).toBeNull();
  });
  it("lets genuinely new songs through", () => {
    expect(repeatReason({ song: "Brand New", artist: "Fresh Artist" }, [qi("Levels", "Avicii", 1)])).toBeNull();
  });
  it("the offline DJ never repeats across many picks", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const g = await store.addGuest(room.code, "Ava");
    await store.addInput(room.code, { guest_id: g.id, guest_name: "Ava", kind: "text", text: "play some hip hop and rap" });
    const seen = new Set<string>();
    const artists: string[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await runDj(store, room.code, { llm: new (await import("../lib/gemini/mock-llm")).MockLlm() });
      if (!res.added.length) break;
      const key = normTitle(res.added[0].song);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      artists.push(normArtist(res.added[0].artist));
      for (const q of await store.listQueue(room.code)) if (q.status === "queued") await store.updateQueueItem(room.code, q.id, { status: "played" });
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
    for (let i = 4; i < artists.length; i++) expect(artists.slice(i - 4, i)).not.toContain(artists[i]);
  });
});

describe("suggested artists", () => {
  it("shows suggested artists (with usage counts) to the DJ and lets the offline DJ honor them", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const g = await store.addGuest(room.code, "Ava");
    await store.addInput(room.code, { guest_id: g.id, guest_name: "Ava", kind: "artist", text: "Kendrick Lamar" });
    let firstMessage = "";
    const { MockLlm } = await import("../lib/gemini/mock-llm");
    const mock = new MockLlm();
    const llm: LlmClient = { async generate(req) { firstMessage ||= JSON.stringify(req.contents[0]); return mock.generate(req); } };
    const res = await runDj(store, room.code, { llm });
    expect(firstMessage).toContain("Artists guests want to hear");
    expect(firstMessage).toContain("Kendrick Lamar");
    expect(res.added[0].artist).toBe("Kendrick Lamar");
    expect(res.added[0].artist_basis).toBe("suggested");
  });
});

import { publicRoom, publicTrace, safeToolArgs, stripVitals } from "../lib/dj/privacy";
describe("privacy and vocals", () => {
  it("strips pulse and breathing numbers from public text", () => {
    expect(stripVitals("Aarav's pulse check (70.5 bpm, breathing 6 rpm) shows the room easing")).not.toMatch(/\d/);
    expect(stripVitals("pulse is 72 and heart rate of 80 bpm")).not.toMatch(/\d/);
    expect(stripVitals("the room is settling, lovely energy")).toBe("the room is settling, lovely energy");
  });
  it("redacts other guests' readings from traces sent to browsers", () => {
    const t = publicTrace([{ id: "1", ts: 1, kind: "tool_result", name: "get_vitals_trend", result: { latest_scans: [{ pulse_bpm: 70 }] } }]);
    expect(JSON.stringify(t)).not.toContain("70");
  });
  it("never stores pulse numbers on a queued item", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const item = { song: "Levels", artist: "Avicii", reason: "Room pulse at 84 bpm and rising", influenced_by: [], physiological_evidence: { metric: "pulse", current: 84, baseline: 70, delta: 14, summary: "pulse 84 bpm vs 70 bpm" }, announcement: "Next up: Levels", energy: 0.9, has_vocals: true };
    let i = 0;
    const llm: LlmClient = { async generate() { const parts: Content["parts"] = i++ === 0 ? [{ functionCall: { name: "update_queue", args: { action: "add", item } } }] : [{ text: "ok" }]; return { content: { role: "model", parts }, functionCalls: parts!.flatMap((p) => (p.functionCall ? [p.functionCall] : [])), text: parts![0].text }; } };
    const res = await runDj(store, room.code, { llm });
    expect(JSON.stringify(res.added[0])).not.toMatch(/\b84\b|\b70\b/);
    expect(res.added[0].physiological_evidence.delta).toBeUndefined();
  });
  it("rejects songs without vocals", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const item = { song: "Weightless", artist: "Marconi Union", reason: "calm", influenced_by: [], physiological_evidence: { metric: "pulse", summary: "none" }, announcement: "Next up", energy: 0.1, has_vocals: false };
    let i = 0;
    const llm: LlmClient = { async generate() { const parts: Content["parts"] = i++ === 0 ? [{ functionCall: { name: "update_queue", args: { action: "add", item } } }] : [{ text: "ok" }]; return { content: { role: "model", parts }, functionCalls: parts!.flatMap((p) => (p.functionCall ? [p.functionCall] : [])), text: parts![0].text }; } };
    const res = await runDj(store, room.code, { llm });
    expect(res.added).toHaveLength(0);
    expect(res.trace.some((t) => t.kind === "tool_result" && JSON.stringify(t.result).includes("vocals"))).toBe(true);
  });
});

describe("nothing numeric leaks through traces or the room object", () => {
  it("scrubs the model's logged update_queue args", () => {
    const args = safeToolArgs("update_queue", { action: "add", item: { song: "S", artist: "A", reason: "pulse at 136 bpm", announcement: "go", physiological_evidence: { metric: "pulse", current: 136.5, baseline: 70, delta: 66, summary: "136 bpm vs 70 bpm" } } });
    expect(JSON.stringify(args)).not.toMatch(/136|\b70\b|\b66\b/);
  });
  it("hides pulse-check results from the public room", () => {
    const room = publicRoom({ code: "ABCD", name: "x", vitals_source: "live", created_at: 1, pulse_check: { guest_id: "g", started_at: 1, duration_s: 20, result: { pulse_bpm: 136, breathing_rpm: 27, valence: null, n_samples: 5 } } });
    expect(JSON.stringify(room)).not.toMatch(/136|pulse_check/);
  });
  it("end to end: a DJ run on a room with real-looking scans leaks no numbers in its trace", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const g = await store.addGuest(room.code, "Ava", { sensing: true });
    const t = Date.now();
    await store.addReadings(room.code, [0, 1, 2, 3, 4, 5].map((k) => ({ guest_id: g.id, timestamp: new Date(t - 30000 + k * 5000).toISOString(), pulse_bpm: 137 + k, breathing_rpm: 29, expression: null, confidence: 0.4, source: "webcam" as const })));
    const { MockLlm } = await import("../lib/gemini/mock-llm");
    const res = await runDj(store, room.code, { llm: new MockLlm() });
    expect(res.added.length).toBe(1);
    expect(JSON.stringify(res.trace)).not.toMatch(/\b13[7-9]\b|\b14[0-2]\b|\b29\b|latest_scans/);
    expect(JSON.stringify(res.added)).not.toMatch(/\b13[7-9]\b|\b14[0-2]\b|\b29\b/);
  });
});

import { resetYoutubeCache, searchTrack } from "../lib/music/youtube";
import { vi } from "vitest";
describe("youtube lookup", () => {
  it("caches results so repeat songs cost no quota, and degrades to a placeholder on quota errors", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    resetYoutubeCache();
    const ok = { ok: true, status: 200, json: async () => ({ items: [{ id: { videoId: "abc123" }, snippet: { title: "Levels (Official Audio)", channelTitle: "Avicii" } }] }), text: async () => "" };
    const fetchMock = vi.fn().mockResolvedValueOnce(ok).mockResolvedValue({ ok: false, status: 403, text: async () => '{"error":{"message":"quotaExceeded"}}' });
    vi.stubGlobal("fetch", fetchMock);
    const first = await searchTrack("Levels", "Avicii");
    const again = await searchTrack("Levels (Radio Edit)", "AVICII");
    expect(first[0].video_id).toBe("abc123");
    expect(again[0].video_id).toBe("abc123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const other = await searchTrack("Titanium", "David Guetta");
    expect(other[0].playable).toBe(false);
    expect(other[0].video_id.startsWith("mock:")).toBe(true);
    await searchTrack("Clarity", "Zedd");
    expect(fetchMock).toHaveBeenCalledTimes(2); // blocked after the quota error: no more wasted calls
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_API_KEY;
    resetYoutubeCache();
  });
});

import http from "node:http";
import { fetchResult, presageConfigured, seriesValues, submitClip, summarizeSeries } from "../lib/presage";
describe("presage cloud client", () => {
  it("summarizes the shapes a vitals series might arrive in", () => {
    expect(seriesValues({ "0.5": 70, "1.0": 72 })).toEqual([70, 72]);
    expect(seriesValues([[0, 70], [1, 72]])).toEqual([70, 72]);
    expect(seriesValues([{ value: 70 }, { value: 72 }])).toEqual([70, 72]);
    expect(summarizeSeries({ a: 300, b: 70, c: 72, d: 71, e: 73, f: 74 }, 30, 220)).toBeGreaterThan(69); // 300 is implausible and dropped
    expect(summarizeSeries({ a: 1, b: 2 }, 30, 220)).toBeNull();
  });

  it("submits a clip to the processor with the shared secret, polls through 'processing', and returns median vitals", async () => {
    let polls = 0;
    let gotBytes = 0;
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const send = (code: number, obj: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
        if (req.headers["x-processor-secret"] !== "shh") return send(401, { error: "unauthorized" });
        if (req.method === "POST" && req.url === "/jobs") { gotBytes = Buffer.concat(chunks).length; return send(201, { id: "job1" }); }
        if (req.method === "GET" && req.url === "/jobs/job1") return ++polls < 2 ? send(200, { status: "processing", stage: "preprocessing" }) : send(200, { status: "ready", hr: { 1: 80, 2: 71, 3: 72, 4: 73, 5: 72, 6: 71 }, rr: { 1: 15, 2: 14, 3: 15, 4: 16, 5: 15, 6: 15 } });
        send(404, {});
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    process.env.PRESAGE_PROCESSOR_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
    process.env.PROCESSOR_SECRET = "shh";
    try {
      expect(presageConfigured()).toBe(true);
      const id = await submitClip(new Uint8Array(20_000), "video/webm");
      expect(id).toBe("job1");
      expect(gotBytes).toBe(20_000);
      expect(await fetchResult(id)).toEqual({ status: "pending", stage: "preprocessing" });
      expect(await fetchResult(id)).toMatchObject({ status: "ready", pulse_bpm: 72, breathing_rpm: 15 });
      process.env.PROCESSOR_SECRET = "wrong";
      await expect(submitClip(new Uint8Array(20_000), "video/mp4")).rejects.toThrow(/refused/i);
    } finally {
      srv.close();
      delete process.env.PRESAGE_PROCESSOR_URL;
      delete process.env.PROCESSOR_SECRET;
    }
    expect(presageConfigured()).toBe(false);
  });
});

import { ratingsForPrompt, summarizeRatings } from "../lib/dj/ratings";
describe("song ratings", () => {
  it("averages ratings per song, one per guest (re-rating replaces)", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    await store.setRating(room.code, { queue_id: "q1", guest_id: "a", value: 5 });
    await store.setRating(room.code, { queue_id: "q1", guest_id: "b", value: 3 });
    await store.setRating(room.code, { queue_id: "q1", guest_id: "b", value: 1 }); // replaces b's 3
    await store.setRating(room.code, { queue_id: "q2", guest_id: "a", value: 4 });
    const sum = summarizeRatings(await store.listRatings(room.code));
    expect(sum.q1).toEqual({ avg: 3, n: 2 });
    expect(sum.q2).toEqual({ avg: 4, n: 1 });
  });
  it("shows the DJ how each song was rated, and never exposes who rated what", async () => {
    const store = new MemoryStore();
    const room = await store.createRoom("live");
    const item = await store.addQueueItem(room.code, { song: "Levels", artist: "Avicii", video_id: "v", reason: "r", influenced_by: [], physiological_evidence: { metric: "pulse", summary: "s" }, announcement: "a", energy: 0.9, has_vocals: true });
    await store.setRating(room.code, { queue_id: item.id, guest_id: "secret-guest-id", value: 2 });
    const lines = ratingsForPrompt(await store.listQueue(room.code), await store.listRatings(room.code));
    expect(lines).toEqual(["Levels - Avicii: 2/5 from 1 guest"]);
    expect(JSON.stringify(lines)).not.toContain("secret-guest-id");
  });
});
