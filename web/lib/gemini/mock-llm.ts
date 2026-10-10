import type { Content, FunctionCall } from "@google/genai";
import type { LlmClient, LlmTurn } from "./llm";

/** Offline stand-in for Gemini: deterministic rules that exercise the same tool loop. For dev, tests, and demo fallback. */
const CATALOG: { song: string; artist: string; energy: number }[] = [
  { song: "Titanium", artist: "David Guetta", energy: 0.92 },
  { song: "Levels", artist: "Avicii", energy: 0.95 },
  { song: "Blinding Lights", artist: "The Weeknd", energy: 0.85 },
  { song: "Dance Monkey", artist: "Tones and I", energy: 0.75 },
  { song: "Electric Feel", artist: "MGMT", energy: 0.65 },
  { song: "Put Your Records On", artist: "Corinne Bailey Rae", energy: 0.4 },
  { song: "Banana Pancakes", artist: "Jack Johnson", energy: 0.3 },
  { song: "Holocene", artist: "Bon Iver", energy: 0.2 },
  { song: "Weightless", artist: "Marconi Union", energy: 0.05 },
  { song: "Clair de Lune", artist: "Claude Debussy", energy: 0.1 },
];

const responses = (contents: Content[], name: string): Record<string, any>[] =>
  contents.flatMap((c) => c.parts ?? []).filter((p) => p.functionResponse?.name === name).map((p) => p.functionResponse!.response as Record<string, any>);
const calls = (contents: Content[], name: string): Record<string, any>[] =>
  contents.flatMap((c) => c.parts ?? []).filter((p) => p.functionCall?.name === name).map((p) => p.functionCall!.args as Record<string, any>);

const turn = (fc?: FunctionCall, text?: string): LlmTurn => ({
  content: { role: "model", parts: fc ? [{ functionCall: fc }] : [{ text: text! }] },
  functionCalls: fc ? [fc] : [],
  text,
});

export class MockLlm implements LlmClient {
  async generate({ system, contents }: { system: string; contents: Content[] }): Promise<LlmTurn> {
    const hype = system.includes("MODE: HYPE");
    const vitals = responses(contents, "get_vitals_trend")[0];
    const queue = responses(contents, "get_queue")[0];
    if (!vitals) return turn({ name: "get_vitals_trend", args: { window_seconds: 30 } });
    if (!queue) return turn({ name: "get_queue", args: {} });

    const used = new Set([...(queue.upcoming ?? []), ...(queue.recently_played ?? []), ...(queue.now_playing ? [queue.now_playing] : [])].map((q: any) => `${q.song}|${q.artist}`));
    const searched = responses(contents, "search_track");
    const added = responses(contents, "update_queue").some((r) => r.ok);
    if (added) return turn(undefined, "Queued the next track.");

    const e = vitals.energy;
    const recent: any[] = vitals.recent_song_impacts ?? [];
    const bad = new Set(recent.filter((i) => i.score != null && i.score < -0.15).map((i) => i.artist));
    const pool = CATALOG.filter((c) => !used.has(`${c.song}|${c.artist}`) && !bad.has(c.artist));
    const ranked = [...(pool.length ? pool : CATALOG)].sort((a, b) => (hype ? b.energy - a.energy : a.energy - b.energy));
    // In wind-down, step down gradually if the room is still wound up.
    const pick = !hype && (e.pulse.current ?? 0) - (e.pulse.baseline ?? 0) > 6 ? ranked[Math.min(2, ranked.length - 1)] : ranked[0];
    const search = searched[searched.length - 1];
    if (!search) return turn({ name: "search_track", args: { title: pick.song, artist: pick.artist } });

    const hit = search.results?.[0];
    if (!hit) return turn(undefined, "No result.");
    const userText = JSON.stringify(contents[0]);
    const inputId = /input_id=([a-z0-9-]+)/.exec(userText)?.[1];
    const delta = e.pulse.delta;
    const noScans = e.pulse.current == null;
    const item = {
      song: pick.song,
      artist: pick.artist,
      video_id: hit.video_id,
      reason: noScans
        ? hype ? "No pulse scans yet, so going by the room's vibe: keeping the energy high." : "No pulse scans yet, so easing the room down from the vibes shared."
        : hype ? `Keeping the energy climbing, room pulse is ${e.pulse.current} bpm (${e.trend}).` : `Easing the room down, breathing is ${e.breathing.current ?? "unknown"} rpm (${e.trend}).`,
      influenced_by: inputId ? [{ input_id: inputId, kind: "text", note: "Guest vibe request shaped the genre." }] : [],
      physiological_evidence: {
        metric: hype ? "pulse" : "breathing",
        baseline: hype ? e.pulse.baseline ?? undefined : e.breathing.baseline ?? undefined,
        current: hype ? e.pulse.current ?? undefined : e.breathing.current ?? undefined,
        delta: (hype ? delta : e.breathing.delta) ?? undefined,
        summary: noScans ? "No pulse scans yet; based on guest vibes only." : `${e.n_guests_sensing} guest(s) scanned; trend ${e.trend}; mode score ${e.score ?? "n/a"}.`,
      },
      announcement: `Next up: ${pick.song} by ${pick.artist}.`,
      energy: pick.energy,
    };
    const addCalls = calls(contents, "update_queue").length;
    if (addCalls > 2) return turn(undefined, "Giving up.");
    return turn({ name: "update_queue", args: { action: "add", item } });
  }
}
