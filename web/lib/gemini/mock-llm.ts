import type { Content, FunctionCall } from "@google/genai";
import { normArtist, normTitle } from "../dj/repeats";
import type { LlmClient, LlmTurn } from "./llm";

/**
 * Offline stand-in for Gemini: deterministic rules that exercise the same tool loop. It cannot see
 * photos or hear audio; it reads guest text for genre/intensity keywords and the room's pulse trend.
 * Used for dev, tests, and as the last-resort fallback.
 */
type Genre = "pop" | "hiphop" | "rock" | "edm" | "country" | "jazz" | "chill" | "latin" | "rnb" | "classical" | "indie";
const CATALOG: { song: string; artist: string; energy: number; genre: Genre }[] = [
  { song: "Titanium", artist: "David Guetta", energy: 0.92, genre: "edm" },
  { song: "Levels", artist: "Avicii", energy: 0.95, genre: "edm" },
  { song: "Clarity", artist: "Zedd", energy: 0.85, genre: "edm" },
  { song: "Blinding Lights", artist: "The Weeknd", energy: 0.85, genre: "pop" },
  { song: "Dance Monkey", artist: "Tones and I", energy: 0.75, genre: "pop" },
  { song: "Levitating", artist: "Dua Lipa", energy: 0.8, genre: "pop" },
  { song: "Good as Hell", artist: "Lizzo", energy: 0.78, genre: "pop" },
  { song: "Sunflower", artist: "Post Malone", energy: 0.55, genre: "pop" },
  { song: "Lose Yourself", artist: "Eminem", energy: 0.88, genre: "hiphop" },
  { song: "HUMBLE.", artist: "Kendrick Lamar", energy: 0.8, genre: "hiphop" },
  { song: "Sicko Mode", artist: "Travis Scott", energy: 0.82, genre: "hiphop" },
  { song: "Juicy", artist: "The Notorious B.I.G.", energy: 0.6, genre: "hiphop" },
  { song: "Mr. Brightside", artist: "The Killers", energy: 0.85, genre: "rock" },
  { song: "Seven Nation Army", artist: "The White Stripes", energy: 0.8, genre: "rock" },
  { song: "Don't Stop Me Now", artist: "Queen", energy: 0.9, genre: "rock" },
  { song: "Black Hole Sun", artist: "Soundgarden", energy: 0.5, genre: "rock" },
  { song: "Friends in Low Places", artist: "Garth Brooks", energy: 0.7, genre: "country" },
  { song: "Wagon Wheel", artist: "Darius Rucker", energy: 0.6, genre: "country" },
  { song: "Tennessee Whiskey", artist: "Chris Stapleton", energy: 0.3, genre: "country" },
  { song: "Feeling Good", artist: "Nina Simone", energy: 0.4, genre: "jazz" },
  { song: "Put Your Records On", artist: "Corinne Bailey Rae", energy: 0.4, genre: "chill" },
  { song: "Banana Pancakes", artist: "Jack Johnson", energy: 0.3, genre: "chill" },
  { song: "Holocene", artist: "Bon Iver", energy: 0.2, genre: "indie" },
  { song: "Electric Feel", artist: "MGMT", energy: 0.65, genre: "indie" },
  { song: "Dog Days Are Over", artist: "Florence + The Machine", energy: 0.8, genre: "indie" },
  { song: "Despacito", artist: "Luis Fonsi", energy: 0.7, genre: "latin" },
  { song: "Danza Kuduro", artist: "Don Omar", energy: 0.9, genre: "latin" },
  { song: "Bailando", artist: "Enrique Iglesias", energy: 0.75, genre: "latin" },
  { song: "Redbone", artist: "Childish Gambino", energy: 0.35, genre: "rnb" },
  { song: "Get Lucky", artist: "Daft Punk", energy: 0.7, genre: "rnb" },
];

const KEYWORDS: [Genre, RegExp][] = [
  ["hiphop", /hip.?hop|rap|trap|drill/i],
  ["rock", /rock|metal|punk|guitar/i],
  ["edm", /edm|house|techno|rave|drop|dance floor|club/i],
  ["country", /country|honky|nashville|cowboy/i],
  ["jazz", /jazz|swing|sax/i],
  ["chill", /lo.?fi|chill|ambient|study/i],
  ["latin", /latin|reggaeton|salsa|bachata|spanish/i],
  ["rnb", /r&b|rnb|soul|funk/i],
  ["indie", /indie|alternative|folk/i],
  ["pop", /\bpop\b|top 40|radio/i],
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
  async generate({ contents }: { system: string; contents: Content[] }): Promise<LlmTurn> {
    const vitals = responses(contents, "get_vitals_trend")[0];
    const queue = responses(contents, "get_queue")[0];
    if (!vitals) return turn({ name: "get_vitals_trend", args: { window_seconds: 30 } });
    if (!queue) return turn({ name: "get_queue", args: {} });
    if (responses(contents, "update_queue").some((r) => r.ok)) return turn(undefined, "Queued the next track.");
    if (calls(contents, "update_queue").length > 3) return turn(undefined, "Giving up.");

    // What the guests said (the first user message carries their text vibes).
    const said: string = (contents[0].parts ?? []).map((p) => p.text ?? "").join("\n");
    const inputId = /input_id=([a-z0-9-]+)/.exec(said)?.[1];
    const wantsCalm = /calm|slow|relax|sleep|wind.?down|mellow|rain|quiet/i.test(said);
    const wantsHype = /hype|party|energy|dance|workout|power|drop|turn up|pump/i.test(said);
    const genres = KEYWORDS.filter(([, re]) => re.test(said)).map(([g]) => g);

    // Intensity: what they asked for, nudged by the room's pulse so it can steer rather than just obey.
    const e = vitals.energy ?? {};
    const scanned = e.pulse?.current != null;
    let target = wantsCalm ? 0.25 : wantsHype ? 0.85 : 0.6;
    if (scanned && wantsCalm && (e.pulse.delta ?? 0) > 6) target = 0.4; // room is still wound up: step down gradually
    if (scanned && wantsHype && (e.arousal_change ?? 0) > 0.6) target = 0.8; // already peaking: hold, do not escalate

    // Never repeat: skip anything used (any version) and recently used artists.
    const used: string[] = queue.never_repeat_these ?? [];
    const usedTitles = new Set(used.map((u) => normTitle(u.split(" - ")[0])));
    const recentArtists = new Set(used.slice(-4).map((u) => normArtist(u.split(" - ").slice(1).join(" - "))));
    const fresh = CATALOG.filter((c) => !usedTitles.has(normTitle(c.song)) && !recentArtists.has(normArtist(c.artist)));
    const named = [...said.matchAll(/\[input_id=[a-z0-9-]+\] ([^\n(]+?) \(suggested by/g)].map((m) => normArtist(m[1]));
    const byArtist = fresh.filter((c) => named.includes(normArtist(c.artist)));
    const inGenre = byArtist.length ? byArtist : genres.length ? fresh.filter((c) => genres.includes(c.genre)) : fresh;
    const pool = inGenre.length ? inGenre : fresh;
    if (!pool.length) return turn(undefined, "Nothing left that has not been played.");
    // Break ties pseudo-randomly (by how many songs were used) so genres rotate instead of always taking the same one.
    const ranked = [...pool].sort((a, b) => Math.abs(a.energy - target) - Math.abs(b.energy - target));
    const top = ranked.slice(0, Math.min(3, ranked.length));
    const pick = top[used.length % top.length];

    const item = {
      song: pick.song,
      artist: pick.artist,
      reason: scanned
        ? `${genres.length ? `Matching the ${pick.genre} request` : "Going with the room"}; the room's energy is ${e.trend === "rising" ? "rising" : e.trend === "falling" ? "settling" : "steady"}.`
        : `No pulse scans yet, so going by what guests asked for${genres.length ? ` (${pick.genre})` : ""}.`,
      artist_basis: byArtist.length ? "suggested" : "vibe",
      influenced_by: inputId ? [{ input_id: inputId, kind: "text", note: "Guest vibe shaped the genre and intensity." }] : [],
      physiological_evidence: scanned
        ? { metric: "pulse", current: e.pulse.current, summary: `${e.n_guests_sensing} guest(s) scanned; the room's energy is ${e.trend === "rising" ? "rising" : e.trend === "falling" ? "settling" : "steady"}.` }
        : { metric: "pulse", summary: "No pulse scans yet; based on guest vibes only." },
      announcement: `Next up: ${pick.song} by ${pick.artist}.`,
      energy: pick.energy,
      has_vocals: true,
    };
    return turn({ name: "update_queue", args: { action: "add", item } });
  }
}
