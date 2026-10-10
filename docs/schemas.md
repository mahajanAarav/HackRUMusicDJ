# Contracts

Source of truth lives in code:

- Vitals payload: `web/lib/types.ts` (`VitalsReading`), validated in `web/app/api/rooms/[code]/vitals/route.ts`
- Queue item: `web/lib/gemini/schema.ts` (zod + JSON Schema)
- Gemini function declarations: `web/lib/gemini/tools.ts`
- `getRoomEnergy()`: `web/lib/vitals/source.ts`

## Vitals payload (iOS -> `POST /api/rooms/:code/vitals`)

```json
{
  "guest_id": "uuid-from-join",
  "timestamp": "2026-10-10T14:03:22.410Z",
  "pulse_bpm": 78.5,
  "breathing_rpm": 14.2,
  "expression": { "label": "positive", "valence": 0.4 },
  "confidence": 0.82,
  "source": "presage"
}
```
An array of these is also accepted. Guests who have not opted in are rejected with 403.

## Scoring

- Baseline: smoothed median of the 30 s before a song starts.
- Smoothing: sliding median (k=5) then EMA (alpha 0.4), per guest, then median across guests. Readings below 0.5 confidence are dropped.
- Song impact: in-song mean (skipping the first 10 s) minus baseline, reduced to a signed arousal change in -1..1:
  `0.7 * dPulse/10 + 0.3 * dBreathing/3` (positive = pulse/breathing rose, negative = fell).
  It is goal-free: there are no hype/wind-down modes. Gemini decides from the guests' inputs whether "up" or "down" was right.
- Repeats: the server rejects any song already queued/played/skipped (matching title variants, same video id) and any artist used in the last 4 tracks.

## Privacy of vitals
Pulse and breathing numbers are only visible to the guest who scanned and to the DJ model. Public API responses carry a qualitative
`feel` and per-song `effect` (lift / settle / steady). Public text (reason, announcement, evidence summary) is scrubbed of bpm/rpm figures,
and the DJ's logged tool calls and results are redacted.
