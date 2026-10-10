import { randomUUID } from "node:crypto";
import { now } from "../clock";
import type { Guest, QueueItem, Room, SongImpact, TraceEvent, VibeInput, VitalsReading } from "../types";
import type { Store } from "./store";

interface RoomData {
  room: Room;
  guests: Guest[];
  inputs: VibeInput[];
  readings: VitalsReading[];
  queue: QueueItem[];
  impacts: SongImpact[];
  trace: TraceEvent[];
}

const MAX_READINGS = 6000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class MemoryStore implements Store {
  private rooms = new Map<string, RoomData>();

  private d(code: string): RoomData {
    const r = this.rooms.get(code.toUpperCase());
    if (!r) throw new Error(`Room ${code} not found`);
    return r;
  }

  async createRoom(mode: Room["mode"], source: Room["vitals_source"], name?: string) {
    let code = "";
    do code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    while (this.rooms.has(code));
    const room: Room = { code, name: name?.trim().slice(0, 40) || `Room ${code}`, mode, vitals_source: source, created_at: now() };
    this.rooms.set(code, { room, guests: [], inputs: [], readings: [], queue: [], impacts: [], trace: [] });
    return room;
  }
  async getRoom(code: string) {
    return this.rooms.get(code.toUpperCase())?.room ?? null;
  }
  async updateRoom(code: string, patch: Partial<Room>) {
    const d = this.d(code);
    d.room = { ...d.room, ...patch, code: d.room.code };
    return d.room;
  }

  async listGuests(code: string) {
    return this.d(code).guests;
  }
  async addGuest(code: string, name: string, opts: { simulated?: boolean; id?: string; sensing?: boolean } = {}) {
    const g: Guest = { id: opts.id ?? randomUUID(), name, sensing: opts.sensing ?? false, simulated: opts.simulated, joined_at: now() };
    this.d(code).guests.push(g);
    return g;
  }
  async updateGuest(code: string, id: string, patch: Partial<Guest>) {
    const g = this.d(code).guests.find((x) => x.id === id);
    if (!g) throw new Error("Guest not found");
    Object.assign(g, patch, { id });
    return g;
  }

  async listInputs(code: string) {
    return this.d(code).inputs;
  }
  async addInput(code: string, input: Omit<VibeInput, "id" | "created_at">) {
    const v: VibeInput = { ...input, id: randomUUID().slice(0, 8), created_at: now() };
    this.d(code).inputs.push(v);
    return v;
  }

  async addReadings(code: string, readings: VitalsReading[]) {
    const d = this.d(code);
    d.readings.push(...readings);
    if (d.readings.length > MAX_READINGS) d.readings.splice(0, d.readings.length - MAX_READINGS);
  }
  async getReadings(code: string, sinceMs: number) {
    return this.d(code).readings.filter((r) => Date.parse(r.timestamp) >= sinceMs);
  }

  async listQueue(code: string) {
    return this.d(code).queue;
  }
  async addQueueItem(code: string, item: Omit<QueueItem, "id" | "added_at" | "status">) {
    const q: QueueItem = { ...item, id: randomUUID().slice(0, 8), added_at: now(), status: "queued" };
    this.d(code).queue.push(q);
    return q;
  }
  async updateQueueItem(code: string, id: string, patch: Partial<QueueItem>) {
    const q = this.d(code).queue.find((x) => x.id === id);
    if (!q) throw new Error("Queue item not found");
    Object.assign(q, patch, { id });
    return q;
  }

  async listImpacts(code: string) {
    return this.d(code).impacts;
  }
  async addImpact(code: string, impact: SongImpact) {
    this.d(code).impacts.push(impact);
  }

  async listTrace(code: string, sinceTs = 0) {
    return this.d(code).trace.filter((t) => t.ts > sinceTs);
  }
  async addTrace(code: string, ev: Omit<TraceEvent, "id" | "ts">) {
    const t: TraceEvent = { ...ev, id: randomUUID().slice(0, 8), ts: now() };
    this.d(code).trace.push(t);
    return t;
  }
}
