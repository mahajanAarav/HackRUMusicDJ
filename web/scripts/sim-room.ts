/**
 * Drives the whole loop with no UI or phone:
 *   npx tsx scripts/sim-room.ts ["vibe text"] [songs=4]
 * Uses the real Gemini if GEMINI_API_KEY is set (and MOCK_LLM is not), otherwise MockLlm.
 * Vitals are simulated; the clock is fast-forwarded through each song.
 */
import { advance } from "../lib/clock";
import { MemoryStore } from "../lib/db/memory";
import { startNext, endCurrent } from "../lib/dj/playback";
import { defaultLlm, runDj } from "../lib/gemini/agent";
import { getRoomEnergy } from "../lib/vitals/source";

const vibe = process.argv[2] ?? "Late-night dance floor, something with a big drop";
const songs = Number(process.argv[3] ?? 4);
const SONG_SECONDS = 75;

async function main() {
  const store = new MemoryStore();
  const llm = defaultLlm();
  console.log(`LLM: ${llm.constructor.name}  vibe: ${vibe}\n`);
  const room = await store.createRoom("simulated");
  const ava = await store.addGuest(room.code, "Ava", { sensing: true });
  await store.addInput(room.code, { guest_id: ava.id, guest_name: "Ava", kind: "text", text: vibe });

  for (let i = 0; i < songs; i++) {
    const e = await getRoomEnergy(store, room.code);
    console.log(`#${i + 1} room: pulse ${e.pulse.current} (Δ${e.pulse.delta}) breathing ${e.breathing.current} valence ${e.valence.current} trend ${e.trend} arousal ${e.arousal_change}`);
    const res = await runDj(store, room.code, { trigger: i === 0 ? "start" : "next_song" });
    for (const t of res.trace) if (t.name === "switch") console.log(`   switch: ${t.text}`);
    for (const t of res.trace) if (t.name === "backup") console.log(`   answered by: ${t.text}`);
    for (const t of res.trace) if (t.kind === "tool_call") console.log(`   tool: ${t.name}(${JSON.stringify(t.args).slice(0, 90)})`);
    if (res.error) console.log("   ERROR:", res.error);
    for (const a of res.added) console.log(`   queued: ${a.song} - ${a.artist} (energy ${a.energy})\n   why: ${a.reason}`);
    await startNext(store, room.code);
    advance(SONG_SECONDS * 1000);
    const end = await endCurrent(store, room.code, "played");
    if (end?.impact) console.log(`   impact: score ${end.impact.score} Δpulse ${end.impact.delta.pulse?.toFixed(1)} Δbreath ${end.impact.delta.breathing?.toFixed(1)} (n=${end.impact.n_samples})\n`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
