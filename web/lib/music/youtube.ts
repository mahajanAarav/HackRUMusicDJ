import { normArtist, normTitle } from "../dj/repeats";

export interface TrackHit {
  video_id: string;
  title: string;
  channel: string;
  playable: boolean; // false = placeholder id (no key, or YouTube's daily quota is used up): the UI plays a timer instead
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const placeholder = (title: string, artist: string): TrackHit[] => [{ video_id: `mock:${slug(artist)}-${slug(title)}`, title: `${title} (no video)`, channel: artist, playable: false }];

// A YouTube search costs 100 of the 10,000 daily quota units, so each song is looked up once, and after a quota error we stop asking for a while.
const g = globalThis as unknown as { __bdjYtCache?: Map<string, TrackHit[]>; __bdjYtBlockedUntil?: number };
const cache = (g.__bdjYtCache ??= new Map());
const BLOCK_MS = 30 * 60_000;

/** Lookup only: Gemini decides *what* to play, this just finds a playable embed. Never throws on quota; degrades to a placeholder. */
export async function searchTrack(title: string, artist: string): Promise<TrackHit[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return placeholder(title, artist);

  const ck = `${normTitle(title)}|${normArtist(artist)}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  if (Date.now() < (g.__bdjYtBlockedUntil ?? 0)) return placeholder(title, artist);

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoCategoryId: "10", // Music
    maxResults: "3",
    q: `${artist} ${title} official audio`,
    key,
  }).toString();
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || /quota/i.test(body)) {
      g.__bdjYtBlockedUntil = Date.now() + BLOCK_MS;
      console.warn("[youtube] daily search quota reached; using timer playback for 30 minutes");
      return placeholder(title, artist);
    }
    throw new Error(`YouTube search failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { items?: { id: { videoId: string }; snippet: { title: string; channelTitle: string } }[] };
  const hits = (data.items ?? []).map((i) => ({ video_id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle, playable: true }));
  // Prefer the real song over instrumental / karaoke / backing-track uploads.
  const vocal = hits.filter((h) => !/instrumental|karaoke|backing track|no vocals|sin voz|piano version|\bcover\b/i.test(h.title));
  const out = vocal.length ? vocal : hits;
  if (out.length) cache.set(ck, out);
  return out;
}

export function resetYoutubeCache() {
  cache.clear();
  g.__bdjYtBlockedUntil = 0;
}
