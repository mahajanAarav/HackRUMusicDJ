"use client";
import { useState } from "react";

const PALETTE = ["#f2bf45", "#3a49ee", "#3dbb9b", "#f05a38", "#f06dc7"];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Album-art stand-in: the YouTube thumbnail for real videos, otherwise a flat color tile with the initial. */
export function Cover({ title, videoId, size = 48, radius = 8 }: { title: string; videoId?: string; size?: number; radius?: number }) {
  const [broken, setBroken] = useState(false);
  const real = videoId && !videoId.startsWith("mock:") && !broken;
  const bg = PALETTE[hash(title) % PALETTE.length];
  return (
    <div className="cover" style={{ width: size, height: size, borderRadius: radius, flex: `0 0 ${size}px`, background: bg, color: bg === "#3a49ee" ? "#fff" : "#14131c", fontSize: size * 0.4 }}>
      {real ? <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" onError={() => setBroken(true)} /> : <span>{title.trim().slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}
