# 3-minute demo script

**Before (5 min):** open the Render URL to wake it, create a room, open the host screen full-screen, press **start the night**. Add `?dev` to the host URL once to confirm "answered by Gemini" in the dj brain, then remove it. Keep the host tab in the foreground and the laptop awake.

1. **Hook (15s):** "A DJ that reads the room. Everyone tells it the vibe; it listens, and it explains every choice."
2. **Join (20s):** judge scans the QR. They type a vibe, add a photo, or record a voice note.
3. **Watch it react (30s):** their input appears as a card around the record; the dj brain shows the decision; point at **why this one** ("A's photo said golden hour, B asked for summer…") and the highlighted input that shaped it.
4. **Genre + artists (20s):** add an artist ("Kendrick Lamar"). Show it alternate between that artist and similar ones, and never repeat a song.
5. **The heartbeat moment (45s):** a guest opens the **pulse** tab, opts in, scans for 20 seconds. The DJ reacts to the reading (the room sees only "energy rising", never a number). Say plainly which scan it was: browser estimate, or Presage via the iPhone app.
6. **Under the hood (20s):** dj brain → "show raw tool calls": Gemini calling `get_vitals_trend`, `get_queue`, `update_queue`.
7. **Close (10s):** voice announcement, "who's been heard" fairness, night recap.

**If something breaks:** Gemini rate-limited → the DJ keeps playing on the fallback engines; YouTube quota → songs still queue with a timer card; camera blocked → skip the pulse step and show the app code and bridge instead.
