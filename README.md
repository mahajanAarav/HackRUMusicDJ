# Biofeedback DJ

A group DJ that reads the room. Presage senses, Gemini decides.

```bash
cd web && cp .env.example .env.local   # add GEMINI_API_KEY (optional keys: YOUTUBE_API_KEY, ELEVENLABS_*)
npm install
npm run sim              # CLI end-to-end loop, no UI/phone (MockLlm unless GEMINI_API_KEY set)
npm run dev              # http://localhost:3000 -> create room -> host screen -> scan QR on a phone
npm test
```

No keys needed to demo: MockLlm replaces Gemini, tracks are mock (timer playback), TTS falls back to browser speech.
For phones, set `NEXT_PUBLIC_BASE_URL` to your LAN IP or tunnel URL.

Status: see the end of the build notes in the chat. Storage is in-memory (`lib/db/memory.ts`) behind the `Store` interface;
`supabase/migrations/0001_init.sql` is the target schema.
