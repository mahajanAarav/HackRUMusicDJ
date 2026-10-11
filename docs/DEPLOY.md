# Deploy (public https, so phones can use mic + camera)

Phones only allow microphone and camera on https pages. Deploying gives you that and removes the laptop from the loop.

## Render (simplest, no code changes)
1. Put the repo on GitHub (`.env.local` is git-ignored; never commit keys).
2. render.com -> New -> **Blueprint** -> pick the repo. It reads `render.yaml`.
3. When asked, paste your keys (GEMINI_API_KEY, GROQ_API_KEY, YOUTUBE_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID).
4. Open the `https://<your-service-name>.onrender.com` URL. Create a room there; the QR code uses that https URL.

Notes
- Free instances sleep after ~15 min idle (first load ~30 s) and wipe rooms on restart. Use the $7 Starter plan for demo day and warm it up beforehand.
- Keep exactly one instance: rooms are held in memory.
- YouTube Data API key: no referrer restriction needed (it is only called from the server).

## Vercel (needs a database)
Vercel runs many short-lived instances, so the in-memory store will lose rooms. Implement the `Store` interface (`web/lib/db/store.ts`) on Supabase using `supabase/migrations/0001_init.sql`, then deploy normally.
