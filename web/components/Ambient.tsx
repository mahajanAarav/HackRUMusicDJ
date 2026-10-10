"use client";

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

/** Slow, low-contrast color wash behind the UI. Its hue follows the playing song; its drift speeds up with the song's energy. */
export function Ambient({ song, energy }: { song: string | null; energy: number }) {
  const h = song ? hue(song) : 235;
  return (
    <div
      className="ambient"
      aria-hidden
      style={{ ["--sh" as string]: h, ["--drift" as string]: `${28 - energy * 14}s`, ["--glow" as string]: song ? 0.6 : 0.35 }}
    >
      <i /><i /><i />
    </div>
  );
}
