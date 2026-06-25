import asyncio
import logging
import traceback
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
logger = logging.getLogger("drone-backend.ws")


@router.websocket("/ws")
async def ws_events(websocket: WebSocket):
    ws_manager = websocket.app.state.ws_manager
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
        logger.warning(f"WS event error: {e}")
    finally:
        await ws_manager.disconnect(websocket)


@router.websocket("/ws/video/{camera_id}")
async def ws_video(websocket: WebSocket, camera_id: str):
    sm = websocket.app.state.stream_manager
    await websocket.accept()
    logger.info(f"Video WS accepted: camera={camera_id}")

    # Wait for stream to exist
    stream = sm.get_stream(camera_id)
    if not stream:
        for _ in range(50):
            await asyncio.sleep(0.1)
            stream = sm.get_stream(camera_id)
            if stream:
                break

    if not stream:
        logger.warning(f"Video WS: camera {camera_id} not found after 5s — closing")
        try:
            await websocket.close(code=4004, reason="Camera not found")
        except Exception:
            pass
        return

    stream.ws_clients.add(websocket)
    logger.info(
        f"Video WS connected: camera={camera_id} "
        f"clients={stream.ws_clients.count}"
    )

    try:
        while True:
            msg = await websocket.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("text") == "ping":
                try:
                    await websocket.send_text("pong")
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        # Log at ERROR level with full traceback so we can see what's failing
        logger.error(
            f"Video WS EXCEPTION camera={camera_id}: {e}\n"
            f"{traceback.format_exc()}"
        )
    finally:
        stream.ws_clients.remove(websocket)
        logger.info(f"Video WS disconnected: camera={camera_id}")