export interface TrackHit {
  video_id: string;
  title: string;
  channel: string;
  playable: boolean; // false = mock id (no YOUTUBE_API_KEY); UI shows a placeholder and a timer
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Lookup only: Gemini decides *what* to play, this just finds a playable embed. */
export async function searchTrack(title: string, artist: string): Promise<TrackHit[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [{ video_id: `mock:${slug(artist)}-${slug(title)}`, title: `${title} (mock)`, channel: artist, playable: false }];

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
  if (!res.ok) throw new Error(`YouTube search failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { items?: { id: { videoId: string }; snippet: { title: string; channelTitle: string } }[] };
  return (data.items ?? []).map((i) => ({ video_id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle, playable: true }));
}
