"""
DetectionDB — lightweight SQLite wrapper.
Stores all detections and app settings.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("drone-backend.db")

DB_PATH = Path(__file__).parent.parent / "drone_detections.db"


class DetectionDB:
    def __init__(self, path: Path = DB_PATH):
        self._path = path
        self._init()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init(self):
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS detections (
                    id          TEXT PRIMARY KEY,
                    camera_id   TEXT NOT NULL,
                    camera_name TEXT,
                    confidence  REAL NOT NULL,
                    image_path  TEXT,
                    bbox        TEXT,
                    inference_ms REAL,
                    timestamp   REAL NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_camera  ON detections(camera_id);
                CREATE INDEX IF NOT EXISTS idx_ts      ON detections(timestamp);
                CREATE INDEX IF NOT EXISTS idx_conf    ON detections(confidence);

                CREATE TABLE IF NOT EXISTS settings (
                    key   TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at REAL
                );

                CREATE TABLE IF NOT EXISTS cameras (
                    id       TEXT PRIMARY KEY,
                    name     TEXT,
                    url      TEXT,
                    type     TEXT,
                    username TEXT,
                    password TEXT,
                    location TEXT,
                    enabled  INTEGER DEFAULT 1,
                    created_at REAL
                );
            """)
        logger.info(f"DB initialised at {self._path}")

    # ── Detections ─────────────────────────────────────────────────────────────

    def save_detection(self, data: Dict[str, Any]) -> str:
        det_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO detections
                   (id, camera_id, camera_name, confidence, image_path, bbox, inference_ms, timestamp)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    det_id,
                    data["camera_id"],
                    data.get("camera_name", ""),
                    data["confidence"],
                    data.get("image_path"),
                    json.dumps(data.get("bbox")) if data.get("bbox") else None,
                    data.get("inference_ms", 0),
                    data.get("timestamp", time.time()),
                ),
            )
        return det_id

    def get_detections(
        self,
        camera_id: Optional[str] = None,
        min_conf: float = 0.0,
        since: Optional[float] = None,
        until: Optional[float] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict]:
        clauses = ["confidence >= ?"]
        params: list = [min_conf]

        if camera_id:
            clauses.append("camera_id = ?"); params.append(camera_id)
        if since:
            clauses.append("timestamp >= ?"); params.append(since)
        if until:
            clauses.append("timestamp <= ?"); params.append(until)

        where = " AND ".join(clauses)
        params += [limit, offset]

        with self._conn() as conn:
            rows = conn.execute(
                f"SELECT * FROM detections WHERE {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                params,
            ).fetchall()

        return [self._row_to_dict(r) for r in rows]

    def get_detection(self, det_id: str) -> Optional[Dict]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM detections WHERE id=?", (det_id,)).fetchone()
        return self._row_to_dict(row) if row else None

    def delete_detection(self, det_id: str) -> bool:
        with self._conn() as conn:
            n = conn.execute("DELETE FROM detections WHERE id=?", (det_id,)).rowcount
        return n > 0

    def delete_detections(self, ids: List[str]) -> int:
        placeholders = ",".join(["?"] * len(ids))
        with self._conn() as conn:
            n = conn.execute(f"DELETE FROM detections WHERE id IN ({placeholders})", ids).rowcount
        return n

    def cleanup_old(self, older_than_days: int) -> int:
        cutoff = time.time() - older_than_days * 86400
        with self._conn() as conn:
            n = conn.execute("DELETE FROM detections WHERE timestamp < ?", (cutoff,)).rowcount
        return n

    def stats(self) -> Dict:
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
            today_start = float(int(time.time() // 86400) * 86400)
            today = conn.execute(
                "SELECT COUNT(*) FROM detections WHERE timestamp >= ?", (today_start,)
            ).fetchone()[0]
            avg_conf = conn.execute(
                "SELECT AVG(confidence) FROM detections"
            ).fetchone()[0] or 0
            top_cam_row = conn.execute(
                "SELECT camera_name, COUNT(*) as n FROM detections GROUP BY camera_id ORDER BY n DESC LIMIT 1"
            ).fetchone()
        return {
            "total": total,
            "today": today,
            "avg_confidence": round(avg_conf, 4),
            "top_camera": top_cam_row["camera_name"] if top_cam_row else None,
        }

    # ── Settings ───────────────────────────────────────────────────────────────

    def get_setting(self, key: str, default=None):
        with self._conn() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        if not row:
            return default
        try:
            return json.loads(row["value"])
        except Exception:
            return row["value"]

    def set_setting(self, key: str, value: Any):
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
                (key, json.dumps(value), time.time()),
            )

    def get_all_settings(self) -> Dict:
        with self._conn() as conn:
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
        out = {}
        for r in rows:
            try:
                out[r["key"]] = json.loads(r["value"])
            except Exception:
                out[r["key"]] = r["value"]
        return out

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _row_to_dict(row) -> Dict:
        d = dict(row)
        if d.get("bbox"):
            try:
                d["bbox"] = json.loads(d["bbox"])
            except Exception:
                pass
        return d
