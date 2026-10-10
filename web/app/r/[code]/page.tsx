"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Ambient } from "@/components/Ambient";
import { Cover } from "@/components/Cover";
import { Equalizer } from "@/components/Equalizer";
import { Camera, Heart, ImageIcon, Mic, Music, Sparkle } from "@/components/Icons";
import { useToast } from "@/components/Toast";
import { api, blobToWavB64, fileToJpegB64 } from "@/lib/client";
import { RppgMeter } from "@/lib/rppg";

type Snap = any;
type Guest = { id: string; name: string; sensing: boolean };
type Tab = "vibe" | "pulse" | "queue";

const QUICK = ["hype it up", "slow it down", "throwback", "surprise me", "hip-hop", "rock", "country", "latin", "lo-fi chill", "jazz", "edm drop", "more summer, less sad"];
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
        <div className="guest-app" style={{ paddingTop: 40 }}>
          <div className="logo" style={{ marginBottom: 30 }}><span className="logo-mark"><Music /></span> biofeedback dj</div>
          <div className="label dim">you’re joining</div>
          <h1 className="g-title">{roomName}</h1>
          <div className="box yellow col" style={{ gap: 12, animation: "pop .5s var(--ease) both" }}>
            <label className="label">what should we call you?</label>
            <input className="field" autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="your name" onKeyDown={(e) => e.key === "Enter" && name.trim() && document.getElementById("join-btn")?.click()} />
            <button id="join-btn" className="btn primary big" disabled={!name.trim() || sending} onClick={() => { setSending(true); run(async () => save(await api<Guest>(`/rooms/${code}/join`, { name }))).finally(() => setSending(false)); }}>
              {sending && <span className="spinner" />} join the room
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
  const COLORS = ["#f05a38", "#3a49ee", "#f2bf45", "#3dbb9b", "#f06dc7"];
  const myColor = COLORS[Math.max(0, (snap?.guests ?? []).filter((g: any) => !g.simulated).findIndex((g: any) => g.id === guest.id)) % COLORS.length];
  const addChip = (c: string) => setText((t) => (t.trim() ? `${t.trim()}, ${c}` : c));
  const sendText = () => add({ kind: "text", text }, "sent to the dj ✨").then(() => setText(""));
  const sendPhoto = async (f?: File) => { if (f) await add({ kind: "photo", mime: "image/jpeg", data_b64: await fileToJpegB64(f) }, "photo sent 📸"); };

  return (
    <div className="app">
      <Ambient song={playing ? `${playing.song} ${playing.artist}` : null} energy={playing?.energy ?? 0.4} />
      <div className="guest-app">
        <div className="g-head">
          <span className="dot-live" />
          <span className="grow ellipsis" style={{ fontWeight: 800, fontSize: 18 }}>{roomName}</span>
          <span className="small mut">you</span>
          <span className="avatar lg" style={{ background: myColor, color: myColor === "#3a49ee" ? "#fff" : "#14131c" }}>{guest.name[0]?.toUpperCase()}</span>
        </div>

        {playing && (
          <div className="box g-now" key={playing.id}>
            <Cover title={playing.song} videoId={playing.video_id} size={52} radius={8} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="label row" style={{ gap: 6 }}><Equalizer /> now playing</div>
              <div className="ellipsis" style={{ fontWeight: 800, fontSize: 17 }}>{playing.song}</div>
              <div className="small ellipsis">{playing.artist}</div>
            </div>
          </div>
        )}

        {/* ---------------- VIBE ---------------- */}
        {tab === "vibe" && (
          <div className="tab-pane col" style={{ gap: 14 }}>
            <h1 className="g-title" style={{ margin: "4px 0 0" }}>what’s the vibe?</h1>
            <div className="label">type it</div>
            <textarea className="field" rows={3} value={text} maxLength={300} placeholder="e.g. more summer, less sad" onChange={(ev) => setText(ev.target.value)} />
            <div className="quick">
              {QUICK.map((q, i) => <button key={q} style={{ animationDelay: `${i * 30}ms` }} onClick={() => addChip(q)}>{q}</button>)}
            </div>
            <div className="row" style={{ gap: 10, alignItems: "stretch" }}>
              <label className="media-btn blue grow">
                <Camera width={22} height={22} />snap photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={async (ev) => { await sendPhoto(ev.target.files?.[0]); ev.target.value = ""; }} />
              </label>
              <label className="media-btn teal grow">
                <ImageIcon width={22} height={22} />add photo
                <input type="file" accept="image/*" hidden onChange={async (ev) => { await sendPhoto(ev.target.files?.[0]); ev.target.value = ""; }} />
              </label>
              <button className="media-btn red grow" onClick={toggleVoice} style={rec ? { animation: "beat 1s infinite" } : undefined}>
                <Mic width={22} height={22} />{rec ? "stop & send" : "voice note"}
              </button>
            </div>
            {rec && <div className="small" style={{ color: "var(--err)", fontWeight: 700 }}>● recording… tap again to send (max 15s)</div>}
            <button className="send-btn" disabled={!text.trim()} onClick={sendText}>send to the dj</button>

            <div className="box col" style={{ gap: 10 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>artists you want to hear</div>
                <div className="small mut">the dj plays them when they fit, plus artists that sound like them.</div>
              </div>
              <div className="row">
                <input className="field grow" value={artistText} maxLength={120} placeholder="e.g. drake, doja cat" onChange={(ev) => setArtistText(ev.target.value)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" && artistText.trim()) add({ kind: "artist", text: artistText }, "artist added 🎤").then(() => setArtistText("")); }} />
                <button className="btn yellow" disabled={!artistText.trim()} onClick={() => add({ kind: "artist", text: artistText }, "artist added 🎤").then(() => setArtistText(""))}>add</button>
              </div>
              {roomArtists.length > 0 && (
                <div className="row wrap" style={{ gap: 6 }}>
                  {roomArtists.map((a: any) => <span className={`chip ${a.guest_id === guest.id ? "acc" : ""}`} key={a.id} style={{ animation: "pop .4s var(--ease) both" }}>🎤 {a.text}{a.guest_id !== guest.id && <span className="dim"> · {a.guest_name}</span>}</span>)}
                </div>
              )}
            </div>

            {mine.length > 0 && (
              <div className="col" style={{ gap: 6 }}>
                <div className="label dim">you’ve told the dj</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {mine.slice(-6).map((i: any) => <span className="chip acc" key={i.id} style={{ animation: "pop .4s var(--ease) both" }}>{i.kind === "text" ? i.text : i.kind === "artist" ? `🎤 ${i.text}` : i.kind === "photo" ? "📸 photo" : "🎙️ voice note"}</span>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------- PULSE ---------------- */}
        {tab === "pulse" && (
          <div className="tab-pane col" style={{ gap: 14 }}>
            <div>
              <h1 className="g-title" style={{ margin: "4px 0 6px" }}>pulse check</h1>
              <p className="mut">look at the phone for {PULSE_SECONDS} seconds. the dj reacts to your reading.</p>
            </div>

            <div className="box row" style={{ gap: 14 }}>
              <button className={`switch ${sensing ? "on" : ""}`} aria-label="opt in to sensing" onClick={() => run(async () => void (await api(`/rooms/${code}/consent`, { guest_id: guest.id, sensing: !sensing })), sensing ? "sensing off" : "sensing on")} />
              <div className="grow">
                <div style={{ fontWeight: 800 }}>share my vitals</div>
                <div className="tiny mut">pulse and breathing numbers only, and only while you scan. video never leaves your phone and is never stored.</div>
              </div>
            </div>
            {sensing && !camOn && <div className="sense-banner"><span className="live-dot" /> sensing is on · readings only, no video stored</div>}
            {camOn && <div className="sense-banner"><span className="live-dot" /> camera is on · only numbers are sent, no video is recorded</div>}

            <div className="pulse-stage">
              {pc !== null && <><i className="pulse-ring" /><i className="pulse-ring" /><i className="pulse-ring" /></>}
              <svg className="countdown" viewBox="0 0 190 190">
                <circle className="bg" cx="95" cy="95" r="88" />
                {pc !== null && <circle className="fg" cx="95" cy="95" r="88" strokeDasharray={circ} strokeDashoffset={circ * (1 - (PULSE_SECONDS - pc) / PULSE_SECONDS)} />}
              </svg>
              <div className={`cam-circle ${camOn ? "on" : ""}`}><video ref={videoRef} muted playsInline /></div>
              <button className={`pulse-btn ${pc !== null ? "running" : ""} ${camOn ? "over-cam" : ""}`} disabled={!sensing || pc !== null} onClick={pulseCheck}>
                {pc === null ? <div><Heart width={34} height={34} className="heart" /><div style={{ marginTop: 4 }}>{sensing ? "start" : "opt in first"}</div></div> : <div style={{ fontSize: 34 }}>{liveBpm ? <>{Math.round(liveBpm)}<div style={{ fontSize: 11, opacity: .8 }}>bpm · {pc}s</div></> : pc}</div>}
              </button>
            </div>
            {pc !== null && camOn && <p className="small mut" style={{ textAlign: "center" }}>fill the oval with your face, face a light, and hold still.</p>}

            {pcOut && (
              <div className="box col" style={{ animation: "pop .5s var(--ease) both" }}>
                <div className="label dim">your reading</div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="vital"><div className="tiny mut">pulse</div><b><AnimatedNumber value={pcOut.result.pulse_bpm} /></b><span className="tiny dim">bpm</span></div>
                  <div className="vital"><div className="tiny mut">breathing</div><b><AnimatedNumber value={pcOut.result.breathing_rpm} decimals={1} /></b><span className="tiny dim">rpm</span></div>
                </div>
                {pcOut.dj?.added?.[0] && (
                  <div className="row" style={{ gap: 12, marginTop: 4 }}>
                    <Cover title={pcOut.dj.added[0].song} videoId={pcOut.dj.added[0].video_id} size={48} />
                    <div style={{ minWidth: 0 }}><div className="label" style={{ color: "var(--red)" }}><Sparkle width={11} height={11} /> the dj reacted</div><div style={{ fontWeight: 800 }}>{pcOut.dj.added[0].song}</div><div className="small mut">{pcOut.dj.added[0].reason}</div></div>
                  </div>
                )}
                {pcOut.dj?.error && !pcOut.dj?.added?.length && <div className="small" style={{ color: "var(--warn)" }}>reading saved, but the dj couldn’t respond right now.</div>}
              </div>
            )}
          </div>
        )}

        {/* ---------------- QUEUE ---------------- */}
        {tab === "queue" && (
          <div className="tab-pane col" style={{ gap: 12 }}>
            <div>
              <h1 className="g-title" style={{ margin: "4px 0 6px" }}>up next</h1>
              <p className="mut">chosen by gemini from everyone’s vibes and pulse scans.</p>
            </div>
            {upcoming.length === 0 && <div className="small dim" style={{ padding: "12px 0" }}>nothing queued yet. add a vibe and the dj will pick.</div>}
            {upcoming.map((q, i) => {
              const yours = q.influenced_by.some((x: any) => myInputIds.has(x.input_id));
              return (
                <div key={q.id} className={`q-row ${yours ? "mine" : ""}`} style={{ animationDelay: `${i * 60}ms` }}>
                  <Cover title={q.song} videoId={q.video_id} size={52} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 800 }}>{q.song}</div>
                    <div className="small mut ellipsis">{q.artist}{q.artist_basis === "similar" ? ` · similar to ${q.similar_to ?? "a suggested artist"}` : q.artist_basis === "suggested" ? " · suggested artist" : ""}</div>
                    <div className="tiny dim">{q.reason}</div>
                    {yours && <span className="chip warn" style={{ marginTop: 4 }}><Sparkle width={10} height={10} /> picked because of you</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <nav className="tabbar">
        {([["vibe", "vibe", <Sparkle key="a" width={18} height={18} />], ["pulse", "pulse", <Heart key="b" width={18} height={18} />], ["queue", "queue", <Music key="c" width={18} height={18} />]] as [Tab, string, React.ReactNode][]).map(([t, label, icon]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{icon}{label}</button>
        ))}
      </nav>
      {toast.node}
    </div>
  );
}
