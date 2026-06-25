import time
import numpy as np
from fastapi import APIRouter, Request

router = APIRouter()
START = time.time()


@router.get("/health")
async def health(request: Request):
    detector = request.app.state.detector
    sm       = request.app.state.stream_manager
    return {
        "status":         "ok",
        "uptime_s":       round(time.time() - START, 1),
        "model_ready":    detector.ready,
        "model_device":   detector.device,
        "model_path":     detector.model_path,
        "model_type":     "drone" if detector.ready else "missing",
        "active_streams": len(sm.get_all_status()),
        "streams":        sm.get_all_status(),
    }


@router.post("/test-detection")
async def test_detection(request: Request):
    """
    Inject a synthetic drone detection to test the full pipeline:
    detector → WebSocket event → frontend toast + alarm.
    Use this to verify the notification chain works.
    """
    import asyncio, uuid, time as t
    sm         = request.app.state.stream_manager
    ws_manager = request.app.state.ws_manager
    streams    = sm.get_all_status()

    if not streams:
        return {"ok": False, "error": "No active streams"}

    camera_id   = streams[0]["camera_id"]
    camera_name = streams[0]["name"]
    det_id      = uuid.uuid4().hex[:8]

    await ws_manager.broadcast({
        "event":        "drone_detected",
        "detection_id": det_id,
        "camera_id":    camera_id,
        "camera_name":  camera_name,
        "confidence":   0.92,
        "bbox":         {"x": 35.0, "y": 20.0, "w": 20.0, "h": 15.0},
        "image_path":   None,
        "thumbnail":    None,
        "timestamp":    t.time(),
        "inference_ms": 45.0,
        "test":         True,
    })
    return {"ok": True, "camera_id": camera_id, "detection_id": det_id}


@router.get("/model-info")
async def model_info(request: Request):
    """Returns what drone model is loaded for detection."""
    detector = request.app.state.detector

    if not detector.ready:
        from core.detector import DRONE_MODEL
        return {
            "ready": False,
            "path":  str(DRONE_MODEL),
            "note":  "Place drone.pt in python-backend/models/ and restart the backend.",
        }

    return {
        "ready":  True,
        "type":   "drone",
        "path":   detector.model_path,
        "device": detector.device,
        "note":   "Fine-tuned drone model (drone.pt)",
    }