# Submission text (edit freely)

**Tagline:** A group DJ that reads the room.

**What it does:** Guests scan a QR code and tell the DJ the vibe with text, photos, voice notes, and favorite artists; anyone can opt in to a short camera pulse scan. Gemini, working as an agent with function calling, listens to everything and picks each next song in any genre, explaining which guest's input and which signal shaped it. ElevenLabs announces each track. The room only ever sees a qualitative "energy rising / settling", never anyone's heart rate.

**How we built it:** Next.js + TypeScript. Gemini multimodal input (images + audio + text), a five-tool agent loop, schema-validated structured output; server-side guardrails (no repeats, vocals only, privacy scrubbing); vitals smoothing with per-song baseline comparison; an in-browser pulse/breathing estimate, a tested Presage Physiology API client (disabled: the live API now needs locally preprocessed traces), and a SwiftUI shell + bridge ready for the native SmartSpectra SDK; ElevenLabs text-to-speech.

**Challenges:** Making noisy vitals useful (median + EMA smoothing, baselines); keeping pulse data private while still letting it steer the DJ; keeping the DJ alive through API rate limits with a model fallback chain; browsers can't run Presage's SDK, so we built a native bridge.

**Accomplishments:** End-to-end loop from guest input to explained song; 26 automated tests, including checks that fail if a heart-rate number leaks into public text or API responses.

**What's next:** Server-side autopilot with persistent rooms, Gemini Live hold-to-talk requests, ElevenLabs voice-note transcription, continuous Presage "pulse station" mode.

**Built with:** Gemini API, Presage SmartSpectra, ElevenLabs, YouTube Data API, Next.js, TypeScript, Groq (fallback)
