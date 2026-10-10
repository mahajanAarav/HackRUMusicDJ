import type { Room, TraceEvent } from "../types";

/**
 * Pulse and breathing numbers are private to the DJ and to the guest who scanned. Anything shown to the room
 * (reasons, announcements, evidence lines, API snapshots) must stay qualitative. The prompt asks the model to
 * comply; this is the safety net.
 */
const NUM = String.raw`\d{1,3}(?:\.\d+)?`;
const PATTERNS = [
  new RegExp(String.raw`\b${NUM}\s*(?:bpm|rpm|beats?(?:\s+per\s+minute)?|breaths?(?:\s+per\s+minute)?)\b`, "gi"),
  new RegExp(String.raw`\b(?:pulse|heart\s*rate|heartbeat|breathing(?:\s+rate)?)\s*(?:rate\s*)?(?:of|at|is|was|to|=|:)?\s*${NUM}\b`, "gi"),
];

export function stripVitals(text: string): string {
  let t = text;
  for (const p of PATTERNS) t = t.replace(p, "");
  return t
    .replace(/\(\s*[,;]?\s*\)/g, "")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/\s*[,;]\s*\)/g, ")")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[,;]\s*([,;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Trace events safe to send to browsers: tool results that carry other guests' readings are redacted. */
export function publicTrace(trace: TraceEvent[]): TraceEvent[] {
  return trace.map((t) => (t.kind === "tool_result" && t.name === "get_vitals_trend" ? { ...t, result: { redacted: "vitals are private" } } : t));
}

/** Tool-call arguments as they are logged: the model's item may quote vitals, so scrub it like the stored item. */
export function safeToolArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name !== "update_queue" || !args.item || typeof args.item !== "object") return args;
  const item = args.item as Record<string, any>;
  const ev = item.physiological_evidence ?? {};
  return {
    ...args,
    item: {
      ...item,
      reason: typeof item.reason === "string" ? stripVitals(item.reason) : item.reason,
      announcement: typeof item.announcement === "string" ? stripVitals(item.announcement) : item.announcement,
      physiological_evidence: { metric: ev.metric, summary: typeof ev.summary === "string" ? stripVitals(ev.summary) : ev.summary },
    },
  };
}

/** The room as browsers see it: no pulse-check results, no internal bookkeeping. */
export function publicRoom(room: Room | null): Omit<Room, "pulse_check" | "dj_seen_ts"> | null {
  if (!room) return room;
  const { pulse_check: _p, dj_seen_ts: _d, ...rest } = room;
  return rest;
}
