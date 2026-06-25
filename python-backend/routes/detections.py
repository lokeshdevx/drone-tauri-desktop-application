from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from pathlib import Path

router = APIRouter()


class DeleteManyRequest(BaseModel):
    ids: List[str]


@router.get("")
async def list_detections(
    request: Request,
    camera_id: Optional[str] = None,
    min_conf:  float = Query(0.0, ge=0, le=1),
    since:     Optional[float] = None,
    until:     Optional[float] = None,
    limit:     int = Query(100, ge=1, le=1000),
    offset:    int = Query(0, ge=0),
):
    db = request.app.state.stream_manager.db
    rows = db.get_detections(
        camera_id=camera_id,
        min_conf=min_conf,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )
    return {"detections": rows, "count": len(rows)}


@router.get("/stats")
async def stats(request: Request):
    db = request.app.state.stream_manager.db
    return db.stats()


@router.get("/{det_id}")
async def get_detection(det_id: str, request: Request):
    db = request.app.state.stream_manager.db
    row = db.get_detection(det_id)
    if not row:
        raise HTTPException(404, "Detection not found")
    return row


@router.delete("/{det_id}")
async def delete_detection(det_id: str, request: Request):
    db = request.app.state.stream_manager.db
    ok = db.delete_detection(det_id)
    if not ok:
        raise HTTPException(404, "Detection not found")
    return {"ok": True}


@router.post("/delete-many")
async def delete_many(body: DeleteManyRequest, request: Request):
    db = request.app.state.stream_manager.db
    n = db.delete_detections(body.ids)
    return {"deleted": n}


@router.delete("")
async def delete_all(request: Request):
    db = request.app.state.stream_manager.db
    n = db.delete_detections(
        [r["id"] for r in db.get_detections(limit=99999)]
    )
    return {"deleted": n}


@router.get("/{det_id}/image")
async def get_image(det_id: str, request: Request):
    """Serve the saved JPEG for a detection."""
    db = request.app.state.stream_manager.db
    row = db.get_detection(det_id)
    if not row:
        raise HTTPException(404, "Detection not found")
    path = row.get("image_path")
    if not path or not Path(path).exists():
        raise HTTPException(404, "Image file not found")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/cleanup")
async def cleanup(request: Request, older_than_days: int = Query(30, ge=1)):
    db = request.app.state.stream_manager.db
    n = db.cleanup_old(older_than_days)
    return {"deleted": n}