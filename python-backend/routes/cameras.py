from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import asyncio
import cv2
import os
import time
import numpy as np

router = APIRouter()


class StartStreamRequest(BaseModel):
    camera_id:  str
    url:        str
    name:       Optional[str] = ""
    username:   Optional[str] = ""
    password:   Optional[str] = ""
    frame_skip: Optional[int] = 2
    resolution: Optional[int] = 416
    confidence: Optional[float] = 0.45


class TestConnectionRequest(BaseModel):
    url:      str
    username: Optional[str] = ""
    password: Optional[str] = ""
    timeout:  Optional[int] = 8000


@router.post("/start")
async def start_stream(body: StartStreamRequest, request: Request):
    sm = request.app.state.stream_manager
    ok = await sm.start(
        camera_id=body.camera_id,
        url=body.url,
        name=body.name or body.camera_id,
        username=body.username or "",
        password=body.password or "",
        frame_skip=body.frame_skip,
        resolution=body.resolution,
        confidence=body.confidence,
    )
    return {"ok": ok, "camera_id": body.camera_id}


@router.post("/stop/{camera_id}")
async def stop_stream(camera_id: str, request: Request):
    sm = request.app.state.stream_manager
    ok = await sm.stop(camera_id)
    return {"ok": ok, "camera_id": camera_id}


@router.get("/status")
async def all_status(request: Request):
    return request.app.state.stream_manager.get_all_status()


@router.get("/status/{camera_id}")
async def camera_status(camera_id: str, request: Request):
    s = request.app.state.stream_manager.get_status(camera_id)
    if not s:
        raise HTTPException(404, "Camera not found")
    return s


@router.post("/test")
async def test_connection(body: TestConnectionRequest, request: Request):
    """
    Test camera connectivity. Uses stream_probe to discover the working
    stream URL dynamically — no hardcoded paths.
    Returns the resolved stream URL so the frontend can show what was found.
    """
    from core.stream_probe import probe as probe_url
    import cv2

    url = body.url.strip()
    if body.username and body.password and "://" in url:
        scheme, rest = url.split("://", 1)
        if "@" not in rest:
            url = f"{scheme}://{body.username}:{body.password}@{rest}"

    loop = asyncio.get_event_loop()
    timeout_s = min(body.timeout / 1000 + 2, 20.0)

    def _test():
        t0 = time.time()
        # Discover the working stream URL
        resolved = probe_url(url, timeout=min(timeout_s - 0.5, 12.0))

        # Open and read one frame to confirm it works
        if resolved.isdigit():
            cap = cv2.VideoCapture(int(resolved))
        elif resolved.lower().startswith("rtsp"):
            import os as _os
            _os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;8000000"
            cap = cv2.VideoCapture(resolved, cv2.CAP_FFMPEG)
        else:
            import os as _os
            _os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "stimeout;8000000|fflags;nobuffer"
            cap = cv2.VideoCapture(resolved, cv2.CAP_FFMPEG)

        ok = False
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            ok, _ = cap.read()
        cap.release()
        ms = round((time.time() - t0) * 1000)
        return ok, ms, resolved

    try:
        ok, ms, resolved = await asyncio.wait_for(
            loop.run_in_executor(None, _test),
            timeout=timeout_s,
        )
        return {
            "ok":           ok,
            "latency_ms":   ms,
            "resolved_url": resolved if resolved != url else None,
        }
    except asyncio.TimeoutError:
        return {"ok": False, "latency_ms": None, "error": "Timeout — camera unreachable"}
    except Exception as e:
        return {"ok": False, "latency_ms": None, "error": str(e)}


@router.get("/mjpeg/{camera_id}")
async def mjpeg_stream(camera_id: str, request: Request):
    """
    MJPEG stream — full camera framerate, minimal latency.

    Architecture:
      - DetectThread encodes JPEG and writes to FrameBuffer
      - FrameBuffer.wait_and_get() blocks in a thread until new frame ready
      - We run that blocking call in an executor so the event loop stays free
      - No sleep() anywhere in the hot path

    Result: frames delivered the instant they come off the camera,
    not on a timer. Real latency = camera latency + encode time (~5ms).
    """
    sm = request.app.state.stream_manager

    # Black placeholder JPEG for when stream isn't ready yet
    def _black_frame(msg: str = "") -> bytes:
        img = np.zeros((240, 426, 3), dtype=np.uint8)
        if msg:
            cv2.putText(img, msg, (10, 120),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (80, 80, 80), 1)
        _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 50])
        return buf.tobytes()

    BOUNDARY = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"

    async def generate():
        loop = asyncio.get_event_loop()

        while True:
            if await request.is_disconnected():
                break

            stream = sm.get_stream(camera_id)

            if stream is None:
                # Camera was removed
                yield BOUNDARY + _black_frame("Camera stopped") + b"\r\n"
                break

            if stream.frame_buf.get_latest() is None:
                # No frames yet — non-blocking placeholder
                yield BOUNDARY + _black_frame("Connecting...") + b"\r\n"
                await asyncio.sleep(0.2)
                continue

            # Block in thread until new frame arrives (max 1 second)
            # This is the ONLY place we wait — and it's event-driven not polling
            jpeg = await loop.run_in_executor(
                None,
                stream.frame_buf.wait_and_get,
                1.0,   # timeout seconds
            )

            if jpeg:
                yield BOUNDARY + jpeg + b"\r\n"
            # If timeout (jpeg is None) — loop again, don't yield stale frame

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control":   "no-cache, no-store, must-revalidate",
            "Pragma":          "no-cache",
            "Access-Control-Allow-Origin": "*",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/snapshot/{camera_id}")
async def snapshot(camera_id: str, request: Request):
    sm = request.app.state.stream_manager
    stream = sm.get_stream(camera_id)
    if not stream:
        raise HTTPException(404, "Camera not running")
    jpeg = stream.frame_buf.get_latest()
    if not jpeg:
        raise HTTPException(503, "No frame yet")
    import base64
    return {"camera_id": camera_id, "image": base64.b64encode(jpeg).decode()}