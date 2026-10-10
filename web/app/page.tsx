"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Dice, Heart, Sparkle, Wave } from "@/components/Icons";
import { api } from "@/lib/client";

const NAMES = ["Midnight Pulse", "Hour 18 Hype", "Heartbeat Lounge", "Sleepless Sessions", "The Cooldown", "Bass & Breath", "Pulse Palace", "Low Light Club", "Caffeine Disco", "Golden Hour Grid"];
const pick = () => NAMES[Math.floor(Math.random() * NAMES.length)];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState(() => pick());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [code, setCode] = useState(["", "", "", ""]);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  async function create() {
    setLoading(true);
    setErr("");
    try {
      const r = await api("/rooms", { name });
      router.push(`/r/${r.code}/host`);
    } catch (e) {
      setErr((e as Error).message);
      setLoading(false);
    }
  }

  const setBox = (i: number, v: string) => {
    const ch = v.replace(/[^a-z0-9]/gi, "").slice(-1).toUpperCase();
    setCode((c) => c.map((x, j) => (j === i ? ch : x)));
    if (ch && i < 3) boxes.current[i + 1]?.focus();
  };
  const joined = code.join("");

  return (
    <div className="app landing">
      <div className="orb" style={{ width: 420, height: 420, background: "var(--acc)", top: -120, left: -100 }} />
      <div className="orb" style={{ width: 380, height: 380, background: "var(--acc2)", bottom: -140, right: -80, animationDelay: "-6s" }} />

      <div className="landing-inner">
        <div>
          <div className="logo"><span className="logo-mark"><Wave /></span> Biofeedback DJ</div>
          <h1 className="hero-title">The DJ that <span className="grad-text">feels the room.</span></h1>
          <p className="mut" style={{ fontSize: 17, maxWidth: 440 }}>Guests drop a vibe in any genre. Pulse scans show how the room feels. Gemini picks every next song and tells you exactly why.</p>
          <div className="row wrap" style={{ marginTop: 20 }}>
            <span className="chip acc"><Heart width={13} height={13} /> Presage vitals</span>
            <span className="chip acc"><Sparkle width={13} height={13} /> Gemini agent</span>
            <span className="chip acc"><Wave width={13} height={13} /> ElevenLabs voice</span>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Host a room</div>
            <div className="row">
              <input className="field grow" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Name your room" />
              <button className="btn icon" title="Random name" onClick={() => setName(pick())}><Dice /></button>
            </div>
            <button className="btn primary big" style={{ width: "100%", marginTop: 14 }} disabled={loading || !name.trim()} onClick={create}>
              {loading ? <span className="spinner" /> : null} {loading ? "Creating…" : "Create room"}
            </button>
            {err && <p className="small" style={{ color: "var(--err)", marginTop: 8 }}>{err}</p>}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Join with a code</div>
            <div className="row">
              {code.map((c, i) => (
                <input
                  key={i}
                  ref={(el) => { boxes.current[i] = el; }}
                  className="field code-box"
                  value={c}
                  inputMode="text"
                  autoCapitalize="characters"
                  onChange={(e) => setBox(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !c && i > 0) boxes.current[i - 1]?.focus();
                    if (e.key === "Enter" && joined.length === 4) router.push(`/r/${joined}`);
                  }}
                  onPaste={(e) => {
                    const t = e.clipboardData.getData("text").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 4);
                    if (t) { e.preventDefault(); setCode([...t.padEnd(4, " ").split("").map((x) => x.trim())]); }
                  }}
                />
              ))}
              <button className="btn primary icon" style={{ width: 52, height: 52, flex: "0 0 52px" }} disabled={joined.length < 4} onClick={() => router.push(`/r/${joined}`)} aria-label="Join">→</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
