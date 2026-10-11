export type VitalsSourceKind = "simulated" | "live";
export type Metric = "pulse" | "breathing" | "valence";

/** Payload the iOS app POSTs (and the simulator emits). Fields are null when the SDK has no signal. */
export interface VitalsReading {
  guest_id: string;
  timestamp: string; // ISO 8601
  pulse_bpm: number | null;
  breathing_rpm: number | null;
  expression: { label: "positive" | "neutral" | "negative"; valence: number } | null;
  confidence: number; // 0..1
  source: "presage" | "simulated" | "webcam";
}

/** A guest's 1-5 rating of how well a song matched the vibe. One per guest per song (re-rating replaces it). */
export interface Rating {
  queue_id: string;
  guest_id: string;
  value: number;
  at: number;
}

export interface Guest {
  id: string;
  name: string;
  sensing: boolean;
  simulated?: boolean;
  joined_at: number;
}

export interface VibeInput {
  id: string;
  guest_id: string;
  guest_name: string;
  kind: "text" | "photo" | "voice" | "artist" | "decade"; // "artist": an artist name; "decade": a start year like "1990"
  text?: string;
  mime?: string;
  data_b64?: string; // photo (jpeg) or voice (wav); small, kept for Gemini multimodal input
  created_at: number;
}

export interface Influence {
  input_id: string;
  guest_name?: string;
  kind: "text" | "photo" | "voice" | "artist" | "decade";
  note: string;
}

export interface Evidence {
  metric: "pulse" | "breathing" | "valence" | "song_impact";
  baseline?: number;
  current?: number;
  delta?: number;
  summary: string;
}

/** What Gemini produces (see docs/schemas.md). */
export interface QueueItemDraft {
  song: string;
  artist: string;
  video_id: string;
  reason: string;
  influenced_by: Influence[];
  physiological_evidence: Evidence;
  announcement: string;
  energy: number; // 0 calm .. 1 intense
  /** Year the song was released; required when guests have suggested decades. */
  release_year?: number;
  /** The song has sung or rapped lyrics. Instrumentals are never played. */
  has_vocals: boolean;
  /** Why this artist: a guest suggested them, they sound like one that was suggested, or they simply fit the vibe. */
  artist_basis?: "suggested" | "similar" | "vibe";
  similar_to?: string; // the suggested artist this one resembles, when artist_basis = "similar"
}

export interface Triple {
  pulse: number | null;
  breathing: number | null;
  valence: number | null;
}

export interface QueueItem extends QueueItemDraft {
  id: string;
  status: "queued" | "playing" | "played" | "skipped";
  added_at: number;
  started_at?: number;
  ended_at?: number;
  baseline?: Triple;
}

export interface SongImpact {
  queue_id: string;
  song: string;
  artist: string;
  baseline: Triple;
  during: Triple;
  delta: Triple;
  /** Signed arousal change, -1..1: > 0 means pulse/breathing rose vs the pre-song baseline, < 0 means they fell. null = not enough data. */
  score: number | null;
  n_samples: number;
}

export type TraceKind = "trigger" | "tool_call" | "tool_result" | "model_text" | "decision" | "error";
export interface TraceEvent {
  id: string;
  ts: number;
  kind: TraceKind;
  name?: string;
  args?: unknown;
  result?: unknown;
  text?: string;
}

export interface RoomEnergy {
  /** Signed arousal change vs baseline, -1..1 (> 0 = pulse/breathing rising). */
  arousal_change: number | null;
  pulse: { baseline: number | null; current: number | null; delta: number | null };
  breathing: { baseline: number | null; current: number | null; delta: number | null };
  valence: { current: number | null };
  trend: "rising" | "falling" | "flat" | "unknown";
  n_guests_sensing: number;
  window_s: number;
}

export interface PulseCheck {
  guest_id: string;
  started_at: number;
  duration_s: number;
  result?: { pulse_bpm: number | null; breathing_rpm: number | null; valence: number | null; n_samples: number };
}

export interface Room {
  code: string;
  name: string;
  vitals_source: VitalsSourceKind;
  created_at: number;
  pulse_check?: PulseCheck;
  /** Newest guest input the DJ has already considered; anything newer is "pending". */
  dj_seen_ts?: number;
}
