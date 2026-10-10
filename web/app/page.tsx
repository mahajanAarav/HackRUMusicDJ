"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Dice, Heart, Sparkle, Wave } from "@/components/Icons";
import { api } from "@/lib/client";

const NAMES = ["midnight pulse", "hour 18 hype", "heartbeat lounge", "sleepless sessions", "the cooldown", "bass & breath", "pulse palace", "low light club", "caffeine disco", "golden hour grid"];
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
      <div className="landing-inner">
        <div>
          <div className="logo"><span className="logo-mark"><Wave /></span> biofeedback dj</div>
          <h1 className="hero-title">the dj that <span className="hl">feels the room.</span></h1>
          <p style={{ fontSize: 18, maxWidth: 440, fontWeight: 500 }} className="mut">guests drop a vibe in any genre. pulse scans show how the room feels. gemini picks every next song and tells you exactly why.</p>
          <div className="row wrap" style={{ marginTop: 22 }}>
            <span className="pill pink"><Heart width={13} height={13} /> pulse scans</span>
            <span className="pill yellow"><Sparkle width={13} height={13} /> gemini agent</span>
            <span className="pill teal"><Wave width={13} height={13} /> elevenlabs voice</span>
          </div>
        </div>

        <div className="col" style={{ gap: 22 }}>
          <div className="box yellow" style={{ padding: 20 }}>
            <div className="label" style={{ marginBottom: 10 }}>host a room</div>
            <div className="row">
              <input className="field grow" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="name your room" />
              <button className="btn icon" title="random name" onClick={() => setName(pick())}><Dice /></button>
            </div>
            <button className="btn primary big" style={{ width: "100%", marginTop: 14 }} disabled={loading || !name.trim()} onClick={create}>
              {loading ? <span className="spinner" /> : null} {loading ? "creating…" : "create room"}
            </button>
            {err && <p className="small" style={{ color: "var(--err)", marginTop: 8, fontWeight: 700 }}>{err}</p>}
          </div>

          <div className="box" style={{ padding: 20 }}>
            <div className="label" style={{ marginBottom: 10 }}>join with a code</div>
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
              <button className="btn blue icon" style={{ width: 54, height: 54, flex: "0 0 54px", fontSize: 22 }} disabled={joined.length < 4} onClick={() => router.push(`/r/${joined}`)} aria-label="join">→</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
