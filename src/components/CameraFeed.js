"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  AlertCircle,
  WifiOff,
  Zap,
  Clock,
  Maximize2,
  Loader2,
} from "lucide-react";
import { useCameraStore, useDetectionStore } from "@/store";
import { cn, STATUS_CONFIG, formatDate } from "@/lib/utils";

const ACTIVE = new Set(["connecting", "online", "detecting", "error"]);
const CLOSE_DELAY_MS = 500;

// ── Backend WS URL — waits for confirmed port from Tauri ──────────────────────
let _wsBaseCache = null;
let _wsBasePromise = null;

function getWsBase() {
  if (_wsBaseCache) return Promise.resolve(_wsBaseCache);
  if (!_wsBasePromise) {
    _wsBasePromise = import("@/lib/api")
      .then((m) => m.getWsBase())
      .then((url) => {
        _wsBaseCache = url;
        return url;
      })
      .catch(() => {
        _wsBaseCache = "ws://127.0.0.1:7000";
        return _wsBaseCache;
      });
  }
  return _wsBasePromise;
}

// ── Shared WS registry ────────────────────────────────────────────────────────
// One WebSocket per cameraId shared across all CameraFeed instances.
const registry = {};

function wsSubscribe(cameraId, onFrame) {
  if (registry[cameraId]?.closeTimer) {
    clearTimeout(registry[cameraId].closeTimer);
    registry[cameraId].closeTimer = null;
  }
  if (!registry[cameraId]) {
    registry[cameraId] = {
      ws: null,
      subs: new Set(),
      retryTimer: null,
      pingInterval: null,
      closeTimer: null,
    };
  }
  registry[cameraId].subs.add(onFrame);
  const entry = registry[cameraId];
  if (!entry.ws || entry.ws.readyState === WebSocket.CLOSED) {
    wsOpen(cameraId);
  }
}

function wsUnsubscribe(cameraId, onFrame) {
  const entry = registry[cameraId];
  if (!entry) return;
  entry.subs.delete(onFrame);
  if (entry.subs.size === 0) {
    entry.closeTimer = setTimeout(() => wsDestroy(cameraId), CLOSE_DELAY_MS);
  }
}

function wsDestroy(cameraId) {
  const entry = registry[cameraId];
  if (!entry || entry.subs.size > 0) return;
  clearTimeout(entry.retryTimer);
  clearTimeout(entry.closeTimer);
  clearInterval(entry.pingInterval);
  if (entry.ws) {
    const ws = entry.ws;
    entry.ws = null;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch (_) {}
  }
  delete registry[cameraId];
}

function wsOpen(cameraId) {
  const entry = registry[cameraId];
  if (!entry) return;

  // Kill existing socket
  if (entry.ws) {
    const old = entry.ws;
    entry.ws = null;
    old.onopen = old.onmessage = old.onerror = old.onclose = null;
    try {
      old.close();
    } catch (_) {}
  }
  clearInterval(entry.pingInterval);
  clearTimeout(entry.retryTimer);

  // Wait for confirmed backend port before opening — prevents wrong-port on cold start
  getWsBase().then((wsBase) => {
    // Bail if entry was destroyed while we were waiting
    if (registry[cameraId] !== entry) return;

    const ws = new WebSocket(`${wsBase}/ws/video/${cameraId}`);
    ws.binaryType = "arraybuffer";
    entry.ws = ws;

    ws.onopen = () => {
      if (registry[cameraId] !== entry) return;
      entry.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, 10_000);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string" || registry[cameraId] !== entry) return;
      entry.subs.forEach((fn) => {
        try {
          fn(ev.data);
        } catch (_) {}
      });
    };

    ws.onclose = () => {
      clearInterval(entry.pingInterval);
      if (registry[cameraId] !== entry || entry.subs.size === 0) return;
      entry.retryTimer = setTimeout(() => wsOpen(cameraId), 2000);
    };

    ws.onerror = () => {
      clearInterval(entry.pingInterval);
    };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CameraFeed({ camera, onClick, compact = false }) {
  const setFps = useCameraStore((s) => s.setFps);
  const detections = useDetectionStore((s) => s.byCamera(camera.id));
  const latest = detections[0];

  const canvasRef = useRef(null);
  const mountedRef = useRef(true);
  const fpsCount = useRef(0);
  const hasFrameRef = useRef(false);
  const pendingRef = useRef(false);

  const [hasFrame, setHasFrame] = useState(false);
  const [showBbox, setShowBbox] = useState(false);

  const shouldConnect = camera.enabled && ACTIVE.has(camera.status);

  const onFrame = useCallback((data) => {
    if (!mountedRef.current || !canvasRef.current) return;
    if (pendingRef.current) return;
    pendingRef.current = true;

    createImageBitmap(new Blob([data], { type: "image/jpeg" }))
      .then((bitmap) => {
        if (!mountedRef.current || !canvasRef.current) {
          bitmap.close();
          return;
        }
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        fpsCount.current += 1;
        if (!hasFrameRef.current) {
          hasFrameRef.current = true;
          setHasFrame(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        pendingRef.current = false;
      });
  }, []);

  useEffect(() => {
    if (!shouldConnect) {
      hasFrameRef.current = false;
      setHasFrame(false);
      return;
    }
    wsSubscribe(camera.id, onFrame);
    return () => wsUnsubscribe(camera.id, onFrame);
  }, [shouldConnect, camera.id, onFrame]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const fps = fpsCount.current * 2;
      fpsCount.current = 0;
      if (fps > 0) setFps(camera.id, fps);
    }, 500);
    return () => clearInterval(t);
  }, [camera.id, setFps]);

  useEffect(() => {
    if (!latest) return;
    setShowBbox(true);
    const t = setTimeout(() => setShowBbox(false), 4000);
    return () => clearTimeout(t);
  }, [latest?.id]); // eslint-disable-line

  const cfg = STATUS_CONFIG[camera.status] || STATUS_CONFIG.offline;
  const isOnline = camera.status === "online" || camera.status === "detecting";
  const showVideo = hasFrame && isOnline;

  return (
    <div
      onClick={() => onClick?.(camera)}
      className={cn(
        "relative bg-black rounded-xl overflow-hidden border transition-all cursor-pointer group select-none",
        camera.status === "detecting"
          ? "border-red-500/60 shadow-lg shadow-red-500/20"
          : "border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10",
      )}
      style={{ aspectRatio: "16/9" }}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 w-full h-full object-cover",
          showVideo ? "opacity-100" : "opacity-0",
        )}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          {camera.status === "connecting" || (shouldConnect && !hasFrame) ? (
            <>
              <Loader2
                size={compact ? 18 : 28}
                className="text-yellow-500 animate-spin"
              />
              <p className="text-xs text-yellow-400">
                {camera.status === "connecting"
                  ? "Connecting…"
                  : "Loading stream…"}
              </p>
            </>
          ) : camera.status === "error" ? (
            <>
              <WifiOff size={compact ? 18 : 28} className="text-red-400/60" />
              <p className="text-xs text-red-400/60 text-center px-3">
                Stream error — retrying…
              </p>
            </>
          ) : (
            <>
              <WifiOff
                size={compact ? 18 : 28}
                className="text-muted-foreground/30"
              />
              <p className="text-xs text-muted-foreground/50 capitalize">
                {cfg.label}
              </p>
            </>
          )}
        </div>
      )}

      {showBbox && latest?.bbox && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${latest.bbox.x}%`,
            top: `${latest.bbox.y}%`,
            width: `${latest.bbox.w}%`,
            height: `${latest.bbox.h}%`,
            border: "2px solid #ef4444",
            boxShadow: "0 0 12px rgba(239,68,68,.7)",
          }}
        >
          <div className="absolute -top-5 left-0 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
            DRONE {Math.round((latest.confidence ?? 0) * 100)}%
          </div>
        </div>
      )}

      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1.5 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-1.5">
          <span className={cn("status-dot", camera.status)} />
          {!compact && (
            <span className="text-xs font-medium text-white truncate max-w-[160px] drop-shadow">
              {camera.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {camera.fps > 0 && (
            <span className="flex items-center gap-0.5 text-white/70 text-xs">
              <Zap size={10} /> {camera.fps}
            </span>
          )}
          {detections.length > 0 && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-500/80 text-white text-xs font-bold">
              <AlertCircle size={10} /> {detections.length}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick?.(camera);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/20 pointer-events-auto"
          >
            <Maximize2 size={12} className="text-white" />
          </button>
        </div>
      </div>

      {!compact && (
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50 truncate">
              {camera.location || camera.type?.toUpperCase()}
            </span>
            {latest && (
              <span className="flex items-center gap-1 text-orange-400 text-xs">
                <Clock size={10} /> {formatDate(latest.timestamp)}
              </span>
            )}
          </div>
        </div>
      )}

      {camera.status === "detecting" && (
        <div className="absolute inset-0 border-2 border-red-500 rounded-xl pointer-events-none animate-pulse" />
      )}
    </div>
  );
}
