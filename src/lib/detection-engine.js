"use client";
/**
 * detection-engine.js
 * ───────────────────
 * Connects to the Python backend WebSocket, syncs camera streams,
 * and pushes settings changes to the backend in real-time.
 */

import { useEffect, useRef } from "react";
import { useCameraStore, useDetectionStore, useSettingsStore } from "@/store";
import { connectWs, startStream, stopStream, bulkSettings } from "@/lib/api";
import { playAlarm } from "@/lib/alarm";
import { sendDesktopNotification } from "@/lib/tauri";
import { toast } from "sonner";

export function useDetectionEngine() {
  const cameras = useCameraStore((s) => s.cameras);
  const setStatus = useCameraStore((s) => s.setStatus);
  const setFps = useCameraStore((s) => s.setFps);
  const addDetection = useDetectionStore((s) => s.add);
  const settings = useSettingsStore();

  // Always-current refs — WS callbacks read these, never stale closures
  const camerasRef = useRef(cameras);
  const settingsRef = useRef(settings);
  camerasRef.current = cameras;
  settingsRef.current = settings;

  // Track sent cameras: Map<id, url>
  // Only URL matters for deciding whether to resend — settings are pushed separately
  const sentRef = useRef(new Map());

  // Flag: WS is connected and backend is ready to accept commands
  const wsReadyRef = useRef(false);

  // Flag: skip the first settingsHash effect (mount)
  const settingsInitRef = useRef(false);

  // ── Send start command ─────────────────────────────────────────────────────
  const sendStart = (cam) => {
    const s = settingsRef.current;
    // Don't call setStatus here - it mutates cameras[] which re-triggers this effect
    // Status is updated via WebSocket "camera_status" events from the backend
    startStream({
      camera_id: cam.id,
      url: cam.url,
      name: cam.name,
      username: cam.username || "",
      password: cam.password || "",
      frame_skip: s.frameSkip ?? 2,
      resolution: s.resolution ?? 416,
      confidence: s.confidenceThreshold ?? 0.35,
    }).catch((err) => {
      console.error(`[engine] startStream "${cam.name}":`, err.message);
    });
  };

  // ── Push detection settings to backend without restarting streams ──────────
  const pushSettings = () => {
    const s = settingsRef.current;
    bulkSettings({
      confidence_threshold: s.confidenceThreshold,
      frame_skip: s.frameSkip,
      resolution: s.resolution,
      gpu_enabled: s.gpuEnabled,
      save_folder: s.saveFolder,
      max_storage_gb: s.maxStorageGB,
    }).catch(() => {}); // silent — backend may not be ready yet
  };

  // ── WS message handler ─────────────────────────────────────────────────────
  const onMessage = (msg) => {
    switch (msg.event) {
      case "connected": {
        wsReadyRef.current = true;
        console.log("[engine] WS connected — starting cameras");

        // Push current settings to backend
        pushSettings();

        // Start all enabled cameras
        camerasRef.current.forEach((cam) => {
          if (cam.enabled) {
            sendStart(cam);
            sentRef.current.set(cam.id, cam.url);
          }
        });
        break;
      }

      case "camera_status":
        setStatus(msg.camera_id, msg.status);
        break;

      case "camera_stats":
        setFps(msg.camera_id, Math.round(msg.fps ?? 0));
        break;

      case "drone_detected": {
        addDetection({
          backendId: msg.detection_id ?? null,
          thumbnail: msg.thumbnail ?? null,
          cameraId: msg.camera_id,
          cameraName: msg.camera_name,
          confidence: msg.confidence,
          imagePath: msg.image_path ?? null,
          bbox: msg.bbox ?? null,
          type: "drone",
        });

        setStatus(msg.camera_id, "detecting");
        setTimeout(() => setStatus(msg.camera_id, "online"), 3000);

        const s = settingsRef.current;

        // Ignore if below user's confidence threshold
        if (msg.confidence < s.confidenceThreshold) break;

        if (s.alarmEnabled && s.soundNotif)
          playAlarm(s.alarmSound, s.alarmVolume);

        if (s.toastNotif) {
          toast.custom(
            () => (
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  background: "hsl(222,47%,8%)",
                  border: "1px solid rgba(239,68,68,.5)",
                  borderRadius: "12px",
                  padding: "12px",
                  minWidth: "280px",
                  boxShadow: "0 8px 32px rgba(0,0,0,.5)",
                }}
              >
                <span
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: "#ef4444",
                    marginTop: "3px",
                    flexShrink: 0,
                    boxShadow: "0 0 8px #ef4444",
                  }}
                />
                <div>
                  <p
                    style={{
                      fontWeight: 700,
                      color: "#f87171",
                      fontSize: "14px",
                      margin: 0,
                    }}
                  >
                    🚨 Drone Detected!
                  </p>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#e2e8f0",
                      margin: "3px 0 0",
                    }}
                  >
                    {msg.camera_name}
                  </p>
                  <p
                    style={{
                      fontSize: "11px",
                      color: "#94a3b8",
                      margin: "2px 0 0",
                    }}
                  >
                    {Math.round(msg.confidence * 100)}% confidence
                    {msg.inference_ms
                      ? ` · ${msg.inference_ms.toFixed(0)}ms`
                      : ""}
                  </p>
                </div>
              </div>
            ),
            { duration: 6000 },
          );
        }

        if (s.desktopNotif)
          sendDesktopNotification(
            "🚨 Drone Detected!",
            `${msg.camera_name} — ${Math.round(msg.confidence * 100)}%`,
          );
        break;
      }

      default:
        break;
    }
  };

  // ── Connect WebSocket once on mount ───────────────────────────────────────
  useEffect(() => {
    connectWs(onMessage);
  }, []); // eslint-disable-line

  // ── Sync camera list → backend (new/removed/toggled cameras) ─────────────
  useEffect(() => {
    // Don't do anything until WS is connected — "connected" event handles initial sync
    if (!wsReadyRef.current) return;

    const currentIds = new Set(cameras.map((c) => c.id));

    // Stop removed cameras
    for (const [id] of sentRef.current) {
      if (!currentIds.has(id)) {
        stopStream(id).catch(() => {});
        sentRef.current.delete(id);
      }
    }

    // Start new or re-enabled cameras
    cameras.forEach((cam) => {
      if (!cam.enabled) {
        if (sentRef.current.has(cam.id)) {
          stopStream(cam.id).catch(() => {});
          sentRef.current.delete(cam.id);
        }
        return;
      }

      const prevUrl = sentRef.current.get(cam.id);
      // Only resend if camera is new or URL changed
      if (prevUrl === undefined || prevUrl !== cam.url) {
        sendStart(cam);
        sentRef.current.set(cam.id, cam.url);
      }
    });
  }, [cameras]); // eslint-disable-line

  // ── Push detection settings to backend when they change ──────────────────
  // Uses POST /api/settings/bulk which updates running threads without restart
  // Skip on first mount (settingsInitRef) — "connected" handler does initial push
  useEffect(() => {
    if (!settingsInitRef.current) {
      settingsInitRef.current = true;
      return;
    }
    if (!wsReadyRef.current) return;
    // Only push settings to backend — do NOT call sendStart()
    // sendStart() causes on_status("connecting") to flash on the camera card
    pushSettings();
  }, [
    settings.confidenceThreshold,
    settings.frameSkip,
    settings.resolution,
    settings.gpuEnabled,
    settings.saveFolder,
  ]); // eslint-disable-line
}
