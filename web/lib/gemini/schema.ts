import { z } from "zod";

const kind = z.enum(["text", "photo", "voice", "artist"]);

export const QueueItemDraftSchema = z.object({
  song: z.string().min(1),
  artist: z.string().min(1),
  video_id: z.string().optional(), // resolved server-side when absent or unverified
  reason: z.string().min(1).max(280),
  influenced_by: z.array(z.object({ input_id: z.string(), guest_name: z.string().optional(), kind, note: z.string() })),
  physiological_evidence: z.object({
    metric: z.enum(["pulse", "breathing", "valence", "song_impact"]),
    baseline: z.number().optional(),
    current: z.number().optional(),
    delta: z.number().optional(),
    summary: z.string().min(1),
  }),
  announcement: z.string().min(1).max(90),
  energy: z.number().min(0).max(1),
  has_vocals: z.boolean(),
  artist_basis: z.enum(["suggested", "similar", "vibe"]).optional(),
  similar_to: z.string().optional(),
});

/** Same shape as above, as JSON Schema for the update_queue function declaration. */
export const queueItemJsonSchema = {
  type: "object",
  properties: {
    song: { type: "string" },
    artist: { type: "string" },
    video_id: { type: "string", description: "Optional. Leave it out: the server finds the playable video for song + artist." },
    reason: { type: "string", description: "One line a guest can read." },
    influenced_by: {
      type: "array",
      description: "Guest inputs that shaped this pick. Empty only if none did.",
      items: {
        type: "object",
        properties: {
          input_id: { type: "string" },
          guest_name: { type: "string" },
          kind: { type: "string", enum: ["text", "photo", "voice", "artist"] },
          note: { type: "string", description: "What in that input mattered" },
        },
        required: ["input_id", "kind", "note"],
      },
    },
    physiological_evidence: {
      type: "object",
      description: "The vitals fact that justifies the pick, using real numbers from get_vitals_trend.",
      properties: {
        metric: { type: "string", enum: ["pulse", "breathing", "valence", "song_impact"] },
        baseline: { type: "number" },
        current: { type: "number" },
        delta: { type: "number" },
        summary: { type: "string" },
      },
      required: ["metric", "summary"],
    },
    announcement: { type: "string", description: "Spoken aloud. MAX 10 words, e.g. \"Next up: Levels by Avicii.\" No explanation: the reason is shown on screen, never spoken." },
    energy: { type: "number", description: "Your estimate of the track's intensity: 0 = very calm, 1 = very intense." },
    has_vocals: { type: "boolean", description: "true only if the song has sung or rapped lyrics. Never pick instrumentals, classical, ambient, or lyric-free beats." },
    artist_basis: { type: "string", enum: ["suggested", "similar", "vibe"], description: "suggested = by an artist a guest named; similar = by an artist who sounds like a suggested one; vibe = chosen purely from the vibe." },
    similar_to: { type: "string", description: "When artist_basis is similar: the suggested artist this one resembles." },
  },
  required: ["song", "artist", "reason", "influenced_by", "physiological_evidence", "announcement", "energy", "has_vocals"],
} as const;
