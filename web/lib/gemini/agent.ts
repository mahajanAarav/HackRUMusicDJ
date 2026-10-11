import type { Content, Part } from "@google/genai";
import type { Store } from "../db/store";
import type { QueueItem, TraceEvent, VibeInput } from "../types";
import { now } from "../clock";
import { GroqLlm } from "./groq";
import { GeminiLlm, type LlmClient } from "./llm";
import { MockLlm } from "./mock-llm";
import { systemPrompt } from "./prompts";
import { publicTrace, safeToolArgs, stripVitals } from "../dj/privacy";
import { ratingsForPrompt } from "../dj/ratings";
import { normArtist, usedList } from "../dj/repeats";
import { executeTool, type ToolCtx } from "./tools";

const MAX_TURNS = 8;
const SUGGESTED_RUN = 3; // songs in a row from a suggested artist
const SIMILAR_RUN = 2; // then this many from similar artists
const BLOCK_MS = 60_000; // after a quota error, skip that provider for a minute so the next one answers instantly
const MAX_PHOTOS = 4;
const MAX_VOICE = 3;
const MAX_TEXT = 20;

export type Trigger = "next_song" | "pulse_check" | "start" | "new_input";

interface Provider { name: string; llm: LlmClient; blockedUntil: number }

/** Gemini first (the real engine), then Groq if a key is set, then the offline DJ, which is never blocked. */
const g = globalThis as unknown as { __bdjChain?: Provider[] };
function providerChain(): Provider[] {
  if (g.__bdjChain) return g.__bdjChain;
  const chain: Provider[] = [];
  if (!process.env.MOCK_LLM) {
    if (process.env.GEMINI_API_KEY) chain.push({ name: "Gemini", llm: new GeminiLlm(), blockedUntil: 0 });
    if (process.env.GROQ_API_KEY) chain.push({ name: "Groq", llm: new GroqLlm(), blockedUntil: 0 });
  }
  chain.push({ name: "Offline DJ", llm: new MockLlm(), blockedUntil: 0 });
  return (g.__bdjChain = chain);
}

export function defaultLlm(): LlmClient {
  return providerChain()[0].llm;
}

/** Text first, then photos and voice notes as inline parts, each labeled with its input_id. */
function inputParts(inputs: VibeInput[], queue: QueueItem[]): Part[] {
  const texts = inputs.filter((i) => i.kind === "text").slice(-MAX_TEXT);
  const artists = inputs.filter((i) => i.kind === "artist");
  const photos = inputs.filter((i) => i.kind === "photo" && i.data_b64).slice(-MAX_PHOTOS);
  const voices = inputs.filter((i) => i.kind === "voice" && i.data_b64).slice(-MAX_VOICE);
  const parts: Part[] = [];
  parts.push({
    text: texts.length
      ? "Guest text vibes:\n" + texts.map((t) => `- [input_id=${t.id}] ${t.guest_name}: "${t.text}"`).join("\n")
      : "No guest text vibes yet.",
  });
  if (artists.length) {
    const used = (name: string) => queue.filter((q) => normArtist(q.artist) === normArtist(name)).length;
    parts.push({
      text: "Artists guests want to hear (draw songs from them when they fit the vibe and the room's heartbeat, and weave in similar artists; songs already used from each in brackets):\n" +
        artists.map((a) => `- [input_id=${a.id}] ${a.text} (suggested by ${a.guest_name}; ${used(a.text ?? "")} used)`).join("\n"),
    });
  }
  for (const p of photos) {
    parts.push({ text: `Photo from ${p.guest_name} [input_id=${p.id}]:` }, { inlineData: { mimeType: p.mime ?? "image/jpeg", data: p.data_b64! } });
  }
  for (const v of voices) {
    parts.push({ text: `Voice note from ${v.guest_name} [input_id=${v.id}]:` }, { inlineData: { mimeType: v.mime ?? "audio/wav", data: v.data_b64! } });
  }
  return parts;
}

export interface DjResult {
  added: QueueItem[];
  skipped: boolean;
  trace: TraceEvent[];
  error?: string;
}

export async function runDj(
  store: Store,
  code: string,
  opts: { trigger?: Trigger; llm?: LlmClient } = {},
): Promise<DjResult> {
  const room = await store.getRoom(code);
  if (!room) throw new Error(`Room ${code} not found`);
  // An explicit client (tests, scripts) runs alone; otherwise walk the provider chain on quota errors.
  const chain: Provider[] = opts.llm ? [{ name: "custom", llm: opts.llm, blockedUntil: 0 }] : providerChain();
  const canFallback = !opts.llm && !process.env.NO_BACKUP_DJ;
  let idx = Math.max(0, chain.findIndex((p) => p.blockedUntil <= now()));
  let llm = chain[idx].llm;
  const trigger = opts.trigger ?? "next_song";
  const startedAt = now();
  const log = (ev: Omit<TraceEvent, "id" | "ts">) => store.addTrace(code, ev);

  const [guests, inputs, queue, ratings] = await Promise.all([store.listGuests(code), store.listInputs(code), store.listQueue(code), store.listRatings(code)]);
  const playing = queue.find((q) => q.status === "playing");
  const pc = room.pulse_check?.result;
  const fresh = inputs.filter((i) => i.created_at > (room.dj_seen_ts ?? 0));
  // Suggested artists get a BLOCK of songs (up to SUGGESTED_RUN in a row), then a couple by similar artists, then the next suggested artist.
  const artistNames = inputs.filter((i) => i.kind === "artist").map((i) => i.text);
  const bases = queue.filter((q) => q.status !== "skipped").map((q) => q.artist_basis).filter(Boolean) as string[];
  const lastBasis = bases[bases.length - 1];
  let trailing = 0;
  for (let k = bases.length - 1; k >= 0 && bases[k] === lastBasis; k--) trailing++;
  const lastSuggestedArtist = [...queue].reverse().find((q) => q.artist_basis === "suggested")?.artist;
  const artistTurn: "suggested" | "similar" | null = !artistNames.length ? null
    : lastBasis === "suggested" ? (trailing < SUGGESTED_RUN ? "suggested" : "similar")
    : lastBasis === "similar" ? (trailing < SIMILAR_RUN ? "similar" : "suggested")
    : "suggested";
  const continueRun = artistTurn === "suggested" && lastBasis === "suggested" && trailing < SUGGESTED_RUN && lastSuggestedArtist;
  // Fairness: make sure quieter guests are heard. Count how many picks each guest's inputs have shaped.
  const heard = new Map<string, number>();
  const owner = new Map(inputs.map((i) => [i.id, i.guest_name]));
  for (const g of new Set(inputs.map((i) => i.guest_name))) heard.set(g, 0);
  for (const q of queue) for (const n of new Set(q.influenced_by.map((x) => owner.get(x.input_id)).filter(Boolean) as string[])) heard.set(n, (heard.get(n) ?? 0) + 1);
  const leastHeard = heard.size > 1 ? [...heard.entries()].sort((a, b) => a[1] - b[1])[0] : null;
  const seenUpTo = inputs.reduce((m, i) => Math.max(m, i.created_at), room.dj_seen_ts ?? 0);
  const header = [
    `Trigger: ${trigger}.`,
    `Guests: ${guests.filter((g) => !g.simulated).map((g) => g.name).join(", ") || "(none yet)"}; ${guests.filter((g) => g.sensing).length} opted in to sensing.`,
    playing ? `Now playing: ${playing.song} by ${playing.artist}.` : "Nothing is playing yet.",
    trigger === "pulse_check" && pc
      ? `A guest just did a 20-second pulse check: pulse ${pc.pulse_bpm ?? "?"} bpm, breathing ${pc.breathing_rpm ?? "?"} rpm, expression valence ${pc.valence ?? "?"} (${pc.n_samples} samples). React to it directly in your pick and mention it in the reason.`
      : "",
    queue.filter((q) => q.status === "queued").length ? `Upcoming queue has ${queue.filter((q) => q.status === "queued").length} track(s); use get_queue to see them.` : "",
    artistTurn === "suggested"
      ? continueRun
        ? `ARTIST BLOCK: keep going with the same artist: pick another song by ${lastSuggestedArtist} (song ${trailing + 1} of ${SUGGESTED_RUN}) that fits the vibe, so guests hear a run of their artist. Set artist_basis="suggested". Only if ${lastSuggestedArtist} has nothing left that fits, use another suggested artist (${artistNames.join(", ")}).`
        : `ARTIST BLOCK: start a run of songs by one of the suggested artists (${artistNames.join(", ")}): choose the one with the fewest songs used and a song that fits the vibe. Set artist_basis="suggested". Later picks will continue with the same artist.`
      : artistTurn === "similar"
        ? `ARTIST TURN: this pick should be by a DIFFERENT artist who sounds similar to the suggested artists (${artistNames.join(", ")}), in the same lane and fitting the vibe. Set artist_basis="similar" and similar_to to the suggested artist it resembles.`
        : "",
    leastHeard && leastHeard[1] < Math.max(...heard.values())
      ? `Fairness: ${leastHeard[0]}'s inputs have shaped the fewest picks so far (${leastHeard[1]}). Give their input extra weight this time if it fits.`
      : "",
    fresh.length
      ? `NEW guest input since your last decision (honor it first): ${fresh.map((i) => `[input_id=${i.id}] ${i.guest_name} (${i.kind})`).join(", ")}. If an upcoming track no longer fits, remove it and add one that does.`
      : "",
    ratingsForPrompt(queue, ratings).length ? `Guest ratings of how well each song matched the vibe (1-5): ${ratingsForPrompt(queue, ratings).join("; ")}.` : "",
    queue.length ? `Already used tonight (never repeat, including other versions): ${usedList(queue).join("; ")}.` : "",
    trigger === "new_input" ? "Reconsider the upcoming queue in light of the new input. Add exactly one track that honors it." : "Choose the next track.",
  ].filter(Boolean).join("\n");

  await log({ kind: "trigger", text: trigger });

  const contents: Content[] = [{ role: "user", parts: [{ text: header }, ...inputParts(inputs, queue)] }];
  const ctx: ToolCtx = { store, room, seenVideos: new Map(), added: [], hasFreshInput: fresh.length > 0, skipped: false, removed: [] };
  let error: string | undefined;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let res;
      try {
        res = await llm.generate({ system: systemPrompt(), contents });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const fallbackOk = msg.startsWith("RATE_LIMITED") || chain[idx].name === "Groq"; // Groq tool-call hiccups also fall through
        if (canFallback && fallbackOk && idx < chain.length - 1) {
          await log({ kind: "model_text", name: "switch", text: `${chain[idx].name} failed: ${msg.slice(0, 200)}` });
          chain[idx].blockedUntil = now() + BLOCK_MS;
          idx = chain.findIndex((p, i) => i > idx && p.blockedUntil <= now());
          llm = chain[idx].llm;
          turn--;
          continue;
        }
        throw e;
      }
      contents.push(res.content);
      if (!res.functionCalls.length) {
        if (res.text) await log({ kind: "model_text", text: stripVitals(res.text) });
        break;
      }
      const responseParts: Part[] = [];
      for (const fc of res.functionCalls) {
        const args = (fc.args ?? {}) as Record<string, unknown>;
        await log({ kind: "tool_call", name: fc.name, args: safeToolArgs(fc.name!, args) });
        const result = await executeTool(ctx, fc.name!, args);
        await log({ kind: "tool_result", name: fc.name, result: summarize(result) });
        responseParts.push({ functionResponse: { name: fc.name, response: result as Record<string, unknown> } });
      }
      contents.push({ role: "user", parts: responseParts });
      if (ctx.added.length) {
        // One more turn lets the model close out, but we already have what we need.
        break;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    await log({ kind: "error", text: error });
  }

  if (idx > 0 && chain[0].name !== "custom") await log({ kind: "model_text", name: "backup", text: chain[idx].name });
  await log({ kind: "model_text", name: "engine", text: chain[idx].name }); // which model actually answered (shown only with ?dev)
  if (!ctx.added.length && !ctx.skipped && !error && trigger !== "new_input") error = "The DJ did not queue a track.";
  if (!error) await store.updateRoom(code, { dj_seen_ts: seenUpTo });
  // Human-readable decision log (what the UI shows); the raw tool calls stay in the trace for the optional dev view.
  for (const r of ctx.removed) await log({ kind: "decision", name: "removed", result: { song: r.song, artist: r.artist } });
  if (ctx.skippedItem) await log({ kind: "decision", name: "skipped", result: ctx.skippedItem });
  for (const item of ctx.added) {
    await log({
      kind: "decision",
      name: "queued",
      result: { queue_id: item.id, song: item.song, artist: item.artist, reason: item.reason, influenced_by: item.influenced_by, evidence: item.physiological_evidence.summary },
    });
  }
  const trace = publicTrace(await store.listTrace(code, startedAt - 1));
  return { added: ctx.added, skipped: ctx.skipped, trace, error };
}

/** Keep trace payloads small (e.g. drop huge arrays) so the UI stays readable. */
function summarize(result: unknown): unknown {
  const s = JSON.stringify(result);
  return s.length > 2500 ? { truncated: s.slice(0, 2500) + "…" } : result;
}
