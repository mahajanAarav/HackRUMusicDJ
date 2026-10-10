"use client";
import { useState } from "react";

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

/** Album-art stand-in: the YouTube thumbnail for real videos, otherwise a generated gradient tile. */
export function Cover({ title, videoId, size = 48, radius = 8 }: { title: string; videoId?: string; size?: number; radius?: number }) {
  const [broken, setBroken] = useState(false);
  const real = videoId && !videoId.startsWith("mock:") && !broken;
  const h = hue(title);
  return (
    <div
      className="cover"
      style={{
        width: size, height: size, borderRadius: radius, flex: `0 0 ${size}px`,
        background: `linear-gradient(135deg, hsl(${h} 75% 52%), hsl(${(h + 55) % 360} 70% 30%))`,
        fontSize: size * 0.38,
      }}
    >
      {real ? <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" onError={() => setBroken(true)} /> : <span>{title.trim().slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}
