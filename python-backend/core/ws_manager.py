"""
WebSocketManager
─────────────────
Manages all connected WebSocket clients and broadcasts JSON events.

Events emitted:
  • drone_detected    — new drone detection
  • camera_status     — camera online / offline / error
  • camera_stats      — periodic FPS + inference stats
  • backend_ready     — emitted once after startup
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Set

from fastapi import WebSocket

logger = logging.getLogger("drone-backend.ws")


class WebSocketManager:
    def __init__(self):
        self._clients: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._clients.add(ws)
        logger.info(f"WS client connected — total: {len(self._clients)}")
        # Send current state immediately
        await ws.send_json({"event": "connected", "clients": len(self._clients)})

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._clients.discard(ws)
        logger.info(f"WS client disconnected — total: {len(self._clients)}")

    async def broadcast(self, data: dict):
        """Send JSON to all connected clients; drop dead connections."""
        if not self._clients:
            return
        dead = set()
        msg = json.dumps(data)
        async with self._lock:
            clients = set(self._clients)
        for ws in clients:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._clients -= dead

    async def send_to(self, ws: WebSocket, data: dict):
        """Send JSON to a specific client."""
        try:
            await ws.send_json(data)
        except Exception:
            await self.disconnect(ws)

    @property
    def count(self) -> int:
        return len(self._clients)
