"""
Drone Detection Backend — self-contained single file.
All routes defined inline so missing route files cannot break startup.
"""

import sys, os, asyncio, logging, signal, socket, time, uuid, base64, json
from pathlib import Path
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List, Any

BASE_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(BASE_DIR))

# ── Logging ────────────────────────────────────────────────────────────────────
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / "backend.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("drone-backend")

# ── Core imports ───────────────────────────────────────────────────────────────
from core.detector import DroneDetector
from core.stream_manager import StreamManager
from core.ws_manager import WebSocketManager
from utils.db import DetectionDB

detector       = DroneDetector()
ws_manager     = WebSocketManager()
stream_manager = StreamManager(detector=detector, ws_manager=ws_manager)
db             = DetectionDB()

# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("═══ Drone Detection Backend starting up ═══")
    await detector.load()
    app.state.detector       = detector
    app.state.ws_manager     = ws_manager
    app.state.stream_manager = stream_manager
    logger.info("Backend ready on http://localhost:7000")
    yield
    logger.info("Shutting down…")
    await stream_manager.stop_all()

app = FastAPI(title="Drone Detection Backend", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model":  detector.model_path,
        "device": detector.device,
        "ready":  detector.ready,
    }

@app.get("/api/model-info")
async def model_info():
    return {"model": detector.model_path, "device": detector.device, "ready": detector.ready}

# ── Camera routes ──────────────────────────────────────────────────────────────
class StartRequest(BaseModel):
    camera_id:  str
    url:        str
    name:       str        = ""
    username:   str        = ""
    password:   str        = ""
    frame_skip: int        = 2
    resolution: int        = 416
    confidence: float      = 0.45

class TestConnectionRequest(BaseModel):
    url:      str
    username: str   = ""
    password: str   = ""
    timeout:  int   = 8000

@app.post("/api/cameras/start")
async def camera_start(body: StartRequest):
    ok = await stream_manager.start(
        camera_id  = body.camera_id,
        url        = body.url,
        name       = body.name or body.camera_id,
        username   = body.username,
        password   = body.password,
        frame_skip = body.frame_skip,
        resolution = body.resolution,
        confidence = body.confidence,
    )
    return {"ok": ok}

@app.post("/api/cameras/stop/{camera_id}")
async def camera_stop(camera_id: str):
    ok = await stream_manager.stop(camera_id)
    return {"ok": ok}

@app.get("/api/cameras/status")
async def cameras_status():
    return stream_manager.get_all_status()

@app.get("/api/cameras/status/{camera_id}")
async def camera_status(camera_id: str):
    s = stream_manager.get_status(camera_id)
    if not s:
        raise HTTPException(404, "Camera not found")
    return s

@app.post("/api/cameras/test")
async def test_connection(body: TestConnectionRequest):
    import cv2
    url = body.url.strip()
    if body.username and body.password and "://" in url:
        scheme, rest = url.split("://", 1)
        if "@" not in rest:
            url = f"{scheme}://{body.username}:{body.password}@{rest}"

    def _test():
        t0 = time.time()
        if url.lower().startswith("rtsp://"):
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;8000000"
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        elif url.isdigit():
            cap = cv2.VideoCapture(int(url))
        else:
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "stimeout;8000000|fflags;nobuffer"
            cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        ok = False
        if cap.isOpened():
            ok, _ = cap.read()
        cap.release()
        return ok, round((time.time() - t0) * 1000)

    loop = asyncio.get_event_loop()
    try:
        ok, ms = await asyncio.wait_for(loop.run_in_executor(None, _test), timeout=12)
        return {"ok": ok, "latency_ms": ms}
    except asyncio.TimeoutError:
        return {"ok": False, "latency_ms": None, "error": "Timeout"}
    except Exception as e:
        return {"ok": False, "latency_ms": None, "error": str(e)}

@app.post("/api/test-detection")
async def test_detection():
    import numpy as np
    frame = (np.random.rand(416, 416, 3) * 255).astype("uint8")
    result = detector.infer(frame, "test")
    await ws_manager.broadcast({
        "event": "drone_detected",
        "camera_id": "test",
        "camera_name": "Test",
        "confidence": 0.99,
        "bbox": {"x": 30, "y": 30, "w": 20, "h": 20},
        "timestamp": time.time(),
        "inference_ms": result.inference_ms,
        "thumbnail": "",
    })
    return {"ok": True, "inference_ms": result.inference_ms}

# ── Detection routes ───────────────────────────────────────────────────────────
@app.get("/api/detections")
async def list_detections(
    camera_id: Optional[str] = None,
    min_conf:  float = Query(0.0, ge=0, le=1),
    since:     Optional[float] = None,
    until:     Optional[float] = None,
    limit:     int = Query(100, ge=1, le=1000),
    offset:    int = Query(0, ge=0),
):
    rows = db.get_detections(camera_id=camera_id, min_conf=min_conf,
                              since=since, until=until, limit=limit, offset=offset)
    return {"detections": rows, "count": len(rows)}

@app.get("/api/detections/stats")
async def detection_stats():
    return db.stats()

@app.get("/api/detections/{det_id}")
async def get_detection(det_id: str):
    row = db.get_detection(det_id)
    if not row: raise HTTPException(404, "Detection not found")
    return row

@app.delete("/api/detections/{det_id}")
async def delete_detection(det_id: str):
    ok = db.delete_detection(det_id)
    if not ok: raise HTTPException(404, "Detection not found")
    return {"ok": True}

@app.delete("/api/detections")
async def delete_all_detections():
    n = db.delete_detections([r["id"] for r in db.get_detections(limit=99999)])
    return {"deleted": n}

@app.get("/api/detections/{det_id}/image")
async def get_image(det_id: str):
    row = db.get_detection(det_id)
    if not row: raise HTTPException(404, "Detection not found")
    path = row.get("image_path")
    if not path or not Path(path).exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(path, media_type="image/jpeg")

# ── Settings routes ────────────────────────────────────────────────────────────
class BulkSettingsRequest(BaseModel):
    settings: dict

@app.get("/api/settings")
async def get_settings():
    return db.get_all_settings()

@app.post("/api/settings/bulk")
async def bulk_settings(body: BulkSettingsRequest):
    saved = 0
    for key, value in body.settings.items():
        db.set_setting(key, value)
        saved += 1
        if key == "gpu_enabled":
            pass  # takes effect on next model load
        elif key == "confidence_threshold":
            detector.set_threshold(float(value))
        elif key in ("frame_skip", "resolution"):
            for s in stream_manager._streams.values():
                if s.det_thread:
                    if key == "frame_skip":
                        s.det_thread.frame_skip = max(0, int(value))
                    else:
                        s.det_thread.det_res = int(value)
    return {"ok": True, "saved": saved}

# ── WebSocket routes ───────────────────────────────────────────────────────────
@app.websocket("/ws")
async def ws_events(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("text") == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WS error: {e}")
    finally:
        await ws_manager.disconnect(websocket)

@app.websocket("/ws/video/{camera_id}")
async def ws_video(websocket: WebSocket, camera_id: str):
    sm = stream_manager
    await websocket.accept()
    logger.info(f"Video WS accepted: camera={camera_id}")

    # Wait for stream to exist (up to 5s)
    stream = sm.get_stream(camera_id)
    if not stream:
        for _ in range(50):
            await asyncio.sleep(0.1)
            stream = sm.get_stream(camera_id)
            if stream:
                break

    if not stream:
        logger.warning(f"Video WS: camera {camera_id} not found — closing")
        try: await websocket.close(code=4004)
        except Exception: pass
        return

    stream.ws_clients.add(websocket)
    logger.info(f"Video WS connected: camera={camera_id} clients={stream.ws_clients.count}")

    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("text") == "ping":
                try: await websocket.send_text("pong")
                except Exception: break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Video WS error camera={camera_id}: {e}")
    finally:
        stream.ws_clients.remove(websocket)
        logger.info(f"Video WS disconnected: camera={camera_id}")

# ── Port helpers ───────────────────────────────────────────────────────────────
def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) != 0

def find_port(start: int = 7000) -> int:
    for p in range(start, start + 20):
        if port_free(p): return p
    return start

# ── Entry ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("DRONE_PORT", find_port(7000)))
    logger.info(f"Starting on port {port}")
    (BASE_DIR / ".port").write_text(str(port))
    uvicorn.run("main:app", host="127.0.0.1", port=port,
                log_level="warning", reload=False, workers=1)

# rtsp://admin:Admin123@192.168.1.77:554/stream1
# rtsp://admin:Admin123@192.168.1.80:554/stream1
# rtsp://user:User123@192.168.1.182:554/stream1




