/** DJ voice. Returns null when no key is configured so callers can fall back gracefully. */
export async function speak(text: string): Promise<ArrayBuffer | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return null;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.05 } }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
  return res.arrayBuffer();
}
