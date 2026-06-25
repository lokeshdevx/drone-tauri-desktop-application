"""
StreamManager — real-time multi-camera streaming.

Architecture per camera:
  CaptureThread  → latest_frame (shared memory, lock-free read)
  DisplayThread  → encodes latest_frame → sends JPEG over WebSocket at full FPS
  DetectThread   → reads every Nth frame → runs AI → fires drone_detected event

Key design for zero latency:
  - CaptureThread uses aggressive FFmpeg flags: nobuffer, low_delay, discard_corrupt
  - latest_frame is a simple shared variable (not a queue) — always the newest frame
  - DisplayThread runs independently at camera FPS — never waits for AI
  - DetectThread runs AI without blocking the display pipeline
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, Optional, Set

import cv2
import numpy as np

from core.detector import DroneDetector, FrameResult
from core.ws_manager import WebSocketManager
from utils.db import DetectionDB

logger = logging.getLogger("drone-backend.stream")

DETECTIONS_DIR = Path(__file__).parent.parent / "detections"
DETECTIONS_DIR.mkdir(exist_ok=True)

DISPLAY_W      = 640
DISPLAY_H      = 480
STREAM_QUALITY = 25   # lower = smaller payload = faster delivery


def open_stream(url: str) -> Optional[cv2.VideoCapture]:
    """Open VideoCapture with minimum-latency settings."""
    url = str(url).strip()

    if url.isdigit():
        cap = cv2.VideoCapture(int(url))
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap if cap.isOpened() else None

    if url.lower().startswith("rtsp://"):
        # Reliable RTSP flags — balance latency vs stability
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
            "rtsp_transport;tcp"
            "|stimeout;10000000"         # 10s connect timeout
            "|fflags;nobuffer+discardcorrupt"
            "|reconnect;1"
            "|reconnect_streamed;1"
            "|reconnect_delay_max;5"
        )
    else:
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
            "stimeout;5000000"
            "|fflags;nobuffer"
            "|flags;low_delay"
        )

    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        try: cap.release()
        except Exception: pass
        return None

    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


# ── Shared latest frame ────────────────────────────────────────────────────────

class LatestFrame:
    """
    Lock-free latest-frame holder.
    Writer (CaptureThread) calls put() every frame.
    Readers (DisplayThread, DetectThread) call get() to get newest frame.
    No queue — always the absolute latest frame, zero wait.
    """
    def __init__(self):
        self._frame: Optional[np.ndarray] = None
        self._lock  = threading.Lock()
        self._event = threading.Event()

    def put(self, frame: np.ndarray):
        with self._lock:
            self._frame = frame
        self._event.set()
        self._event.clear()

    def get(self) -> Optional[np.ndarray]:
        with self._lock:
            return self._frame

    def wait(self, timeout: float = 0.1) -> Optional[np.ndarray]:
        """Block until new frame, return it."""
        self._event.wait(timeout=timeout)
        return self.get()


# ── WS clients ─────────────────────────────────────────────────────────────────

class CameraWsClients:
    def __init__(self):
        self._clients: Set = set()
        self._lock = threading.Lock()

    def add(self, ws):
        with self._lock: self._clients.add(ws)

    def remove(self, ws):
        with self._lock: self._clients.discard(ws)

    def get_all(self) -> list:
        with self._lock: return list(self._clients)

    @property
    def count(self) -> int:
        with self._lock: return len(self._clients)


# ── Capture thread ─────────────────────────────────────────────────────────────

class CaptureThread(threading.Thread):
    """Reads frames as fast as possible. Stores latest in shared LatestFrame."""

    def __init__(self, camera_id, url, name, latest: LatestFrame, on_status):
        super().__init__(daemon=True, name=f"cap:{camera_id}")
        self.camera_id = camera_id
        self.url       = url
        self.cam_name  = name
        self.latest    = latest
        self.on_status = on_status
        self._stop     = threading.Event()

    def stop(self): self._stop.set()

    def _keepalive(self):
        import socket, re
        try:
            m = re.match(r"rtsp://([^@/]+@)?([^/]+)", self.url)
            if not m: return
            h, *p = m.group(2).split(":")
            port = int(p[0]) if p else 554
            with socket.create_connection((h, port), timeout=3) as s:
                s.sendall(f"OPTIONS rtsp://{h}:{port}/ RTSP/1.0\r\nCSeq: 1\r\n\r\n".encode())
                s.recv(512)
        except Exception: pass

    def run(self):
        delay   = 2.0
        is_rtsp = self.url.lower().startswith("rtsp://")

        while not self._stop.is_set():
            cap = None
            try:
                self.on_status("connecting")
                logger.info(f"[{self.cam_name}] connecting: {self.url}")
                cap = open_stream(self.url)
                if not cap:
                    raise ConnectionError("Cannot open stream — check URL/credentials")

                self.on_status("online")
                logger.info(f"[{self.cam_name}] connected ✓")
                delay   = 2.0
                bad     = 0
                last_ka = time.time()

                while not self._stop.is_set():
                    # RTSP keepalive
                    if is_rtsp and (time.time() - last_ka) > 25:
                        threading.Thread(target=self._keepalive, daemon=True).start()
                        last_ka = time.time()

                    ok, frame = cap.read()
                    if not ok or frame is None or frame.size == 0:
                        bad += 1
                        if bad >= 10:
                            raise RuntimeError("Stream dropped")
                        time.sleep(0.01)
                        continue

                    bad = 0
                    # Store latest frame — overwrites previous immediately
                    self.latest.put(frame)

            except Exception as e:
                logger.warning(f"[{self.cam_name}] {e} — retry in {delay}s")
                self.on_status("error", str(e))
                time.sleep(delay)
                delay = min(delay * 2, 15.0)
            finally:
                if cap:
                    try: cap.release()
                    except Exception: pass


# ── Display thread ─────────────────────────────────────────────────────────────

class DisplayThread(threading.Thread):
    """
    Encodes latest frame as JPEG and sends to all WS clients.
    Runs independently of AI detection — never blocked by inference.
    Delivers frames at the camera's native FPS.
    """

    def __init__(self, camera_id, name, latest: LatestFrame,
                 ws_clients: CameraWsClients, loop):
        super().__init__(daemon=True, name=f"disp:{camera_id}")
        self.camera_id     = camera_id
        self.cam_name      = name
        self.latest        = latest
        self.ws_clients    = ws_clients
        self.loop          = loop
        self._stop         = threading.Event()
        self.encode_params = [cv2.IMWRITE_JPEG_QUALITY, STREAM_QUALITY]
        self._fps_buf: list = []
        self.fps           = 0.0

    def stop(self): self._stop.set()

    def _update_fps(self):
        now = time.monotonic()
        self._fps_buf.append(now)
        if len(self._fps_buf) > 60:
            self._fps_buf = self._fps_buf[-60:]
        if len(self._fps_buf) >= 2:
            span = self._fps_buf[-1] - self._fps_buf[0]
            self.fps = round(len(self._fps_buf) / span, 1) if span > 0 else 0.0

    def _encode(self, frame: np.ndarray) -> Optional[bytes]:
        try:
            h, w = frame.shape[:2]
            if h == 0 or w == 0: return None
            scale = min(DISPLAY_W / w, DISPLAY_H / h, 1.0)
            if scale < 1.0:
                frame = cv2.resize(frame, (int(w*scale), int(h*scale)),
                                   interpolation=cv2.INTER_LINEAR)
            ok, buf = cv2.imencode(".jpg", frame, self.encode_params)
            return buf.tobytes() if (ok and buf is not None and len(buf) > 100) else None
        except Exception:
            return None

    def _broadcast(self, jpeg: bytes):
        clients = self.ws_clients.get_all()
        if not clients: return

        async def _send():
            dead = []
            for ws in clients:
                try: await ws.send_bytes(jpeg)
                except Exception: dead.append(ws)
            for ws in dead: self.ws_clients.remove(ws)

        asyncio.run_coroutine_threadsafe(_send(), self.loop)

    def run(self):
        last_frame_id = id(None)
        last_send_time = 0.0
        min_interval = 1.0 / 20.0   # cap at 20fps max for display

        while not self._stop.is_set():
            frame = self.latest.wait(timeout=0.1)
            if frame is None or self._stop.is_set():
                continue

            # Skip same frame
            if id(frame) == last_frame_id:
                continue
            last_frame_id = id(frame)

            # Rate-limit display to avoid overwhelming frontend
            now = time.monotonic()
            if now - last_send_time < min_interval:
                continue
            last_send_time = now

            jpeg = self._encode(frame)
            if jpeg:
                self._broadcast(jpeg)
                self._update_fps()


# ── Detect thread ──────────────────────────────────────────────────────────────

class DetectThread(threading.Thread):
    """Runs AI inference on every Nth frame. Completely separate from display."""

    def __init__(self, camera_id, name, latest: LatestFrame,
                 detector, frame_skip, det_res, on_detection, loop):
        super().__init__(daemon=True, name=f"det:{camera_id}")
        self.camera_id    = camera_id
        self.cam_name     = name
        self.latest       = latest
        self.detector     = detector
        self.frame_skip   = max(0, frame_skip)
        self.det_res      = det_res
        self.on_detection = on_detection
        self.loop         = loop
        self._stop        = threading.Event()

    def stop(self): self._stop.set()

    def run(self):
        frame_n = 0
        last_frame_id = id(None)
        interval = max(0.033, (self.frame_skip + 1) / 30.0)  # ~30fps base

        while not self._stop.is_set():
            time.sleep(interval)
            if self._stop.is_set(): break

            frame = self.latest.get()
            if frame is None: continue

            # Skip if no new frame since last check
            if id(frame) == last_frame_id: continue
            last_frame_id = id(frame)

            frame_n += 1
            if self.frame_skip > 0 and frame_n % (self.frame_skip + 1) != 0:
                continue

            try:
                small  = cv2.resize(frame, (self.det_res, self.det_res))
                result = self.detector.infer(small, self.camera_id)
                if result.has_drone:
                    asyncio.run_coroutine_threadsafe(
                        self.on_detection(frame, result), self.loop
                    )
            except Exception as e:
                logger.warning(f"[{self.cam_name}] detection error: {e}")


# ── Camera stream container ────────────────────────────────────────────────────

class CameraStream:
    def __init__(self, camera_id, url, name="", username="",
                 password="", frame_skip=2, resolution=416):
        self.camera_id  = camera_id
        self.url        = url
        self.name       = name or camera_id
        self.username   = username
        self.password   = password
        self.frame_skip = frame_skip
        self.resolution = resolution
        self.status     = "connecting"
        self.last_error = ""

        self.latest     = LatestFrame()
        self.ws_clients = CameraWsClients()

        self.cap_thread: Optional[CaptureThread] = None
        self.disp_thread: Optional[DisplayThread] = None
        self.det_thread: Optional[DetectThread]  = None

    @property
    def fps(self):
        return self.disp_thread.fps if self.disp_thread else 0.0

    def build_url(self) -> str:
        url = self.url.strip()
        if self.username and self.password and "://" in url:
            scheme, rest = url.split("://", 1)
            if "@" not in rest:
                url = f"{scheme}://{self.username}:{self.password}@{rest}"
        return url


# ── Stream manager ─────────────────────────────────────────────────────────────

class StreamManager:
    def __init__(self, detector: DroneDetector, ws_manager: WebSocketManager):
        self.detector = detector
        self.ws       = ws_manager
        self.db       = DetectionDB()
        self._streams: Dict[str, CameraStream] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def _get_loop(self):
        if not self._loop:
            self._loop = asyncio.get_event_loop()
        return self._loop

    async def start(self, camera_id, url, name="", username="", password="",
                    frame_skip=2, resolution=416, confidence=0.45) -> bool:

        self.detector.set_threshold(confidence)
        loop = self._get_loop()

        old_clients = None
        if camera_id in self._streams:
            existing = self._streams[camera_id]
            if existing.url == url and existing.cap_thread and existing.cap_thread.is_alive():
                if existing.det_thread:
                    existing.det_thread.frame_skip = max(0, int(frame_skip))
                    existing.det_thread.det_res    = int(resolution)
                return True
            old_clients = existing.ws_clients
            for t in [existing.cap_thread, existing.disp_thread, existing.det_thread]:
                if t: t.stop()

        stream = CameraStream(camera_id=camera_id, url=url, name=name,
                              username=username, password=password,
                              frame_skip=frame_skip, resolution=resolution)
        if old_clients:
            stream.ws_clients = old_clients

        self._streams[camera_id] = stream

        def on_status(status, error=""):
            stream.status     = status
            stream.last_error = error
            asyncio.run_coroutine_threadsafe(
                self.ws.broadcast({"event": "camera_status",
                                   "camera_id": camera_id,
                                   "status": status, "error": error}), loop)

        async def on_detection(frame, result):
            await self._handle_detection(stream, frame, result)

        stream.cap_thread  = CaptureThread(camera_id, stream.build_url(),
                                           name, stream.latest, on_status)
        stream.disp_thread = DisplayThread(camera_id, name, stream.latest,
                                           stream.ws_clients, loop)
        stream.det_thread  = DetectThread(camera_id, name, stream.latest,
                                          self.detector, frame_skip, resolution,
                                          on_detection, loop)

        stream.cap_thread.start()
        stream.disp_thread.start()
        stream.det_thread.start()
        logger.info(f"Threads started: [{name}] {url}")
        return True

    async def stop(self, camera_id):
        stream = self._streams.pop(camera_id, None)
        if not stream: return False
        for t in [stream.cap_thread, stream.disp_thread, stream.det_thread]:
            if t: t.stop()
        await self.ws.broadcast({"event": "camera_status",
                                 "camera_id": camera_id, "status": "offline"})
        return True

    async def stop_all(self):
        for cid in list(self._streams.keys()):
            await self.stop(cid)

    def get_status(self, camera_id):
        s = self._streams.get(camera_id)
        if not s: return None
        return {"camera_id": s.camera_id, "name": s.name,
                "status": s.status, "fps": s.fps, "error": s.last_error}

    def get_all_status(self):
        return [{"camera_id": s.camera_id, "name": s.name,
                 "status": s.status, "fps": s.fps}
                for s in self._streams.values()]

    def is_running(self, camera_id): return camera_id in self._streams
    def get_stream(self, camera_id): return self._streams.get(camera_id)

    async def _handle_detection(self, stream: CameraStream,
                                frame: np.ndarray, result: FrameResult):
        loop = asyncio.get_event_loop()
        h, w = frame.shape[:2]
        annotated = frame.copy()
        top_det   = None

        for d in result.detections:
            if not d.is_drone: continue
            if top_det is None or d.confidence > top_det.confidence:
                top_det = d
            x1 = int(d.bbox["x"]/100*w); y1 = int(d.bbox["y"]/100*h)
            x2 = int((d.bbox["x"]+d.bbox["w"])/100*w)
            y2 = int((d.bbox["y"]+d.bbox["h"])/100*h)
            cv2.rectangle(annotated, (x1,y1), (x2,y2), (0,0,255), 3)
            cv2.putText(annotated, f"DRONE {d.confidence:.0%}",
                        (x1, max(y1-8,14)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,0,255), 2)

        if not top_det: return

        det_id   = uuid.uuid4().hex[:8]
        filename = f"{stream.camera_id}_{int(time.time())}_{det_id}.jpg"
        filepath = DETECTIONS_DIR / filename
        save_ok  = await loop.run_in_executor(
            None, cv2.imwrite, str(filepath), annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])

        thumb = cv2.resize(annotated, (320, 180))
        _, tb = cv2.imencode(".jpg", thumb, [cv2.IMWRITE_JPEG_QUALITY, 60])
        tb64  = base64.b64encode(tb).decode()

        db_id = self.db.save_detection({
            "camera_id": stream.camera_id, "camera_name": stream.name,
            "confidence": top_det.confidence,
            "image_path": str(filepath) if save_ok else None,
            "bbox": top_det.bbox, "inference_ms": result.inference_ms,
            "timestamp": result.timestamp,
        })

        stream.status = "detecting"
        await self.ws.broadcast({
            "event": "drone_detected", "detection_id": db_id,
            "camera_id": stream.camera_id, "camera_name": stream.name,
            "confidence": round(top_det.confidence, 4), "bbox": top_det.bbox,
            "image_path": str(filepath) if save_ok else None,
            "thumbnail": tb64, "timestamp": result.timestamp,
            "inference_ms": result.inference_ms,
        })
        logger.info(f"DRONE [{stream.name}] {top_det.confidence:.1%} {filename}")
        await asyncio.sleep(3)
        if stream.camera_id in self._streams:
            stream.status = "online"