"use client";
import { QRCodeSVG } from "qrcode.react";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { Ambient } from "@/components/Ambient";
import { Cover } from "@/components/Cover";
import { Equalizer } from "@/components/Equalizer";
import { Check, Copy, Heart, Mic, Play, Skip, Sparkle, Wave } from "@/components/Icons";
import { Segmented } from "@/components/Segmented";
import { useToast } from "@/components/Toast";
import { api } from "@/lib/client";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}
type Snap = any;

const TARGET_QUEUE = 2;
const GUEST_COLORS = ["#f05a38", "#3a49ee", "#f2bf45", "#3dbb9b", "#f06dc7"];
const fgFor = (bg: string) => (bg === "#3a49ee" ? "#fff" : "#14131c");
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 8 ? "now" : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };

const KIND_LABEL: Record<string, string> = { text: "typed a vibe", photo: "sent a photo", voice: "sent a voice note", artist: "suggested an artist" };
const KIND_TAG: Record<string, string> = { text: "typed", photo: "photo", voice: "voice note", artist: "artist" };
const KIND_COLOR: Record<string, string> = { text: "pink", photo: "red", voice: "blue", artist: "teal" };

function fmtArgs(name: string, args: any): string {
  if (!args) return "";
  if (name === "update_queue") return args.action === "add" ? `add "${args.item?.song ?? "?"}" by ${args.item?.artist ?? "?"}` : `${args.action} ${args.queue_id ?? ""}`;
  if (name === "search_track") return `"${args.title}" by ${args.artist}`;
  if (name === "skip_track") return args.reason ?? "";
  const e = Object.entries(args);
  return e.length ? e.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") : "";
}

export default function Host({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [snap, setSnap] = useState<Snap>(null);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clipS, setClipS] = useState(0); // 0 = play every song in full
  const [dev, setDev] = useState(false);
  const [time, setTime] = useState({ ct: 0, dur: 0, pct: 0 });
  const [err, setErr] = useState("");
  const [recap, setRecap] = useState("");
  const [base, setBase] = useState("");
  const [copied, setCopied] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [showTools, setShowTools] = useState(false);
  const [paused, setPaused] = useState(false);
  const [openTrace, setOpenTrace] = useState<Set<string>>(new Set());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const toast = useToast();

  const player = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlayed = useRef<string | null>(null);
  const busyRef = useRef(false);
  const failedAt = useRef(0);
  const cooldown = useRef(15000);
  const pendingVideo = useRef<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setBase(process.env.NEXT_PUBLIC_BASE_URL || window.location.origin);
    try { setPublicUrl(localStorage.getItem("bdj:public") ?? ""); } catch {}
    setDev(new URLSearchParams(window.location.search).has("dev"));
  }, []);
  const savePublic = (v: string) => { setPublicUrl(v); try { localStorage.setItem("bdj:public", v); } catch {} };
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 3000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 5000); return () => clearInterval(t); }, []);
  useEffect(() => { if (err) toast.show(err.replace(/^RATE_LIMITED: /, "gemini rate limit: "), "err"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps

  const poll = useCallback(async () => {
    try { setSnap(await api(`/rooms/${code}`)); } catch (e) { setErr((e as Error).message); }
  }, [code]);
  useEffect(() => {
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [poll]);

  const room = snap?.room;
  const queue: any[] = snap?.queue ?? [];
  const playing = queue.find((q) => q.status === "playing");
  const upcoming = queue.filter((q) => q.status === "queued");
  const history = queue.filter((q) => q.status === "played" || q.status === "skipped").reverse();
  const pending: number = snap?.pending_inputs ?? 0;

  const guarded = useCallback(async (fn: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (er) {
      failedAt.current = Date.now();
      cooldown.current = (er as Error).message.includes("RATE_LIMITED") ? 65000 : 15000;
      setErr((er as Error).message);
    } finally {
      await poll(); // refresh before releasing the lock so autopilot never acts on a stale queue
      busyRef.current = false;
      setBusy(false);
    }
  }, [poll]);

  const askDj = useCallback((trigger = "next_song") => guarded(() => api(`/rooms/${code}/dj/next`, { trigger })), [code, guarded]);
  const advance = useCallback((action: "next" | "skip" = "next") => guarded(() => api(`/rooms/${code}/queue/advance`, { action })), [code, guarded]);

  useEffect(() => {
    if (window.YT?.Player) return;
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(s);
  }, []);

  const speak = useCallback(async (item: any) => {
    try {
      const res = await fetch(`/api/rooms/${code}/announce`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queue_id: item.id }) });
      if (res.ok) {
        const audio = new Audio(URL.createObjectURL(await res.blob()));
        await new Promise<void>((resolve) => { audio.onended = () => resolve(); audio.onerror = () => resolve(); audio.play().catch(() => resolve()); });
      } else if ("speechSynthesis" in window) {
        await new Promise<void>((resolve) => { const u = new SpeechSynthesisUtterance(item.announcement); u.onend = () => resolve(); u.onerror = () => resolve(); speechSynthesis.speak(u); });
      }
    } catch {}
  }, [code]);

  // New track starts: announce it, then play it and arm the clip timer.
  useEffect(() => {
    if (!started || !playing || lastPlayed.current === playing.id) return;
    lastPlayed.current = playing.id;
    if (timer.current) clearTimeout(timer.current);
    (async () => {
      setAnnouncing(true);
      await speak(playing);
      setAnnouncing(false);
      if (!playing.video_id.startsWith("mock:")) {
        if (playerReady && player.current?.loadVideoById) player.current.loadVideoById(playing.video_id);
        else pendingVideo.current = playing.video_id; // loaded in onReady
      }
      const mock = playing.video_id.startsWith("mock:");
      const limit = clipS > 0 ? clipS : mock ? 180 : 0; // real videos end on their own (player 'ended' event)
      if (limit > 0) timer.current = setTimeout(() => advance("next"), limit * 1000);
      if (!mock) {
        // Safety net: if the video never starts (blocked or unavailable), move on instead of sitting silent.
        setTimeout(() => {
          const st = player.current?.getPlayerState?.();
          if (lastPlayed.current === playing.id && (st === -1 || st === 5)) advance("next");
        }, 30000);
      }
    })();
  }, [started, playing, speak, advance, clipS, playerReady]);

  // Autopilot: react to new guest input, keep the queue topped up, start the next track when idle.
  useEffect(() => {
    if (!started || paused || busy || Date.now() - failedAt.current < cooldown.current) return;
    if (!playing && upcoming.length) advance("next");
    else if (pending > 0 && (snap?.pending_age_ms ?? 0) >= 3000) askDj("new_input");
    else if (upcoming.length < TARGET_QUEUE) askDj(playing ? "next_song" : "start");
  }, [started, paused, busy, playing, upcoming.length, pending, snap?.pending_age_ms, advance, askDj, tick]);

  // Create the YouTube player once started and the IFrame API script has loaded.
  useEffect(() => {
    if (!started || player.current) return;
    const t = setInterval(() => {
      if (!window.YT?.Player || !document.getElementById("yt")) return;
      clearInterval(t);
      player.current = new window.YT.Player("yt", {
        width: "100%", height: "100%", playerVars: { playsinline: 1, rel: 0 },
        events: {
          onReady: () => { setPlayerReady(true); if (pendingVideo.current) player.current.loadVideoById(pendingVideo.current); },
          onStateChange: (ev: any) => ev.data === 0 && advance("next"),
          onError: () => advance("next"), // embedding disabled / removed video: skip it
        },
      });
    }, 300);
    return () => clearInterval(t);
  }, [started, advance]);

  // Progress: real playback position when the YouTube player knows it, otherwise elapsed time.
  useEffect(() => {
    if (!playing) { setTime({ ct: 0, dur: 0, pct: 0 }); return; }
    const mock = playing.video_id.startsWith("mock:");
    const t = setInterval(() => {
      const dur = !mock ? player.current?.getDuration?.() : 0;
      if (dur > 0 && clipS === 0) {
        const ct = player.current.getCurrentTime?.() ?? 0;
        setTime({ ct, dur, pct: Math.min(100, (ct / dur) * 100) });
      } else {
        const total = clipS > 0 ? clipS : 180;
        const ct = (Date.now() - playing.started_at) / 1000;
        setTime({ ct: Math.min(ct, total), dur: total, pct: Math.min(100, (ct / total) * 100) });
      }
    }, 500);
    return () => clearInterval(t);
  }, [playing?.id, clipS]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- derived ----------
  const origin = (publicUrl.trim() || base).replace(/\/+$/, "");
  const joinUrl = `${origin}/r/${code}`;
  const insecure = origin.startsWith("http://") && !/^http:\/\/localhost/.test(origin);
  const realGuests: any[] = (snap?.guests ?? []).filter((g: any) => !g.simulated);
  const inputs: any[] = snap?.inputs ?? [];
  const colorOf = (guestId: string) => GUEST_COLORS[Math.max(0, realGuests.findIndex((g) => g.id === guestId)) % GUEST_COLORS.length];
  const nameOf = (guestId: string) => realGuests.find((g) => g.id === guestId)?.name ?? "guest";
  const av = (id: string, lg = false) => <span key={id} className={`avatar ${lg ? "lg" : ""}`} style={{ background: colorOf(id), color: fgFor(colorOf(id)) }} title={nameOf(id)}>{nameOf(id)[0]?.toUpperCase()}</span>;
  const inputGuest = (inputId: string) => inputs.find((i) => i.id === inputId)?.guest_id as string | undefined;

  const stageInputs = [...inputs].reverse().slice(0, 4);
  const leftCards = stageInputs.filter((_, i) => i % 2 === 0);
  const rightCards = stageInputs.filter((_, i) => i % 2 === 1);
  const influencing = new Set<string>((playing?.influenced_by ?? []).map((x: any) => x.input_id));
  const influencingGuests = new Set<string>([...influencing].map((id) => inputGuest(id)).filter(Boolean) as string[]);
  const matchTag = !playing ? null : influencingGuests.size >= 2 ? { t: "bridge found", c: "yellow" } : influencingGuests.size === 1 ? { t: "vibe matched", c: "teal" } : { t: "dj's pick", c: "pink" };
  const guestsWithInput = new Set(inputs.map((i) => i.guest_id));

  // who's been heard: how many picks each guest's input shaped
  const heard = new Map<string, number>();
  for (const g of guestsWithInput) heard.set(g, 0);
  for (const q of queue) for (const g of new Set<string>((q.influenced_by ?? []).map((x: any) => inputGuest(x.input_id)).filter(Boolean) as string[])) heard.set(g, (heard.get(g) ?? 0) + 1);
  const heardList = [...heard.entries()];
  const maxHeard = Math.max(1, ...heard.values());
  const boost = heardList.length > 1 ? [...heardList].sort((a, b) => a[1] - b[1])[0] : null;

  const next = upcoming[0];
  const curE = Math.round((playing?.energy ?? 0) * 10);
  const nextE = Math.round((next?.energy ?? playing?.energy ?? 0) * 10);
  const tbars = Array.from({ length: 10 }, (_, i) => { const v = curE + ((nextE - curE) * i) / 9; return { h: 20 + (Math.max(0, v) / 10) * 80, hot: i >= 5 }; });
  const energyPts = queue.filter((q) => q.status !== "skipped").map((q) => q.energy as number).slice(-8);

  const LABELS: Record<string, string> = { start: "opening the night", next_song: "picking the next track", new_input: "reacting to a new vibe", pulse_check: "reacting to a pulse check" };
  const runs = (() => {
    const out: { id: string; label: string; items: any[]; error?: string; engine?: string }[] = [];
    for (const t of snap?.trace ?? []) {
      if (t.kind === "trigger") out.push({ id: t.id, label: LABELS[String(t.text).split(" ")[0]] ?? "deciding", items: [] });
      else if (out.length && t.kind === "decision") out[out.length - 1].items.push(t);
      else if (out.length && t.kind === "error") out[out.length - 1].error = t.text;
      else if (out.length && t.kind === "model_text" && t.name === "engine") out[out.length - 1].engine = t.text;
    }
    return out.reverse().slice(0, 6);
  })();
  // Heart-rate numbers never reach this screen: the room only sees a qualitative feel.
  const feel = snap?.feel as { n: number; trend: string } | undefined;
  const feelText = !feel?.n ? "no scans yet" : feel.trend === "rising" ? "energy rising" : feel.trend === "falling" ? "settling down" : feel.trend === "flat" ? "holding steady" : "reading the room";
  const impactText = (imp: any) => (imp?.effect === "lift" ? "↑ lifted the room" : imp?.effect === "settle" ? "↓ settled the room" : imp?.effect === "steady" ? "→ held steady" : null);
  const toggleTrace = (id: string) => setOpenTrace((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const vibesIn = inputs.length;

  const inputCard = (i: any) => {
    const color = KIND_COLOR[i.kind] ?? "pink";
    return (
      <div key={i.id} className={`in-card ${color} ${influencing.has(i.id) ? "traced" : ""}`} title={influencing.has(i.id) ? "shaped the current pick" : undefined}>
        <div className="row" style={{ gap: 8 }}>
          {av(i.guest_id)}
          <span className="label">{KIND_LABEL[i.kind]}</span>
        </div>
        {i.kind === "photo" && <div className="in-img" style={{ marginTop: 8 }}><img src={`/api/rooms/${code}/media/${i.id}`} alt="guest photo" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} /></div>}
        {i.kind === "voice" && <div className="bars-wave" style={{ marginTop: 10 }}>{Array.from({ length: 18 }, (_, k) => <i key={k} style={{ animationDelay: `${(k % 6) * 0.12}s`, animationDuration: `${0.8 + (k % 5) * 0.15}s` }} />)}</div>}
        {(i.kind === "text" || i.kind === "artist") && <div className="quote">{i.kind === "text" ? `“${i.text}”` : i.text}</div>}
        <div className="by">{nameOf(i.guest_id)} · {ago(nowTick - i.created_at)}</div>
      </div>
    );
  };

  return (
    <div className="app">
      <Ambient song={playing ? `${playing.song} ${playing.artist}` : null} energy={playing?.energy ?? 0.4} />
      <div className="host-wrap">
        <div className="host-top">
          <div className="row" style={{ gap: 10 }}>
            <span className="dot-live" />
            <span style={{ fontWeight: 800, fontSize: 18 }}>live · {room?.name ?? "…"}</span>
            <span className="pill sm">room {code}</span>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="pill">{vibesIn === 0 ? "waiting for the first vibe" : vibesIn === 1 ? "1 vibe in · the room fills in the rest" : `${vibesIn} vibes in`}</span>
          </div>
        </div>

        <div className="host-grid">
          {/* ================= main column ================= */}
          <div className="col" style={{ gap: 22 }}>
            <div className="stage">
              <div className="stage-side">
                {leftCards.length ? leftCards.map((i) => inputCard(i)) : <div className="in-card yellow"><span className="label">waiting</span><div className="quote">drop a vibe from your phone</div></div>}
              </div>

              <div className="art-outer">
                {matchTag && <span className={`pill ${matchTag.c} tag-float label`} style={{ fontSize: 12, padding: "5px 12px" }} key={playing?.id}>{matchTag.t}</span>}
                <div className={`art-wrap ${playing ? "playing" : ""}`}>
                  <div className="vinyl"><i /></div>
                  <div className="art">{playing ? <Cover title={playing.song} videoId={playing.video_id} size={240} radius={0} /> : <span className="label dim">album art</span>}</div>
                </div>
              </div>

              <div className="stage-side">
                {rightCards.map((i) => inputCard(i))}
                <div className="in-card teal">
                  <div className="row" style={{ gap: 8 }}><Heart width={16} height={16} className="heart" /><span className="label">room feel</span></div>
                  <div className="quote" style={{ fontSize: feel?.n ? 19 : 16 }}>{feelText}</div>
                  <div className="by">{feel?.n ? `${feel.n} guest${feel.n > 1 ? "s" : ""} scanned` : "scan from the pulse tab"}</div>
                </div>
              </div>
            </div>

            {/* now playing */}
            <div>
              <div className="label dim">now playing</div>
              <div className="np-title">{playing?.song ?? (started ? (busy ? "picking the first track…" : "warming up…") : "press start")}</div>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="mut" style={{ fontSize: 17, fontWeight: 600 }}>{playing?.artist ?? "—"}</span>
                {playing?.artist_basis === "suggested" && <span className="pill sm teal">🎤 suggested artist</span>}
                {playing?.artist_basis === "similar" && <span className="pill sm yellow">≈ similar to {playing.similar_to ?? "a suggested artist"}</span>}
                {playing && <Equalizer active size={16} />}
              </div>

              <div className="np-row">
                <div className="col" style={{ gap: 14 }}>
                  <div className="progress">
                    <div className="track"><i style={{ width: `${time.pct}%` }} /></div>
                    <span className="mono small">{fmt(time.ct)} / {time.dur ? fmt(time.dur) : "–:––"}</span>
                  </div>
                  <div className="row wrap" style={{ gap: 10 }}>
                    {!started ? (
                      <button className="btn primary big" onClick={() => setStarted(true)}><Play width={18} height={18} /> start the night</button>
                    ) : (
                      <>
                        <button className="btn" disabled={busy || !playing} onClick={() => advance("skip")}><Skip width={16} height={16} /> skip</button>
                        <button className="btn" disabled={busy} onClick={() => askDj()}>{busy ? <span className="spinner" /> : <Sparkle width={16} height={16} />} ask dj</button>
                        <button className={`btn ghost ${paused ? "yellow" : ""}`} onClick={() => setPaused((v) => !v)} title="stop the dj from making requests on its own">{paused ? "▶ resume ai" : "⏸ pause ai"}</button>
                      </>
                    )}
                    <label className="small row" style={{ gap: 6 }}>play
                      <select className="field" value={clipS} onChange={(ev) => setClipS(Number(ev.target.value))} style={{ width: 120, padding: "6px 8px" }}>
                        <option value={0}>full songs</option><option value={30}>30s clips</option><option value={60}>60s clips</option><option value={90}>90s clips</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="player">
                  {started ? <div id="yt" /> : null}
                  {(!started || !playing || announcing || playing.video_id.startsWith("mock:")) && (
                    <div className="player-overlay">
                      {playing && announcing ? (
                        <div className="col" style={{ alignItems: "center", gap: 8 }}><Mic width={26} height={26} /><div style={{ fontWeight: 800 }}>the dj is announcing…</div><div className="small" style={{ maxWidth: 240 }}>{playing.announcement}</div></div>
                      ) : playing?.video_id.startsWith("mock:") ? (
                        <div><div style={{ fontWeight: 800, fontSize: 18 }}>{playing.song}</div><div>{playing.artist}</div><div className="small" style={{ marginTop: 6 }}>no video available · timer playback</div></div>
                      ) : (
                        <div><Wave width={30} height={30} /><div style={{ marginTop: 4 }}>{started ? (err ? "waiting to retry…" : "loading…") : "video appears here"}</div></div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="box black sh-red why">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="label gold">why this one</span>
                <span className="small" style={{ opacity: .6 }}>highlighted inputs shaped this pick</span>
              </div>
              <div className="text">{playing ? playing.reason : "once a track is playing, the dj explains the pick here, tied back to who said what."}</div>
              {playing?.physiological_evidence?.summary && <div className="mono small" style={{ marginTop: 10, opacity: .7 }}>♥ {playing.physiological_evidence.summary}</div>}
            </div>

            <div className="box blue transition">
              <span className="label">next transition</span>
              <span className="mono" style={{ fontWeight: 700 }}>energy {Math.round((playing?.energy ?? 0) * 100)} → {Math.round((next?.energy ?? playing?.energy ?? 0) * 100)}</span>
              <div className="tbars">{tbars.map((b, i) => <i key={i} className={b.hot ? "hot" : ""} style={{ height: `${b.h}%` }} />)}</div>
              <span className="small" style={{ fontWeight: 700 }}>{next ? `${next.song} · next` : "waiting for the next pick"}</span>
            </div>

            <div className="box energy-bar">
              <span className="label">room energy</span>
              <div className="energy-seg">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < curE ? "now" : i < nextE ? "aim" : ""} />)}</div>
              <span className="mono small" style={{ fontWeight: 700 }}>{curE} → aiming for {nextE}</span>
            </div>

            <div className="widgets">
              <div className="box chart">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="label dim">energy tonight</span><span className="tiny dim">dots = songs</span>
                </div>
                {energyPts.length < 2 ? <div className="spark-empty" style={{ height: 80 }}>fills in as songs queue up</div> : (
                  <svg viewBox="0 0 300 90" preserveAspectRatio="none" style={{ marginTop: 6 }}>
                    <line x1="0" y1="85" x2="300" y2="85" stroke="#14131c" strokeOpacity=".2" strokeWidth="2" />
                    <polyline fill="none" stroke="#f05a38" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" points={energyPts.map((v, i) => `${10 + (i / (energyPts.length - 1)) * 280},${80 - v * 70}`).join(" ")} />
                    {energyPts.map((v, i) => <circle key={i} cx={10 + (i / (energyPts.length - 1)) * 280} cy={80 - v * 70} r="5" fill={i === Math.max(0, energyPts.length - 1 - upcoming.length) ? "#f2bf45" : "#fff"} stroke="#14131c" strokeWidth="2.5" />)}
                  </svg>
                )}
              </div>

              <div className="box">
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                  <span className="label dim">who’s been heard</span>
                  {boost && boost[1] < maxHeard && <span className="pill sm pink">{nameOf(boost[0])} gets the next boost</span>}
                </div>
                {heardList.length === 0 ? <div className="small dim">fills in as guests send vibes.</div> : (
                  <div className="heard">
                    {heardList.map(([g, n]) => (
                      <div className="col1" key={g}>
                        <div className="bar" style={{ height: `${Math.max(12, (n / maxHeard) * 100)}%`, background: colorOf(g) }} title={`${n} picks shaped`} />
                        <span className="tiny" style={{ fontWeight: 800 }}>{nameOf(g)[0]?.toUpperCase()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="box">
                <div className="label dim" style={{ marginBottom: 6 }}>played tonight</div>
                {history.length === 0 && <div className="small dim">nothing yet.</div>}
                {history.slice(0, 4).map((q) => {
                  const imp = snap?.impacts?.find((x: any) => x.queue_id === q.id);
                  return (
                    <div className="list-row" key={q.id}>
                      <Cover title={q.song} videoId={q.video_id} size={34} />
                      <div className="grow"><div className="ellipsis" style={{ fontWeight: 700 }}>{q.song}</div><div className="small mut ellipsis">{q.artist}</div></div>
                      {impactText(imp) && <span className="chip acc">{impactText(imp)}</span>}
                      {q.status === "skipped" && <span className="chip err">skipped</span>}
                    </div>
                  );
                })}
              </div>

              <div className="box">
                <div className="label dim" style={{ marginBottom: 8 }}>in the room · {realGuests.length}</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {realGuests.length === 0 && <span className="small dim">waiting for the first guest…</span>}
                  {realGuests.map((g) => <span className="pill sm" key={g.id}>{av(g.id)}{g.name}</span>)}
                </div>
                {inputs.some((i) => i.kind === "artist") && (
                  <>
                    <div className="label dim" style={{ margin: "12px 0 6px" }}>suggested artists</div>
                    <div className="row wrap" style={{ gap: 6 }}>{inputs.filter((i) => i.kind === "artist").map((a) => <span className="pill sm teal" key={a.id}>🎤 {a.text}</span>)}</div>
                  </>
                )}
                <button className="btn sm" style={{ marginTop: 12 }} onClick={async () => setRecap((await api(`/rooms/${code}/recap`, {})).recap)}><Sparkle width={13} height={13} /> night recap</button>
                {recap && <p className="small" style={{ marginTop: 10, animation: "fadeUp .4s both" }}>{recap}</p>}
              </div>
            </div>
          </div>

          {/* ================= right column ================= */}
          <div className="side-col">
            <div className="box join-card">
              <div className="qr"><QRCodeSVG value={joinUrl} size={92} bgColor="#ffffff" /></div>
              <div className="grow">
                <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1 }}>scan to join</div>
                <div className="small" style={{ marginTop: 4 }}>send a photo, a voice note, or a vibe. the dj is listening.</div>
                <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard?.writeText(joinUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <><Check width={13} height={13} /> copied</> : <><Copy width={13} height={13} /> copy link</>}
                </button>
              </div>
            </div>
            <div className="col" style={{ gap: 6, marginTop: -8 }}>
              <input className="field mono" style={{ padding: "7px 10px", fontSize: 12 }} placeholder="paste https tunnel url (optional)" value={publicUrl} onChange={(ev) => savePublic(ev.target.value)} />
              {insecure && <div className="tiny" style={{ color: "var(--err)", fontWeight: 700 }}>phones block mic and camera on http. use an https link.</div>}
              {dev && <Segmented options={[{ value: "live", label: "real scans" }, { value: "simulated", label: "simulated" }]} value={room?.vitals_source ?? "live"} onChange={(v) => api(`/rooms/${code}`, { vitals_source: v }, "PATCH").then(poll)} />}
            </div>

            {guestsWithInput.size < 2 && (
              <div className="box black sh-pink quiet">
                <div className="label gold">{guestsWithInput.size === 0 ? "quiet in here" : "one voice so far"}</div>
                <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.15, margin: "6px 0", letterSpacing: "-.02em" }}>add a second vibe and the dj starts blending</div>
                <div className="small" style={{ opacity: .7 }}>until then it works from {guestsWithInput.size === 0 ? "its own taste and any pulse scans" : "that one vibe, which gets full weight"}.</div>
              </div>
            )}

            <div className="box">
              <div className="label dim" style={{ marginBottom: 8 }}>dj brain</div>
              <div className="brain brain-scroll">
                {runs.length === 0 && <div className="ln dim">decisions show up here as the dj makes them.</div>}
                {busy && <div className="ln hot">thinking…</div>}
                {runs.map((r) => (
                  <div key={r.id}>
                    <div className="ln dim runlabel">▸ {r.label}{dev && r.engine ? ` · answered by ${r.engine}` : ""}</div>
                    {r.items.length === 0 && !r.error && <div className="ln dim">  kept the queue as it was</div>}
                    {r.items.map((d: any, k: number) => (
                      <div key={d.id}>
                        {d.name === "queued" && <>
                          <div className={`ln ${k === 0 && r === runs[0] ? "hot" : ""}`}><b>queued {d.result.song}</b> — {d.result.artist}</div>
                          <div className="ln dim">  {d.result.reason}</div>
                          {(d.result.influenced_by ?? []).slice(0, 3).map((x: any) => <div className="ln dim" key={x.input_id}>  heard {x.kind === "text" ? "a vibe" : `a ${x.kind}`} from {x.guest_name ?? "a guest"}: {x.note}</div>)}
                          {d.result.evidence && <div className="ln dim">  ♥ {d.result.evidence}</div>}
                        </>}
                        {d.name === "removed" && <div className="ln"><b>removed {d.result.song}</b> — no longer fits</div>}
                        {d.name === "skipped" && <div className="ln"><b>skipped {d.result.song}</b> — {d.result.reason}</div>}
                      </div>
                    ))}
                    {r.error && <div className="ln" style={{ color: "var(--err)" }}>✗ {String(r.error).replace(/^RATE_LIMITED: /, "")}</div>}
                  </div>
                ))}
              </div>
              <button className="tiny dim" style={{ marginTop: 10, textDecoration: "underline" }} onClick={() => setShowTools((v) => !v)}>{showTools ? "hide" : "show"} raw tool calls</button>
              {showTools && (
                <div className="brain" style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
                  {(snap?.trace ?? []).filter((t: any) => t.kind === "tool_call" || t.kind === "tool_result").slice().reverse().map((t: any) => (
                    <div key={t.id} className="ln" style={{ cursor: "pointer" }} onClick={() => toggleTrace(t.id)}>
                      {t.kind === "tool_call" ? <><b>{t.name}</b> <span className="dim">{fmtArgs(t.name, t.args)}</span></> : <span className="dim">↳ {t.name}: {openTrace.has(t.id) ? <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(t.result, null, 2)}</pre> : JSON.stringify(t.result).slice(0, 80) + "…"}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="box">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span className="label dim">live inputs</span><span className="tiny dim">newest first</span>
              </div>
              {inputs.length === 0 && <div className="small dim">nothing yet. scan the code and send a vibe.</div>}
              {[...inputs].reverse().slice(0, 4).map((i, k) => (
                <div className={`input-row ${k === 0 && nowTick - i.created_at < 20000 ? "new" : ""}`} key={i.id}>
                  {av(i.guest_id, true)}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="label dim" style={{ fontSize: 10 }}>{KIND_TAG[i.kind]}</div>
                    <div className="ellipsis" style={{ fontWeight: 700 }}>{i.kind === "text" ? `“${i.text}”` : i.kind === "artist" ? i.text : i.kind === "photo" ? "a photo" : "a voice note"}</div>
                  </div>
                  <span className="tiny dim">{ago(nowTick - i.created_at)}</span>
                </div>
              ))}
            </div>

            <div className="box">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <span className="label dim">up next</span><span className="tiny dim">{upcoming.length} queued</span>
              </div>
              {upcoming.length === 0 && <div className="small dim">{busy ? "gemini is choosing…" : "nothing queued. the dj fills this automatically."}</div>}
              {upcoming.map((q) => {
                const gs = [...new Set<string>((q.influenced_by ?? []).map((x: any) => inputGuest(x.input_id)).filter(Boolean) as string[])];
                return (
                  <div className="list-row" key={q.id}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="ellipsis" style={{ fontWeight: 800 }}>{q.song}</div>
                      <div className="small mut ellipsis">{q.artist} · {q.artist_basis === "similar" ? `similar to ${q.similar_to ?? "suggested"}` : q.artist_basis === "suggested" ? "suggested artist" : q.reason}</div>
                    </div>
                    <span className="avatars">{gs.map((g) => av(g))}</span>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </div>
      {toast.node}
    </div>
  );
}
