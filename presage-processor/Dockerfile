# Runs Presage's official preprocessing library (face tracking via MediaPipe) on a clip, then sends ONLY the resulting
# trace (per-frame face-color numbers) to Presage's Physiology API. The video itself is deleted right after.
FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir --no-deps presage-technologies==1.6.0 presage-physiology-preprocessing==1.2.6
# Fail the build now (not at the first scan) if the libraries cannot be imported.
RUN python -c "from presage_physiology_preprocessing import process; from presage_technologies import Physiology; import cv2, mediapipe as mp; mp.solutions.face_mesh; mp.solutions.pose; print('presage libs ok', cv2.__version__, mp.__version__)"
# MediaPipe downloads its pose model on first use. Do it now so it is baked into the image (non-fatal if it cannot).
RUN python -c "import mediapipe as mp; mp.solutions.pose.Pose(model_complexity=1, enable_segmentation=True).close(); print('pose model ready')" || echo "pose warm-up skipped"
COPY app.py .
ENV PORT=10000
CMD gunicorn -b 0.0.0.0:${PORT} -w 1 --threads 4 --timeout 180 app:app
