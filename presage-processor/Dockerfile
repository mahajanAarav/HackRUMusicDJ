# Runs Presage's own preprocessing library (face tracking via MediaPipe) on a clip, then sends ONLY the resulting
# trace (per-frame face-color numbers) to Presage's Physiology API. The video itself is deleted right after.
FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
ENV PORT=10000
CMD gunicorn -b 0.0.0.0:${PORT} -w 1 --threads 4 --timeout 180 app:app
