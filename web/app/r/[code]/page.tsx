"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Ambient } from "@/components/Ambient";
import { Cover } from "@/components/Cover";
import { Equalizer } from "@/components/Equalizer";
import { Camera, Heart, Mic, Music, Send, Sparkle } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { api, blobToWavB64, fileToJpegB64 } from "@/lib/client";
import { RppgMeter } from "@/lib/rppg";

type Snap = any;
type Guest = { id: string; name: string; sensing: boolean };
type Tab = "vibe" | "pulse" | "queue";

const QUICK = ["🔥 Hype me up", "🎤 Hip-hop", "🎸 Rock", "🤠 Country", "💃 Latin", "🎹 Lo-fi chill", "🎷 Jazz", "🎧 EDM drop", "🌧️ Slow it down", "🎉 Throwbacks", "☕ Caffeine in sound form", "🧘 Calm me down"];
const PULSE_SECONDS = 20;

export default function Guest({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const key = `bdj:${code}`;
  const [guest, setGuest] = useState<Guest | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [artistText, setArtistText] = useState("");
  const [snap, setSnap] = useState<Snap>(null);
  const [tab, setTab] = useState<Tab>("vibe");
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [sending, setSending] = useState(false);
  const [pc, setPc] = useState<number | null>(null);
  const [pcOut, setPcOut] = useState<any>(null);
  const chunks = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camOn, setCamOn] = useState(false);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setGuest(JSON.parse(s)); } catch {}
    setReady(true);
  }, [key]);

  const poll = useCallback(async () => {
    try { setSnap(await api(`/rooms/${code}`)); } catch (e) { toast.show((e as Error).message, "err"); }
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [poll]);

  const save = (g: Guest | null) => {
    setGuest(g);
    try { g ? localStorage.setItem(key, JSON.stringify(g)) : localStorage.removeItem(key); } catch {}
  };
  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    try { await fn(); if (okMsg) toast.show(okMsg); poll(); } catch (e) { toast.show((e as Error).message, "err"); }
  };

  const roomName = snap?.room?.name ?? `Room ${code}`;

  if (!ready) return null;

  if (!guest)
    return (
      <div className="app">
        <div className="guest-app" style={{ paddingTop: 48 }}>
          <div className="logo" style={{ marginBottom: 28 }}><span className="logo-mark"><Music /></span> Biofeedback DJ</div>
          <div className="eyebrow">You’re joining</div>
          <h1 className="room-title" style={{ margin: "6px 0 24px" }}>{roomName}</h1>
          <div className="card col" style={{ gap: 12, animation: "pop .5s var(--ease) both" }}>
            <label className="small mut">What should we call you?</label>
            <input className="field" autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Your name" onKeyDown={(e) => e.key === "Enter" && name.trim() && document.getElementById("join-btn")?.click()} />
            <button id="join-btn" className="btn primary big" disabled={!name.trim() || sending} onClick={() => { setSending(true); run(async () => save(await api<Guest>(`/rooms/${code}/join`, { name }))).finally(() => setSending(false)); }}>
              {sending && <span className="spinner" />} Join the room
            </button>
          </div>
          {toast.node}
        </div>
      </div>
    );

  const sensing = !!snap?.guests?.find((g: any) => g.id === guest.id)?.sensing;
  const queue: any[] = snap?.queue ?? [];
  const playing = queue.find((q) => q.status === "playing");
  const upcoming = queue.filter((q) => q.status === "queued");
  const mine = (snap?.inputs ?? []).filter((i: any) => i.guest_id === guest.id);
  const myInputIds = new Set(mine.map((i: any) => i.id));
  const roomArtists = (snap?.inputs ?? []).filter((i: any) => i.kind === "artist");
  const e = snap?.energy;

  const add = (body: object, okMsg = "Sent to the DJ ✨") => run(async () => void (await api(`/rooms/${code}/inputs`, { guest_id: guest.id, ...body })), okMsg);

  async function toggleVoice() {
    if (rec) return rec.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (ev) => chunks.current.push(ev.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        run(async () => {
          const data_b64 = await blobToWavB64(new Blob(chunks.current));
          await api(`/rooms/${code}/inputs`, { guest_id: guest!.id, kind: "voice", mime: "audio/wav", data_b64 });
        }, "Voice note sent 🎙️");
      };
      r.start();
      setRec(r);
      setTimeout(() => r.state === "recording" && r.stop(), 15000);
    } catch {
      toast.show(window.isSecureContext ? "Microphone permission denied. Allow it in your browser settings." : "Mic needs HTTPS. Open the room through the https tunnel link the host shares.", "err");
    }
  }

  /** Webcam pulse check: samples the forehead for 20 s in the browser, sends only the resulting numbers. */
  async function pulseCheck() {
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(window.isSecureContext ? "This browser has no camera access." : "Camera needs HTTPS. Open the room through the https tunnel link the host shares.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch {
        throw new Error("Camera blocked. Allow camera access for this site (it needs HTTPS on phones).");
      }
      setCamOn(true);
      await new Promise((r) => setTimeout(r, 50));
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      await api(`/rooms/${code}/pulse-check`, { guest_id: guest!.id, action: "start" });
      setPcOut(null);
      setLiveBpm(null);

      const meter = new RppgMeter();
      let raf = 0;
      const loop = () => { meter.sample(video); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
      for (let s = PULSE_SECONDS; s > 0; s--) {
        setPc(s);
        await new Promise((r) => setTimeout(r, 1000));
        if (s <= PULSE_SECONDS - 8 && s % 2 === 0) {
          const est = meter.analyze(12);
          setLiveBpm(est.pulse_bpm);
          if (est.pulse_bpm != null && s % 4 === 0) {
            // feed the room a real reading every few seconds while this guest is scanning
            api(`/rooms/${code}/vitals`, { guest_id: guest!.id, timestamp: new Date().toISOString(), pulse_bpm: est.pulse_bpm, breathing_rpm: est.breathing_rpm, expression: null, confidence: est.confidence, source: "webcam" }).catch(() => {});
          }
        }
      }
      cancelAnimationFrame(raf);
      setPc(0);
      stream.getTracks().forEach((t) => t.stop()); // camera off immediately; nothing was recorded
      stream = null;
      setCamOn(false);
      const m = meter.analyze();
      if (m.pulse_bpm == null) {
        toast.show("Couldn't get a clean reading. Face a light, hold still, and fill the oval.", "err");
        return;
      }
      setPcOut(await api(`/rooms/${code}/pulse-check`, { guest_id: guest!.id, action: "finish", measured: m }));
      poll();
    } catch (er) {
      toast.show((er as Error).message, "err");
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setCamOn(false);
      setPc(null);
      setLiveBpm(null);
    }
  }

  const circ = 2 * Math.PI * 88;

  return (
    <div className="app">
      <Ambient song={playing ? `${playing.song} ${playing.artist}` : null} energy={playing?.energy ?? 0.4} />
      <div className="guest-app">
        <div className="g-head">
          <span className="logo-mark" style={{ width: 38, height: 38, borderRadius: 12 }}><Music /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="eyebrow">Room · {code}</div>
            <div className="ellipsis" style={{ fontWeight: 800, fontSize: 18 }}>{roomName}</div>
          </div>
          <span className="chip">{guest.name}</span>
        </div>

        {playing && (
          <div className="g-now" key={playing.id}>
            <Cover title={playing.song} videoId={playing.video_id} size={56} radius={10} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="eyebrow row" style={{ gap: 6 }}><Equalizer /> Now playing</div>
              <div className="ellipsis" style={{ fontWeight: 800 }}>{playing.song}</div>
              <div className="small mut ellipsis">{playing.artist}</div>
            </div>
          </div>
        )}
        {playing && <p className="small mut" style={{ margin: "8px 4px 0" }}>“{playing.reason}”</p>}

        {/* ---------------- VIBE ---------------- */}
        {tab === "vibe" && (
          <div className="tab-pane col" style={{ marginTop: 18, gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>What’s the vibe?</h2>
              <p className="small mut">Tell the DJ with words, a photo, or your voice.</p>
            </div>
            <div className="quick">
              {QUICK.map((q, i) => <button key={q} style={{ animationDelay: `${i * 40}ms` }} onClick={() => add({ kind: "text", text: q })}>{q}</button>)}
            </div>
            <div className="card col" style={{ gap: 10 }}>
              <textarea className="field" rows={3} value={text} maxLength={300} placeholder="e.g. hour 18 and I need caffeine in sound form" onChange={(ev) => setText(ev.target.value)} />
              <div className="row">
                <button className="btn primary grow" disabled={!text.trim()} onClick={() => add({ kind: "text", text }).then(() => setText(""))}><Send width={16} height={16} /> Send</button>
                <label className="btn icon" style={{ cursor: "pointer" }} title="Photo">
                  <Camera />
                  <input type="file" accept="image/*" hidden onChange={async (ev) => { const f = ev.target.files?.[0]; if (f) add({ kind: "photo", mime: "image/jpeg", data_b64: await fileToJpegB64(f) }, "Photo sent 📸"); ev.target.value = ""; }} />
                </label>
                <button className={`btn icon ${rec ? "primary" : ""}`} onClick={toggleVoice} title="Voice note" style={rec ? { animation: "beat 1s infinite" } : undefined}><Mic /></button>
              </div>
              {rec && <div className="small" style={{ color: "var(--err)" }}><span className="live-dot" /> Recording… tap the mic to send (max 15s)</div>}
            </div>
            <div className="card col" style={{ gap: 10 }}>
              <div>
                <div style={{ fontWeight: 800 }}>Artists you want to hear</div>
                <div className="small mut">The DJ will play them when they fit, plus artists that sound like them.</div>
              </div>
              <div className="row">
                <input className="field grow" value={artistText} maxLength={120} placeholder="e.g. Drake, Doja Cat" onChange={(ev) => setArtistText(ev.target.value)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" && artistText.trim()) add({ kind: "artist", text: artistText }, "Artist added 🎤").then(() => setArtistText("")); }} />
                <button className="btn primary" disabled={!artistText.trim()} onClick={() => add({ kind: "artist", text: artistText }, "Artist added 🎤").then(() => setArtistText(""))}>Add</button>
              </div>
              {roomArtists.length > 0 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {roomArtists.map((a: any) => <span className={`chip ${a.guest_id === guest.id ? "acc" : ""}`} key={a.id} style={{ animation: "pop .4s var(--ease) both" }}>🎤 {a.text}{a.guest_id !== guest.id && <span className="dim"> · {a.guest_name}</span>}</span>)}
                </div>
              )}
            </div>
            {mine.length > 0 && (
              <div className="col" style={{ gap: 6 }}>
                <div className="eyebrow">You’ve told the DJ</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {mine.slice(-6).map((i: any) => <span className="chip acc" key={i.id} style={{ animation: "pop .4s var(--ease) both" }}>{i.kind === "text" ? i.text : i.kind === "artist" ? `🎤 ${i.text}` : i.kind === "photo" ? "📸 photo" : "🎙️ voice note"}</span>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------- PULSE ---------------- */}
        {tab === "pulse" && (
          <div className="tab-pane col" style={{ marginTop: 18, gap: 16 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>Pulse check</h2>
              <p className="small mut">Look at the phone for {PULSE_SECONDS} seconds. The DJ reacts to your reading.</p>
            </div>

            <div className="card row" style={{ gap: 14 }}>
              <button className={`switch ${sensing ? "on" : ""}`} aria-label="Opt in to sensing" onClick={() => run(async () => void (await api(`/rooms/${code}/consent`, { guest_id: guest.id, sensing: !sensing })), sensing ? "Sensing off" : "Sensing on")} />
              <div className="grow">
                <div style={{ fontWeight: 700 }}>Share my vitals</div>
                <div className="tiny mut">Pulse and breathing numbers only, and only while you scan. Video never leaves your phone and is never stored.</div>
              </div>
            </div>
            {sensing && <div className="sense-banner"><span className="live-dot" /> Sensing is ON · readings only, no video stored</div>}

            {camOn && <div className="sense-banner"><span className="live-dot" /> Camera is ON · only numbers are sent, no video is recorded</div>}

            <div className="pulse-stage">
              {pc !== null && <><i className="pulse-ring" /><i className="pulse-ring" /><i className="pulse-ring" /></>}
              <svg className="countdown" viewBox="0 0 190 190">
                <circle className="bg" cx="95" cy="95" r="88" />
                {pc !== null && <circle className="fg" cx="95" cy="95" r="88" strokeDasharray={circ} strokeDashoffset={circ * (1 - (PULSE_SECONDS - pc) / PULSE_SECONDS)} />}
              </svg>
              <div className={`cam-circle ${camOn ? "on" : ""}`}><video ref={videoRef} muted playsInline /></div>
              <button className={`pulse-btn ${pc !== null ? "running" : ""} ${camOn ? "over-cam" : ""}`} disabled={!sensing || pc !== null} onClick={pulseCheck}>
                {pc === null ? <div><Heart width={34} height={34} className="heart" /><div style={{ marginTop: 4 }}>{sensing ? "Start" : "Opt in first"}</div></div> : <div style={{ fontSize: 34 }}>{liveBpm ? <>{Math.round(liveBpm)}<div style={{ fontSize: 11, opacity: .8 }}>bpm · {pc}s</div></> : pc}</div>}
              </button>
            </div>
            {pc !== null && camOn && <p className="small mut" style={{ textAlign: "center" }}>Fill the oval with your face, face a light, and hold still.</p>}

            {pcOut && (
              <div className="card col" style={{ animation: "pop .5s var(--ease) both" }}>
                <div className="eyebrow">Your reading</div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="vital"><div className="tiny mut">Pulse</div><b><AnimatedNumber value={pcOut.result.pulse_bpm} /></b><span className="tiny dim">bpm</span></div>
                  <div className="vital"><div className="tiny mut">Breathing</div><b><AnimatedNumber value={pcOut.result.breathing_rpm} decimals={1} /></b><span className="tiny dim">rpm</span></div>
                </div>
                {pcOut.dj?.added?.[0] && (
                  <div className="row" style={{ gap: 12, marginTop: 4 }}>
                    <Cover title={pcOut.dj.added[0].song} videoId={pcOut.dj.added[0].video_id} size={48} />
                    <div style={{ minWidth: 0 }}><div className="tiny" style={{ color: "var(--acc)", fontWeight: 800 }}><Sparkle width={11} height={11} /> THE DJ REACTED</div><div style={{ fontWeight: 700 }}>{pcOut.dj.added[0].song}</div><div className="small mut">{pcOut.dj.added[0].reason}</div></div>
                  </div>
                )}
                {pcOut.dj?.error && !pcOut.dj?.added?.length && <div className="small" style={{ color: "var(--warn)" }}>Reading saved, but the DJ couldn’t respond right now.</div>}
              </div>
            )}
          </div>
        )}

        {/* ---------------- QUEUE ---------------- */}
        {tab === "queue" && (
          <div className="tab-pane col" style={{ marginTop: 18, gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em" }}>Up next</h2>
              <p className="small mut">Chosen by Gemini from everyone’s vibes and vitals.</p>
            </div>
            {e && <div className="row wrap"><span className="chip"><Heart width={11} height={11} className="heart" style={{ ["--beat" as string]: e.pulse?.current ? `${60 / e.pulse.current}s` : "1s" }} /> {e.pulse?.current ?? "–"} bpm</span><span className="chip">{e.trend === "rising" ? "▲ rising" : e.trend === "falling" ? "▼ falling" : "▬ steady"}</span></div>}
            {upcoming.length === 0 && <div className="small dim" style={{ padding: "12px 0" }}>Nothing queued yet. Add a vibe and the DJ will pick.</div>}
            {upcoming.map((q, i) => {
              const yours = q.influenced_by.some((x: any) => myInputIds.has(x.input_id));
              return (
                <div key={q.id} className={`q-row ${yours ? "mine" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
                  <Cover title={q.song} videoId={q.video_id} size={52} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 700 }}>{q.song}</div>
                    <div className="small mut ellipsis">{q.artist}</div>
                    <div className="tiny dim">{q.reason}</div>
                    {yours && <span className="chip acc" style={{ marginTop: 4 }}><Sparkle width={10} height={10} /> Picked because of you</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <nav className="tabbar">
        {([["vibe", "Vibe", <Sparkle key="a" width={20} height={20} />], ["pulse", "Pulse", <Heart key="b" width={20} height={20} />], ["queue", "Queue", <Music key="c" width={20} height={20} />]] as [Tab, string, React.ReactNode][]).map(([t, label, icon]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{icon}{label}</button>
        ))}
      </nav>
      {toast.node}
    </div>
  );
}
