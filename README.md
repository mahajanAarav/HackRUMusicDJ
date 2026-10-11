# Biofeedback DJ

**A group DJ that reads the room.** Guests scan a QR code and tell the DJ the vibe with text, photos and voice notes, name artists they like, and optionally scan their pulse with a camera. **Gemini**, acting as an agent, picks every next song and explains why. **ElevenLabs** announces each track. **Presage** pulse and breathing scans show how the room is responding.

Built for HackRU (Gemini track, plus Presage and ElevenLabs prizes).

## How it works
```
 phones (QR join)                 host screen (projector)
  text / photo / voice / artists    inputs as cards, now playing, "why this one"
  optional pulse scan                         ▲
        │                                     │ polling
        ▼                                     │
   Next.js API  ──►  Gemini agent loop  ──►  queue (YouTube embed)  ──►  ElevenLabs announcement
   (rooms in memory)   tools: get_vitals_trend, get_queue, search_track, update_queue, skip_track
```

### Gemini (the brain)
- **Multimodal in one call:** guests' text, photos (inline images) and voice notes (inline audio).
- **Function calling / agent loop** with five tools (`get_vitals_trend`, `get_queue`, `search_track`, `update_queue`, `skip_track`). Raw tool calls are visible on the host screen under "dj brain → show raw tool calls".
- **Structured output:** every queue item is schema-validated (song, artist, reason, which guest inputs influenced it, vitals evidence, energy, has_vocals, artist basis).
- **Judgment, not rules:** genre and mood come from guests; intensity comes from heartbeat scans and how earlier songs moved the room. Suggested artists alternate with similar artists. The DJ is told which guest has been heard least.
- **Guardrails enforced server-side:** no repeats (title variants, same video, artist cooldown), vocals only, private vitals never written into public text.
- **Fallbacks:** if Gemini is rate-limited, a Groq model and then an offline rule-based DJ keep the room playing (host screen with `?dev` shows which engine answered each pick).

### Presage (the heartbeat)
- Guests can opt in and scan; the backend smooths readings, takes a pre-song baseline, and scores each song's effect on the room.
- **Browser scan:** an in-browser estimate (our own remote-PPG code), clearly labeled as an estimate.
- **iPhone app (`ios/`):** a thin SwiftUI shell that hosts the site and runs the **Presage SmartSpectra SDK** natively via a JS bridge. See `ios/README.md`. Status is stated honestly in the app and on the page: scans from the app's test sensor are labeled "simulated", real SDK scans "measured with presage smartspectra".
- **Privacy:** opt-in with a visible indicator; only numbers are stored, never video; pulse/breathing figures are never shown publicly (the room sees "energy rising", not bpm).

### ElevenLabs (the voice)
- A short, understated announcement before each track ("Next up: …"), cached per track.

## Run it
```bash
cd web && cp .env.example .env.local   # add keys (all optional; it runs offline without them)
npm install
npm run dev          # http://localhost:3000  → create room → start the night → scan the QR
npm test             # 26 tests
npm run sim          # CLI: drive the whole DJ loop with simulated vitals
```
Keys: `GEMINI_API_KEY`, `GROQ_API_KEY` (fallback), `YOUTUBE_API_KEY` (search; 100 searches/day on the free quota, results are cached), `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`. Phones need **https** for mic and camera, so deploy (see `docs/DEPLOY.md`, `render.yaml`).

## Honest limitations
- Rooms live in memory (a restart or redeploy clears them); a Supabase schema is included but not wired in.
- No host login or per-guest tokens (fine for a hackathon room, not for production).
- The browser pulse scan is a rough estimate; the iPhone app is the accurate path.
- Song picks come from the model's own music knowledge; YouTube is used only for lookup and playback.

## Layout
`web/` Next.js app (API, DJ agent in `web/lib/gemini`, vitals math in `web/lib/vitals`) · `ios/` Presage app shell · `docs/` schemas, deploy, demo script · `supabase/` schema.
