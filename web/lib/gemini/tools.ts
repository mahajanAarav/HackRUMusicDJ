import type { Store } from "../db/store";
import { endCurrent } from "../dj/playback";
import { stripVitals } from "../dj/privacy";
import { summarizeRatings } from "../dj/ratings";
import { repeatReason, usedList } from "../dj/repeats";
import { searchTrack } from "../music/youtube";
import type { QueueItem, Room } from "../types";
import { now } from "../clock";
import { computeRoomEnergy } from "../vitals/energy";
import { latestScans } from "../vitals/scans";
import { currentBaseline, syncVitals } from "../vitals/source";
import { QueueItemDraftSchema, queueItemJsonSchema } from "./schema";

export const functionDeclarations = [
  {
    name: "get_vitals_trend",
    description:
      "Smoothed vitals (pulse bpm, breathing rpm, expression valence) vs the pre-song baseline for the whole room or one guest, the trend direction, and the impact scores of recently played songs. Impact score is -1..1 progress toward the current mode's goal.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        window_seconds: { type: "integer", description: "Look-back window, default 30" },
        scope: { type: "string", enum: ["room", "guest"], description: "Default room" },
        guest_id: { type: "string", description: "Required when scope=guest" },
      },
    },
  },
  {
    name: "search_track",
    description: "Optional: preview playable matches for a song. update_queue already finds the video for you, so skip this unless you want to compare versions.",
    parametersJsonSchema: {
      type: "object",
      properties: { title: { type: "string" }, artist: { type: "string" } },
      required: ["title", "artist"],
    },
  },
  {
    name: "get_queue",
    description: "The now-playing track, upcoming queue, and recently played tracks (with their impact scores).",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "update_queue",
    description: "Add, remove, or move queued tracks. For add, pass the complete item.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "move"] },
        item: queueItemJsonSchema,
        queue_id: { type: "string", description: "Required for remove and move" },
        position: { type: "integer", description: "0-based index among upcoming tracks, for move" },
      },
      required: ["action"],
    },
  },
  {
    name: "skip_track",
    description: "Skip the now-playing track when it is working against the room's goal.",
    parametersJsonSchema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
] as const;

export const MAX_QUEUE = 4;

export interface ToolCtx {
  store: Store;
  room: Room;
  seenVideos: Map<string, { title: string; channel: string }>;
  added: QueueItem[];
  skipped: boolean;
  removed: { song: string; artist: string }[];
  skippedItem?: { song: string; artist: string; reason: string };
}

const brief = (q: QueueItem) => ({ queue_id: q.id, song: q.song, artist: q.artist, energy: q.energy, reason: q.reason });

export async function executeTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { store, room } = ctx;
  const code = room.code;
  try {
    switch (name) {
      case "get_vitals_trend": {
        const nowMs = now();
        await syncVitals(store, room, nowMs);
        const windowS = Math.min(300, Math.max(10, Number(args.window_seconds) || 30));
        let readings = await store.getReadings(code, nowMs - Math.max(windowS, 120) * 1000);
        if (args.scope === "guest") {
          if (!args.guest_id) return { error: "guest_id required when scope=guest" };
          readings = readings.filter((r) => r.guest_id === args.guest_id);
        }
        const energy = computeRoomEnergy(readings, { nowMs, windowS, baseline: await currentBaseline(store, room, nowMs) });
        const impacts = (await store.listImpacts(code)).slice(-5);
        const check = room.pulse_check?.result ? { guest_id: room.pulse_check.guest_id, ...room.pulse_check.result } : undefined;
        const { scans } = await latestScans(store, code, nowMs);
        return {
          energy,
          latest_scans: scans.length ? scans : "No guest has scanned their pulse yet. Do not claim any vitals; rely on guest inputs.",
          recent_song_impacts: impacts,
          latest_pulse_check: check,
        };
      }
      case "search_track": {
        const hits = await searchTrack(String(args.title ?? ""), String(args.artist ?? ""));
        hits.forEach((h) => ctx.seenVideos.set(h.video_id, { title: h.title, channel: h.channel }));
        return hits.length ? { results: hits } : { error: "No playable result; try a different song." };
      }
      case "get_queue": {
        const q = await store.listQueue(code);
        const impacts = await store.listImpacts(code);
        const ratings = summarizeRatings(await store.listRatings(code));
        const played = q.filter((x) => x.status === "played" || x.status === "skipped").slice(-6);
        return {
          never_repeat_these: usedList(q),
          now_playing: q.find((x) => x.status === "playing") ? { ...brief(q.find((x) => x.status === "playing")!), started_s_ago: Math.round((now() - q.find((x) => x.status === "playing")!.started_at!) / 1000) } : null,
          upcoming: q.filter((x) => x.status === "queued").map(brief),
          recently_played: played.map((x) => ({ ...brief(x), status: x.status, impact_score: impacts.find((i) => i.queue_id === x.id)?.score ?? null, guest_rating: ratings[x.id] ?? null })),
        };
      }
      case "update_queue": {
        const action = String(args.action);
        const queue = await store.listQueue(code);
        if (action === "add") {
          const parsed = QueueItemDraftSchema.safeParse(args.item);
          if (!parsed.success) return { error: "Invalid item", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
          const item = parsed.data;
          if (queue.filter((x) => x.status === "queued").length >= MAX_QUEUE) return { error: `Queue is full (${MAX_QUEUE} upcoming). Remove a stale track with update_queue(action="remove") first.` };
          if (!item.has_vocals) return { error: "Only songs with sung or rapped lyrics are allowed. Pick a song with vocals, not an instrumental." };
          const early = repeatReason(item, queue);
          if (early) return { error: early };
          // Never trust a model-supplied id: use one search_track returned, otherwise look the song up ourselves.
          let videoId = item.video_id && ctx.seenVideos.has(item.video_id) ? item.video_id : undefined;
          if (!videoId) {
            const hits = await searchTrack(item.song, item.artist);
            if (!hits.length) return { error: `No playable result for ${item.song} by ${item.artist}. Pick a different song.` };
            videoId = hits[0].video_id;
            hits.forEach((h) => ctx.seenVideos.set(h.video_id, { title: h.title, channel: h.channel }));
          }
          const late = repeatReason({ ...item, video_id: videoId }, queue); // same video under a different title
          if (late) return { error: late };
          // Privacy: nothing numeric about anyone's pulse or breathing is stored on a public-facing item.
          const safe = {
            ...item,
            video_id: videoId,
            reason: stripVitals(item.reason),
            announcement: stripVitals(item.announcement),
            physiological_evidence: { metric: item.physiological_evidence.metric, summary: stripVitals(item.physiological_evidence.summary) },
          };
          const added = await store.addQueueItem(code, safe);
          ctx.added.push(added);
          return { ok: true, queue_id: added.id };
        }
        const target = queue.find((x) => x.id === args.queue_id && x.status === "queued");
        if (!target) return { error: "queue_id not found among upcoming tracks" };
        if (action === "remove") {
          await store.updateQueueItem(code, target.id, { status: "skipped", ended_at: now() });
          ctx.removed.push({ song: target.song, artist: target.artist });
          return { ok: true };
        }
        if (action === "move") {
          const upcoming = queue.filter((x) => x.status === "queued").sort((a, b) => a.added_at - b.added_at).filter((x) => x.id !== target.id);
          upcoming.splice(Math.max(0, Math.min(upcoming.length, Number(args.position) || 0)), 0, target);
          const base = Math.min(...upcoming.map((x) => x.added_at));
          for (const [i, x] of upcoming.entries()) await store.updateQueueItem(code, x.id, { added_at: base + i });
          return { ok: true };
        }
        return { error: `Unknown action ${action}` };
      }
      case "skip_track": {
        const res = await endCurrent(store, code, "skipped");
        if (!res) return { error: "Nothing is playing" };
        ctx.skipped = true;
        ctx.skippedItem = { song: res.item.song, artist: res.item.artist, reason: String(args.reason ?? "") };
        return { ok: true, skipped: brief(res.item), reason: args.reason, impact_score: res.impact?.score ?? null };
      }
      default:
        return { error: `Unknown tool ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
