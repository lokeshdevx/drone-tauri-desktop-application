"""
DroneDetector — detects ONLY drones using drone.pt custom model.

Rules:
  1. Only drone.pt is used — generic COCO model is disabled
  2. Only classes whose name contains "drone" are accepted
  3. No motion, edge, texture, color, or Kalman filters
  4. Only two filters: confidence threshold + bbox size sanity check
  5. 2 consecutive frames required before firing alert
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set

import numpy as np

logger = logging.getLogger("drone-backend.detector")

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

CUSTOM_MODEL = MODELS_DIR / "drone.pt"

MIN_CONF       = 0.55   # confidence threshold
MAX_BBOX_AREA  = 0.40   # reject if bbox > 40% of frame (background artifact)
MIN_BBOX_SIZE  = 0.3    # reject if width or height < 0.3% (pixel noise)
CONFIRM_FRAMES = 2      # consecutive frames before alert fires


@dataclass
class Detection:
    class_id:   int
    class_name: str
    confidence: float
    bbox:       dict   # {x, y, w, h} as % of frame
    is_drone:   bool = True

    def to_dict(self):
        return {
            "class_id":   self.class_id,
            "class_name": self.class_name,
            "confidence": round(self.confidence, 4),
            "bbox":       self.bbox,
            "is_drone":   self.is_drone,
        }


@dataclass
class FrameResult:
    camera_id:    str
    timestamp:    float = field(default_factory=time.time)
    detections:   List[Detection] = field(default_factory=list)
    inference_ms: float = 0.0
    frame_shape:  Optional[tuple] = None

    @property
    def has_drone(self) -> bool:
        return any(d.is_drone for d in self.detections)

    def to_dict(self):
        return {
            "camera_id":    self.camera_id,
            "timestamp":    self.timestamp,
            "has_drone":    self.has_drone,
            "inference_ms": round(self.inference_ms, 1),
            "detections":   [d.to_dict() for d in self.detections],
        }


class DroneDetector:
    def __init__(self):
        self._model            = None
        self._device           = "cpu"
        self._ready            = False
        self._load_lock        = asyncio.Lock()
        self._drone_class_ids: Set[int] = set()
        self._history: Dict[str, deque] = defaultdict(
            lambda: deque(maxlen=CONFIRM_FRAMES)
        )

    async def load(self, force_cpu: bool = False) -> bool:
        async with self._load_lock:
            if self._ready:
                return True
            ok = await asyncio.get_event_loop().run_in_executor(
                None, self._load_sync, force_cpu
            )
            self._ready = ok
            return ok

    def infer(self, frame: np.ndarray, camera_id: str = "?") -> FrameResult:
        result = FrameResult(camera_id=camera_id, frame_shape=frame.shape[:2])
        if not self._ready or self._model is None:
            return result

        try:
            t0 = time.perf_counter()

            candidates = self._detect(frame)
            result.inference_ms = (time.perf_counter() - t0) * 1000
            result.detections = candidates

            # Temporal confirmation — must appear in N consecutive frames
            has_candidate = bool(candidates)
            hist = self._history[camera_id]
            hist.append(has_candidate)
            confirmed = len(hist) == CONFIRM_FRAMES and all(hist)

            if not confirmed:
                for d in result.detections:
                    d.is_drone = False

            if confirmed:
                best = max(candidates, key=lambda d: d.confidence)
                logger.info(
                    f"[{camera_id}] DRONE DETECTED "
                    f"conf={best.confidence:.0%} "
                    f"inf={result.inference_ms:.0f}ms"
                )

        except Exception as e:
            logger.error(f"Inference error [{camera_id}]: {e}")

        return result

    def set_threshold(self, threshold: float):
        pass  # threshold fixed at MIN_CONF

    @property
    def ready(self):
        return self._ready
    
    @property
    def device(self):
        return self._device
    
    @property
    def model_path(self):
        return str(CUSTOM_MODEL)

    # ── Private ────────────────────────────────────────────────────────────────

    def _load_sync(self, force_cpu: bool) -> bool:
        try:
            from ultralytics import YOLO
            import torch

            # Device selection
            if not force_cpu and torch.cuda.is_available():
                self._device = "cuda"
            elif not force_cpu and getattr(
                    getattr(torch, "backends", None), "mps", None) \
                    and torch.backends.mps.is_available():
                self._device = "mps"
            else:
                self._device = "cpu"

            # drone.pt is mandatory
            if not CUSTOM_MODEL.exists():
                logger.error(
                    f"drone.pt not found at {CUSTOM_MODEL}\n"
                    f"Download a drone detection model and place it there.\n"
                    f"Detection will NOT work without this file."
                )
                return False

            logger.info(f"Loading drone.pt from {CUSTOM_MODEL}")
            self._model = YOLO(str(CUSTOM_MODEL))
            self._model.conf = MIN_CONF
            self._model.iou = 0.45

            # Read class names from model
            all_classes = self._model.names
            logger.info(f"Model classes: {all_classes}")

            self._drone_class_ids = set()
            for cls_id, cls_name in all_classes.items():
                name = cls_name.lower().strip()
                # Accept only if name explicitly contains a drone keyword
                is_drone = any(kw in name for kw in (
                    "drone", "uav", "quadcopter", "multirotor",
                    "copter", "aircraft", "helicopter",
                ))
                is_not_drone = any(kw in name for kw in (
                    "person", "people", "human", "face", "head",
                    "man", "woman", "child", "body", "pedestrian",
                    "car", "truck", "bus", "bike", "vehicle",
                    "dog", "cat", "bird", "animal",
                ))
                if is_drone and not is_not_drone:
                    self._drone_class_ids.add(int(cls_id))
                    logger.info(f"  → Drone class [{cls_id}] '{cls_name}' ✅")
                else:
                    logger.info(f"  → Ignored class [{cls_id}] '{cls_name}' ❌")

            # If model has only ONE class, treat it as drone regardless of name
            if not self._drone_class_ids and len(all_classes) == 1:
                self._drone_class_ids = {0}
                logger.info("Single-class model — treating class 0 as drone")

            if not self._drone_class_ids:
                logger.error(
                    f"No drone class found in model!\n"
                    f"Classes: {all_classes}\n"
                    f"Check that drone.pt is actually a drone detection model."
                )
                return False

            # Warm-up pass
            dummy = np.zeros((416, 416, 3), dtype=np.uint8)
            self._model(dummy, verbose=False)

            logger.info(
                f"Detector ready — device={self._device} "
                f"drone_classes={self._drone_class_ids} "
                f"conf={MIN_CONF} "
                f"confirm={CONFIRM_FRAMES} frames"
            )
            return True

        except ImportError:
            logger.error("ultralytics not installed — run: pip install ultralytics")
            return False
        except Exception as e:
            logger.error(f"Failed to load drone.pt: {e}")
            return False

    def _detect(self, frame: np.ndarray) -> List[Detection]:
        """
        Run drone.pt inference.
        Returns ONLY confirmed drone detections that pass size checks.
        Ignores every non-drone class completely.
        """
        h, w = frame.shape[:2]

        results = self._model(
            frame,
            conf=MIN_CONF,
            verbose=False,
            device=self._device,
        )

        found: List[Detection] = []

        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                cls_name = self._model.names.get(cls_id, str(cls_id))

                # Skip if this class is not a drone class
                if cls_id not in self._drone_class_ids:
                    continue

                x1, y1, x2, y2 = box.xyxy[0].tolist()
                bw = (x2 - x1) / w * 100
                bh = (y2 - y1) / h * 100

                # Reject if covers too much of the frame (background artifact)
                if (bw * bh) / 10_000 > MAX_BBOX_AREA:
                    logger.debug(f"Rejected: bbox too large ({bw:.1f}x{bh:.1f}%)")
                    continue

                # Reject pixel noise
                if bw < MIN_BBOX_SIZE or bh < MIN_BBOX_SIZE:
                    logger.debug(f"Rejected: bbox too small ({bw:.2f}x{bh:.2f}%)")
                    continue

                found.append(Detection(
                    class_id=cls_id,
                    class_name=cls_name,
                    confidence=conf,
                    bbox={
                        "x": round(x1 / w * 100, 2),
                        "y": round(y1 / h * 100, 2),
                        "w": round(bw, 2),
                        "h": round(bh, 2),
                    },
                    is_drone=True,
                ))

        return found