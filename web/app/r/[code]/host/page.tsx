"use client";
import { QRCodeSVG } from "qrcode.react";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Ambient } from "@/components/Ambient";
import { Cover } from "@/components/Cover";
import { Equalizer } from "@/components/Equalizer";
import { Check, Chevron, Copy, Heart, Play, Skip, Sparkle, Users, Wave, Wrench } from "@/components/Icons";
import { Segmented } from "@/components/Segmented";
import { Sparkline } from "@/components/Sparkline";
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
const AVATAR_COLORS = ["#ff4d6d", "#7b6cf6", "#4cc9f0", "#3ddc97", "#ffb020", "#f06bd0"];
const colorFor = (s: string) => AVATAR_COLORS[[...s].reduce((h, c) => h + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

function fmtArgs(name: string, args: any): string {
  if (!args) return "";
  if (name === "update_queue") return args.action === "add" ? `add "${args.item?.song ?? "?"}" by ${args.item?.artist ?? "?"}` : `${args.action} ${args.queue_id ?? ""}`;
  if (name === "search_track") return `"${args.title}" by ${args.artist}`;
  if (name === "skip_track") return args.reason ?? "";
  const e = Object.entries(args);
  return e.length ? e.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ") : "";
}

function TrackRow({ q, index, impact, playing }: { q: any; index: number; impact?: any; playing?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`track ${open ? "open" : ""} ${playing ? "playing" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
      <button className="track-head" onClick={() => setOpen((o) => !o)}>
        <span className="track-idx">{playing ? <Equalizer /> : index + 1}</span>
        <Cover title={q.song} videoId={q.video_id} />
        <div style={{ minWidth: 0 }}>
          <div className="track-title ellipsis">{q.song}</div>
          <div className="small mut ellipsis">{q.artist}{q.artist_basis === "suggested" ? " 🎤" : q.artist_basis === "similar" ? " ≈" : ""} · {q.reason}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ width: 54 }} title={`Energy ${Math.round(q.energy * 100)}%`}><div className="meter"><i style={{ width: `${q.energy * 100}%` }} /></div></div>
          {impact?.score != null && <span className="chip acc" title="How the room's pulse/breathing moved vs. before the song">{impact.delta?.pulse != null ? `${impact.delta.pulse > 0 ? "↑" : "↓"} ${Math.abs(Math.round(impact.delta.pulse))} bpm` : impact.score > 0 ? "↑ rising" : "↓ falling"}</span>}
          {q.status === "skipped" && <span className="chip err">skipped</span>}
        </div>
        <Chevron className="chev" width={18} height={18} />
      </button>
      <div className="track-detail"><div><div className="track-detail-inner">
        <div className="small">{q.reason}</div>
        {q.artist_basis && q.artist_basis !== "vibe" && (
          <div className="row" style={{ gap: 6 }}>
            <span className={`chip ${q.artist_basis === "suggested" ? "ok" : "acc"}`}>{q.artist_basis === "suggested" ? "🎤 Suggested artist" : `≈ Similar to ${q.similar_to ?? "a suggested artist"}`}</span>
          </div>
        )}
        {q.influenced_by.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="tiny dim">Influenced by</span>
            {q.influenced_by.map((i: any) => <span className="chip acc" key={i.input_id}>{i.guest_name ?? "Guest"} · {i.kind}: {i.note}</span>)}
          </div>
        )}
        <div className="evidence"><Heart width={12} height={12} style={{ color: "var(--ok)", marginRight: 6 }} />{q.physiological_evidence.summary}</div>
      </div></div></div>
    </div>
  );
}

export default function Host({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [snap, setSnap] = useState<Snap>(null);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clipS, setClipS] = useState(0); // 0 = play every song in full
  const [dev, setDev] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const [recap, setRecap] = useState("");
  const [base, setBase] = useState("");
  const [copied, setCopied] = useState(false);
  const [publicUrl, setPublicUrl] = useState("");
  const [showTools, setShowTools] = useState(false);
  const [paused, setPaused] = useState(false);
  const [openTrace, setOpenTrace] = useState<Set<string>>(new Set());
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
  useEffect(() => { if (err) toast.show(err.replace(/^RATE_LIMITED: /, "Gemini rate limit: "), "err"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps

  const poll = useCallback(async () => {
    try {
      const s = await api(`/rooms/${code}`);
      setSnap(s);
    } catch (e) {
      setErr((e as Error).message);
    }
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
  const e = snap?.energy;
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

  // Autopilot: keep one track queued, start the next when idle.
  useEffect(() => {
    if (!started || paused || busy || Date.now() - failedAt.current < cooldown.current) return;
    if (!playing && upcoming.length) advance("next");
    else if (pending > 0 && (snap?.pending_age_ms ?? 0) >= 3000) askDj("new_input"); // react to fresh guest input
    else if (upcoming.length < TARGET_QUEUE) askDj(playing ? "next_song" : "start"); // keep the queue topped up
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

  // Progress bar: real playback position when the YouTube player knows it, otherwise elapsed time.
  useEffect(() => {
    if (!playing) { setProgress(0); return; }
    const mock = playing.video_id.startsWith("mock:");
    const t = setInterval(() => {
      const dur = !mock ? player.current?.getDuration?.() : 0;
      if (dur > 0 && clipS === 0) setProgress(Math.min(100, ((player.current.getCurrentTime?.() ?? 0) / dur) * 100));
      else setProgress(Math.min(100, ((Date.now() - playing.started_at) / ((clipS > 0 ? clipS : 180) * 1000)) * 100));
    }, 500);
    return () => clearInterval(t);
  }, [playing?.id, clipS]); // eslint-disable-line react-hooks/exhaustive-deps

  const origin = (publicUrl.trim() || base).replace(/\/+$/, "");
  const joinUrl = `${origin}/r/${code}`;
  const insecure = origin.startsWith("http://") && !/^http:\/\/localhost/.test(origin);
  const realGuests = (snap?.guests ?? []).filter((g: any) => !g.simulated);
  const artistInputs = (snap?.inputs ?? []).filter((i: any) => i.kind === "artist");
  const playedCount = (name: string) => queue.filter((q) => q.artist.toLowerCase().includes(name.toLowerCase().split(/,|&|ft\.?|feat\.?/)[0].trim())).length;
  const simGuests = (snap?.guests ?? []).filter((g: any) => g.simulated);
  const LABELS: Record<string, string> = { start: "Opening the night", next_song: "Picking the next track", new_input: "Reacting to a new vibe", pulse_check: "Reacting to a pulse check" };
  // Group the trace into DJ runs: one trigger followed by the decisions it produced.
  const runs = (() => {
    const out: { id: string; label: string; items: any[]; error?: string }[] = [];
    for (const t of snap?.trace ?? []) {
      if (t.kind === "trigger") out.push({ id: t.id, label: LABELS[String(t.text).split(" ")[0]] ?? "Deciding", items: [] });
      else if (out.length && t.kind === "decision") out[out.length - 1].items.push(t);
      else if (out.length && t.kind === "error") out[out.length - 1].error = t.text;
    }
    return out.reverse();
  })();
  const scanSummary = snap?.scan_summary;
  const pulseHist: number[] = snap?.recent_pulse ?? [];
  const beat = scanSummary?.pulse ? `${60 / scanSummary.pulse}s` : "1s";
  const toggleTrace = (id: string) => setOpenTrace((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="app">
      <Ambient song={playing ? `${playing.song} ${playing.artist}` : null} energy={playing?.energy ?? 0.4} />
      <div className="host">
        {/* ---------------- left: room ---------------- */}
        <section className="side">
          <div className="logo"><span className="logo-mark"><Wave /></span> Biofeedback DJ</div>

          <div className="col" style={{ gap: 8 }}>
            {dev && <><div className="eyebrow" style={{ marginTop: 6 }}>Vitals source (dev)</div>
            <Segmented options={[{ value: "live", label: "Real scans" }, { value: "simulated", label: "Simulated" }]} value={room?.vitals_source ?? "live"} onChange={(v) => api(`/rooms/${code}`, { vitals_source: v }, "PATCH").then(poll)} /></>}
          </div>

          <div className="col" style={{ gap: 8 }}>
            <div className="eyebrow">Scan to join</div>
            <div className="qr-wrap"><QRCodeSVG value={joinUrl} size={180} bgColor="#ffffff" /></div>
            <input className="field" style={{ padding: "7px 10px", fontSize: 12 }} placeholder="Paste https tunnel URL (optional)" value={publicUrl} onChange={(ev) => savePublic(ev.target.value)} />
            {insecure && <div className="tiny" style={{ color: "var(--warn)" }}>Phones block mic and camera on http. Paste an https tunnel URL above.</div>}
            <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(joinUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? <><Check width={14} height={14} /> Copied</> : <><Copy width={14} height={14} /> {joinUrl.replace(/^https?:\/\//, "")}</>}
            </button>
          </div>

          <div className="col" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="eyebrow"><Users width={12} height={12} style={{ verticalAlign: -2 }} /> Guests · {realGuests.length}</div>
            </div>
            {realGuests.length === 0 && <div className="small dim">Waiting for the first guest…</div>}
            {realGuests.map((g: any) => (
              <div className="guest" key={g.id}>
                <span className="avatar" style={{ background: colorFor(g.name) }}>{g.name[0]?.toUpperCase()}{g.sensing && <span className="sense" />}</span>
                <span className="grow ellipsis">{g.name}</span>
                {g.sensing && <span className="chip ok">sensing</span>}
              </div>
            ))}
            {room?.vitals_source === "simulated" && simGuests.length > 0 && <div className="tiny dim" style={{ marginTop: 4 }}>+ {simGuests.length} simulated guests feeding vitals</div>}
          </div>

          <div className="col" style={{ gap: 6 }}>
            <div className="eyebrow">🎤 Suggested artists · {artistInputs.length}</div>
            {artistInputs.length === 0 && <div className="small dim">Guests can add artists from their phones. The DJ plays them and similar artists.</div>}
            <div className="row wrap" style={{ gap: 6 }}>
              {artistInputs.map((a: any) => <span className="chip acc" key={a.id} title={`Suggested by ${a.guest_name}`} style={{ animation: "pop .4s var(--ease) both" }}>{a.text}{playedCount(a.text) > 0 && <span className="dim"> · {playedCount(a.text)}</span>}</span>)}
            </div>
          </div>

          <div style={{ marginTop: "auto" }}>
            <button className="btn ghost sm" style={{ width: "100%" }} onClick={async () => setRecap((await api(`/rooms/${code}/recap`, {})).recap)}><Sparkle width={14} height={14} /> Night recap</button>
            {recap && <p className="small mut" style={{ marginTop: 10, animation: "fadeUp .4s both" }}>{recap}</p>}
          </div>
        </section>

        {/* ---------------- center: now playing + queue ---------------- */}
        <section className="center">
          <div className="center-hero">
            <div className="eyebrow">Room · {room?.code}</div>
            <h1 className="room-title" style={{ marginTop: 6 }}>{room?.name ?? <span className="skeleton" style={{ display: "inline-block", width: 260, height: 40 }} />}</h1>

            <div className="hero-grid">
              <div className="col" style={{ gap: 12 }}>
                {playing ? (
                  <div className="row" style={{ gap: 14, animation: "pop .5s var(--ease) both" }} key={playing.id}>
                    <Cover title={playing.song} videoId={playing.video_id} size={92} radius={12} />
                    <div style={{ minWidth: 0 }}>
                      <div className="eyebrow row" style={{ gap: 6 }}><Equalizer /> Now playing</div>
                      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }} className="ellipsis">{playing.song}</div>
                      <div className="mut">{playing.artist}</div>
                    </div>
                  </div>
                ) : (
                  <div className="mut">{started ? (busy ? "The DJ is picking the first track…" : "Warming up…") : "Press Start to begin the night."}</div>
                )}
                {playing && <p className="small mut" style={{ maxWidth: 520 }}>“{playing.reason}”</p>}
                <div className="row wrap">
                  {!started ? (
                    <button className="btn primary big" onClick={() => setStarted(true)}><Play width={18} height={18} /> Start the night</button>
                  ) : (
                    <>
                      <button className="btn" disabled={busy || !playing} onClick={() => advance("skip")}><Skip width={16} height={16} /> Skip</button>
                      <button className={`btn ghost ${paused ? "warn-btn" : ""}`} onClick={() => setPaused((v) => !v)} title="Stop the DJ from making Gemini requests on its own">{paused ? "▶ Resume AI" : "⏸ Pause AI"}</button>
                      <button className="btn ghost" disabled={busy} onClick={() => askDj()}>{busy ? <span className="spinner" /> : <Sparkle width={16} height={16} />} Ask DJ</button>
                    </>
                  )}
                </div>
              </div>

              <div className="player">
                {started ? <div id="yt" /> : null}
                {(!started || !playing || announcing || playing.video_id.startsWith("mock:")) && (
                  <div className="player-overlay">
                    {playing && announcing ? (
                      <div className="col" style={{ alignItems: "center", gap: 10 }}><Cover title={playing.song} videoId={playing.video_id} size={90} radius={14} /><div className="row" style={{ gap: 8 }}><Equalizer size={18} /><span style={{ fontWeight: 700 }}>The DJ is announcing…</span></div><div className="small mut" style={{ maxWidth: 260 }}>{playing.announcement}</div></div>
                    ) : playing?.video_id.startsWith("mock:") ? (
                      <div className="col" style={{ alignItems: "center", gap: 8 }}><Cover title={playing.song} size={90} radius={14} /><div style={{ fontWeight: 800, fontSize: 18 }}>{playing.song}</div><div className="mut">{playing.artist}</div><span className="chip warn">No YouTube key · mock playback</span></div>
                    ) : (
                      <div className="mut"><Wave width={34} height={34} style={{ color: "var(--acc)" }} /><div style={{ marginTop: 6 }}>{started ? (err ? "Waiting to retry…" : "Loading…") : "Video appears here"}</div></div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="center-body">
            <div className="section-head"><h2>Up next</h2><span className="small dim">{upcoming.length} queued · tap a track for the why</span></div>
            {upcoming.length === 0 && <div className="small dim" style={{ padding: "8px 10px" }}>{busy ? "Gemini is choosing…" : "Nothing queued. The DJ will fill this automatically."}</div>}
            {upcoming.map((q, i) => <TrackRow key={q.id} q={q} index={i} />)}

            {history.length > 0 && (<>
              <div className="section-head"><h2>Played</h2><span className="small dim">pulse change vs. before each song</span></div>
              {history.slice(0, 10).map((q, i) => <TrackRow key={q.id} q={q} index={i} impact={snap?.impacts?.find((x: any) => x.queue_id === q.id)} />)}
            </>)}
          </div>
        </section>

        {/* ---------------- right: vitals + trace ---------------- */}
        <section className="right">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <div className="eyebrow row" style={{ gap: 6 }}><Heart width={12} height={12} /> Pulse scans</div>
              <span className="chip">{scanSummary?.n ?? 0} scanned</span>
            </div>
            {(scanSummary?.n ?? 0) === 0 ? (
              <div className="empty-scan">
                <Heart width={22} height={22} className="heart" />
                <div style={{ fontWeight: 700, marginTop: 6 }}>No pulse scans yet</div>
                <div className="small mut">Vitals only appear when a guest opens the Pulse tab on their phone and scans with their camera. Until then the DJ goes by what guests tell it.</div>
              </div>
            ) : (
              <>
                <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
                  <div className="vital">
                    <div className="tiny mut"><Heart className="heart" width={12} height={12} style={{ ["--beat" as string]: beat }} /> Pulse</div>
                    <b><AnimatedNumber value={scanSummary.pulse} /></b>
                    <span className="tiny dim">bpm</span>
                  </div>
                  <div className="vital">
                    <div className="tiny mut">Breathing</div>
                    <b><AnimatedNumber value={scanSummary.breathing} decimals={1} /></b>
                    <span className="tiny dim">rpm</span>
                  </div>
                </div>
                <div style={{ margin: "14px 0 6px" }}><Sparkline values={pulseHist} /></div>
                <div className="col" style={{ gap: 4 }}>
                  {(snap?.scans ?? []).map((sc: any) => (
                    <div className="guest" key={sc.guest_id}>
                      <span className="avatar" style={{ background: colorFor(sc.name) }}>{sc.name[0]?.toUpperCase()}</span>
                      <span className="grow ellipsis">{sc.name}</span>
                      <span className="small mut">{Math.round(sc.pulse_bpm)} bpm{sc.breathing_rpm ? ` · ${sc.breathing_rpm} rpm` : ""}</span>
                      <span className="tiny dim">{sc.age_s < 90 ? `${sc.age_s}s` : `${Math.round(sc.age_s / 60)}m`} ago</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <div className="eyebrow row" style={{ gap: 6 }}><Sparkle width={12} height={12} /> DJ decisions</div>
              {pending > 0 && !busy && <span className="chip warn">{pending} new vibe{pending > 1 ? "s" : ""} pending</span>}
              {busy && <span className="chip acc"><span className="spinner" style={{ width: 10, height: 10, border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite" }} /> thinking</span>}
            </div>
            <div className="trace-list">
              {runs.length === 0 && <div className="small dim">Each time the DJ changes the queue, you’ll see what it did and why.</div>}
              {runs.map((r) => (
                <div key={r.id} className="run">
                  <div className="tiny dim run-label">{r.label}</div>
                  {r.items.length === 0 && !r.error && <div className="decision keep"><span className="trace-ico"><Check width={12} height={12} /></span><span className="small mut">{busy && r === runs[0] ? "Thinking…" : "Kept the queue as it was."}</span></div>}
                  {r.items.map((d: any) => (
                    <div key={d.id} className={`decision ${d.name}`}>
                      <span className="trace-ico">{d.name === "queued" ? <Check width={12} height={12} /> : "✕"}</span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        {d.name === "queued" && <>
                          <div className="small"><b>Queued {d.result.song}</b> <span className="mut">· {d.result.artist}</span></div>
                          <div className="small mut">{d.result.reason}</div>
                          <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                            {(d.result.influenced_by ?? []).map((x: any) => <span className="chip acc" key={x.input_id}>{x.guest_name ?? "Guest"} · {x.kind}</span>)}
                          </div>
                          {d.result.evidence && <div className="tiny" style={{ color: "var(--ok)", marginTop: 4 }}>♥ {d.result.evidence}</div>}
                        </>}
                        {d.name === "removed" && <div className="small"><b>Removed {d.result.song}</b> <span className="mut">· no longer fits the room</span></div>}
                        {d.name === "skipped" && <><div className="small"><b>Skipped {d.result.song}</b></div><div className="small mut">{d.result.reason}</div></>}
                      </div>
                    </div>
                  ))}
                  {r.error && <div className="decision error"><span className="trace-ico">!</span><span className="small" style={{ color: "var(--err)" }}>{String(r.error).replace(/^RATE_LIMITED: /, "")}</span></div>}
                </div>
              ))}
            </div>
            <button className="tiny dim" style={{ marginTop: 10, textDecoration: "underline" }} onClick={() => setShowTools((v) => !v)}>{showTools ? "Hide" : "Show"} raw tool calls</button>
            {showTools && (
              <div className="trace-list" style={{ marginTop: 8 }}>
                {(snap?.trace ?? []).filter((t: any) => t.kind === "tool_call" || t.kind === "tool_result").slice().reverse().map((t: any) => {
                  const open = openTrace.has(t.id);
                  return (
                    <div key={t.id} className={`trace-item ${t.kind}`} onClick={() => toggleTrace(t.id)}>
                      <span className="trace-ico">{t.kind === "tool_call" ? <Wrench width={12} height={12} /> : "↳"}</span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        {t.kind === "tool_call" ? <><b>{t.name}</b> <code>{fmtArgs(t.name, t.args)}</code></> : <span className="mut">{t.name}: {open ? <pre className="full"><code>{JSON.stringify(t.result, null, 2)}</code></pre> : JSON.stringify(t.result).slice(0, 90) + "…"}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ---------------- now-playing bar ---------------- */}
      <div className="nowbar">
        <div className="row" style={{ minWidth: 0 }}>
          {playing ? <Cover title={playing.song} videoId={playing.video_id} size={46} /> : <div className="skeleton" style={{ width: 46, height: 46 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 700 }}>{playing?.song ?? "Not playing"}</div>
            <div className="small mut ellipsis">{playing?.artist ?? room?.name ?? ""}</div>
          </div>
        </div>
        <div className="nowbar-mid">
          <div className="row" style={{ gap: 14 }}>
            <button className="btn icon" disabled={!started || busy || !playing} onClick={() => advance("skip")} aria-label="Skip"><Skip width={18} height={18} /></button>
          </div>
          <div className="progress"><i style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="row nowbar-right" style={{ justifyContent: "flex-end" }}>
          <label className="small mut row" style={{ gap: 6 }}>Play
            <select className="field" value={clipS} onChange={(ev) => setClipS(Number(ev.target.value))} style={{ width: 110, padding: "6px 8px" }}>
              <option value={0}>Full songs</option><option value={30}>30s clips</option><option value={60}>60s clips</option><option value={90}>90s clips</option>
            </select>
          </label>
        </div>
      </div>
      {toast.node}
    </div>
  );
}
