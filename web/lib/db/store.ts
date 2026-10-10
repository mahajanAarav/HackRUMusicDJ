import type { Guest, QueueItem, Room, SongImpact, TraceEvent, VibeInput, VitalsReading, VitalsSourceKind } from "../types";

/** Persistence boundary. MemoryStore is the demo default; a Supabase impl slots in behind this. */
export interface Store {
  createRoom(source: VitalsSourceKind, name?: string): Promise<Room>;
  getRoom(code: string): Promise<Room | null>;
  updateRoom(code: string, patch: Partial<Room>): Promise<Room>;

  listGuests(code: string): Promise<Guest[]>;
  addGuest(code: string, name: string, opts?: { simulated?: boolean; id?: string; sensing?: boolean }): Promise<Guest>;
  updateGuest(code: string, id: string, patch: Partial<Guest>): Promise<Guest>;

  listInputs(code: string): Promise<VibeInput[]>;
  addInput(code: string, input: Omit<VibeInput, "id" | "created_at">): Promise<VibeInput>;

  addReadings(code: string, readings: VitalsReading[]): Promise<void>;
  /** Readings with timestamp >= sinceMs. Only readings are ever stored, never video. */
  getReadings(code: string, sinceMs: number): Promise<VitalsReading[]>;

  listQueue(code: string): Promise<QueueItem[]>;
  addQueueItem(code: string, item: Omit<QueueItem, "id" | "added_at" | "status">): Promise<QueueItem>;
  updateQueueItem(code: string, id: string, patch: Partial<QueueItem>): Promise<QueueItem>;

  listImpacts(code: string): Promise<SongImpact[]>;
  addImpact(code: string, impact: SongImpact): Promise<void>;

  listTrace(code: string, sinceTs?: number): Promise<TraceEvent[]>;
  addTrace(code: string, ev: Omit<TraceEvent, "id" | "ts">): Promise<TraceEvent>;
}
