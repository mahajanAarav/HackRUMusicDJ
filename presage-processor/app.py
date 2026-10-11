"""
Presage processor: turns a short face video into heart rate / breathing rate using Presage's official libraries.

  POST /jobs            body = the video bytes (Content-Type video/mp4 or video/webm)  -> {"id": ...}
  GET  /jobs/<id>       -> {"status": "processing" | "ready" | "error", "hr": ..., "rr": ..., "error": ...}

Both require the header  x-processor-secret: $PROCESSOR_SECRET  (shared with the web app).
The video is written to a temp file, preprocessed locally into a trace, deleted, and only the trace goes to Presage.
"""
import os
import subprocess
import tempfile
import threading
import time
import uuid

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

SECRET = os.environ.get("PROCESSOR_SECRET", "")
API_KEY = os.environ.get("PRESAGE_API_KEY", "")
BASE = os.environ.get("PRESAGE_BASE_URL", "https://api.physiology.presagetech.com")
MAX_BYTES = 30 * 1024 * 1024
# Breathing needs body tracking (pose model + optical flow), which is by far the slowest part and needs a lot of RAM.
# Heart rate only needs the face, so it is skipped by default. Set PROCESS_RR=1 to turn it back on.
PROCESS_RR = os.environ.get("PROCESS_RR", "0") == "1"
MAX_WIDTH = int(os.environ.get("MAX_WIDTH", "480"))
HR_FPS = int(os.environ.get("HR_FPS", "15"))  # heart-rate bandwidth is < 3 Hz, so 15 fps is plenty and halves the work

JOBS = {}
ONE_AT_A_TIME = threading.Semaphore(1)  # preprocessing is memory hungry; queue instead of crashing


def authorized():
    return bool(SECRET) and request.headers.get("x-processor-secret") == SECRET


def run_job(job_id, path):
    job = JOBS[job_id]
    try:
        # Imported here so the web server starts instantly and a heavy-import failure shows up as a job error, not a crash.
        import presage_physiology_preprocessing.preprocessing as pp
        from presage_physiology_preprocessing import process
        from presage_technologies import Physiology

        if not PROCESS_RR:
            pp.process_frame_rr = lambda frame, frame_last, traces_last: {}  # heart-rate only: skip body tracking
        with ONE_AT_A_TIME:
            t0 = time.time()
            job["state"] = "preprocessing"
            job["stage_started"] = t0
            # Browsers record WebM/MP4 with unreliable frame-rate metadata. Normalize to a clean 30 fps H.264 MP4 (<= 640 px wide) first.
            clean = path + ".norm.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-i", path, "-vf", f"scale='min({MAX_WIDTH},iw)':-2", "-r", "30", "-an", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", clean],
                check=True, timeout=90, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            try:
                trace = process(clean, HR_FPS=HR_FPS)
            finally:
                try:
                    os.remove(clean)
                except OSError:
                    pass
            print(f"[job {job_id}] preprocessing took {time.time() - t0:.1f}s, trace frames: {len(trace.get('frames', []))}", flush=True)
            job["state"] = "uploading"
            presage_id = Physiology(API_KEY).queue_processing(trace=trace, metrics=["hr", "rr"] if PROCESS_RR else ["hr"])
            if not presage_id:
                raise RuntimeError("Presage did not accept the trace (check the API key)")
            job["presage_id"] = presage_id
            job["state"] = "waiting"
    except Exception as e:  # noqa: BLE001
        job["state"] = "error"
        job["error"] = f"{type(e).__name__}: {e}"
        print(f"[job {job_id}] failed: {job['error']}", flush=True)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


@app.get("/")
def health():
    return jsonify(ok=True, key_set=bool(API_KEY), secret_set=bool(SECRET))


@app.post("/jobs")
def create_job():
    if not authorized():
        return jsonify(error="unauthorized"), 401
    data = request.get_data()
    if len(data) < 10_000:
        return jsonify(error="clip too small"), 400
    if len(data) > MAX_BYTES:
        return jsonify(error="clip too large"), 413
    ctype = (request.content_type or "").lower()
    suffix = ".mp4" if "mp4" in ctype else ".webm" if "webm" in ctype else ".mov" if "quicktime" in ctype else ".mp4"
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {"state": "queued", "created": time.time()}
    threading.Thread(target=run_job, args=(job_id, path), daemon=True).start()
    return jsonify(id=job_id), 201


@app.get("/jobs/<job_id>")
def get_job(job_id):
    if not authorized():
        return jsonify(error="unauthorized"), 401
    job = JOBS.get(job_id)
    if not job:
        return jsonify(error="unknown job"), 404
    if job["state"] == "error":
        return jsonify(status="error", error=job.get("error", "failed"))
    if job["state"] == "ready":
        return jsonify(status="ready", hr=job["hr"], rr=job["rr"])
    if job["state"] != "waiting":
        return jsonify(status="processing", stage=job["state"], seconds=round(time.time() - job["created"]))
    # Presage has the trace; ask whether results are ready (201 = still working).
    r = requests.post(BASE + "/retrieve-data", headers={"x-api-key": API_KEY}, json={"id": job["presage_id"], "reshape": False}, timeout=30)
    if r.status_code == 200:
        body = r.json()
        job["hr"], job["rr"], job["state"] = body.get("hr"), body.get("rr"), "ready"
        return jsonify(status="ready", hr=job["hr"], rr=job["rr"])
    if r.status_code == 401:
        return jsonify(status="error", error="Presage rejected the API key")
    return jsonify(status="processing", stage="presage")
