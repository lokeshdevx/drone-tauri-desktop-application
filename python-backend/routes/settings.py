"""
Settings routes — persist settings to DB and apply to running detector/streams.
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Any

router = APIRouter()


class SetSettingRequest(BaseModel):
    key:   str
    value: Any


class BulkSettingsRequest(BaseModel):
    settings: dict


@router.get("")
async def get_all(request: Request):
    db = request.app.state.stream_manager.db
    return db.get_all_settings()


@router.get("/{key}")
async def get_one(key: str, request: Request):
    db  = request.app.state.stream_manager.db
    val = db.get_setting(key)
    return {"key": key, "value": val}


@router.post("")
async def set_one(body: SetSettingRequest, request: Request):
    db = request.app.state.stream_manager.db
    db.set_setting(body.key, body.value)
    await _apply_setting(request, body.key, body.value)
    return {"ok": True}


@router.post("/bulk")
async def set_bulk(body: BulkSettingsRequest, request: Request):
    db = request.app.state.stream_manager.db
    for k, v in body.settings.items():
        db.set_setting(k, v)
        await _apply_setting(request, k, v)
    return {"ok": True, "count": len(body.settings)}


async def _apply_setting(request: Request, key: str, value: Any):
    """
    Apply a setting change to the running detector and streams immediately.
    No restart needed.
    """
    detector = request.app.state.detector
    sm       = request.app.state.stream_manager

    if key == "confidence_threshold" and value is not None:
        # Update detector threshold immediately
        detector.set_threshold(float(value))
        # Restart all streams with new confidence
        for stream in sm._streams.values():
            stream.cap_thread  # still running — only detector threshold changes

    elif key == "frame_skip" and value is not None:
        # Update frame skip on all running detect threads
        for stream in sm._streams.values():
            if stream.det_thread:
                stream.det_thread.frame_skip = max(0, int(value))

    elif key == "resolution" and value is not None:
        # Update detection resolution on all running detect threads
        for stream in sm._streams.values():
            if stream.det_thread:
                stream.det_thread.det_res = int(value)

    elif key == "gpu_enabled" and value is not None:
        # GPU change requires model reload — log and note
        import logging
        logging.getLogger("drone-backend.settings").info(
            f"GPU setting changed to {value} — will take effect on next model load"
        )