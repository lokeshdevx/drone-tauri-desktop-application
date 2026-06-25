import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Camera Store ──────────────────────────────────────────────────────────────
export const useCameraStore = create(
  persist(
    (set, get) => ({
      cameras: [],
      focusedId: null,

      addCamera: (data) =>
        set((s) => ({
          cameras: [
            ...s.cameras,
            {
              id: data.id || `cam_${Date.now()}`, // accept pre-generated id
              name: data.name,
              type: data.type || "rtsp",
              url: data.url,
              username: data.username || "",
              password: data.password || "",
              location: data.location || "",
              enabled: true,
              status: "connecting",
              createdAt: new Date().toISOString(),
              fps: 0,
              lastDetection: null,
            },
          ],
        })),

      updateCamera: (id, patch) =>
        set((s) => ({
          cameras: s.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      removeCamera: (id) =>
        set((s) => ({
          cameras: s.cameras.filter((c) => c.id !== id),
          focusedId: s.focusedId === id ? null : s.focusedId,
        })),

      setStatus: (id, status) =>
        set((s) => ({
          cameras: s.cameras.map((c) => (c.id === id ? { ...c, status } : c)),
        })),

      setFps: (id, fps) =>
        set((s) => ({
          cameras: s.cameras.map((c) => (c.id === id ? { ...c, fps } : c)),
        })),

      setFocused: (id) => set({ focusedId: id }),
      clearFocused: () => set({ focusedId: null }),

      getCamera: (id) => get().cameras.find((c) => c.id === id),
      getEnabled: () => get().cameras.filter((c) => c.enabled),
    }),
    { name: "drone-cameras" },
  ),
);

// ─── Detection Store ───────────────────────────────────────────────────────────
export const useDetectionStore = create(
  persist(
    (set, get) => ({
      detections: [],

      add: (det) =>
        set((s) => ({
          detections: [
            {
              id: `det_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              backendId: det.backendId || null, // real DB id for image URL
              thumbnail: det.thumbnail || null, // base64 JPEG from backend
              cameraId: det.cameraId,
              cameraName: det.cameraName,
              confidence: det.confidence,
              imagePath: det.imagePath || null,
              bbox: det.bbox || null,
              timestamp: new Date().toISOString(),
              type: det.type || "drone",
            },
            ...s.detections,
          ].slice(0, 2000),
        })),

      remove: (id) =>
        set((s) => ({ detections: s.detections.filter((d) => d.id !== id) })),

      removeMany: (ids) =>
        set((s) => ({
          detections: s.detections.filter((d) => !ids.includes(d.id)),
        })),

      clearAll: () => set({ detections: [] }),

      byCamera: (cameraId) =>
        get().detections.filter((d) => d.cameraId === cameraId),

      filtered: ({
        search = "",
        camera = "all",
        minConf = 0,
        date = null,
      } = {}) => {
        return get().detections.filter((d) => {
          if (camera !== "all" && d.cameraId !== camera) return false;
          if (d.confidence < minConf) return false;
          if (
            search &&
            !d.cameraName.toLowerCase().includes(search.toLowerCase())
          )
            return false;
          if (date) {
            const day = new Date(date).toDateString();
            if (new Date(d.timestamp).toDateString() !== day) return false;
          }
          return true;
        });
      },
    }),
    { name: "drone-detections" },
  ),
);

// ─── Settings Store ────────────────────────────────────────────────────────────
export const useSettingsStore = create(
  persist(
    (set) => ({
      // General
      theme: "dark",
      startOnBoot: false,
      minimizeToTray: true,
      autoReconnect: true,

      // Detection
      confidenceThreshold: 0.35,
      detectionInterval: 150,
      frameSkip: 2,
      gpuEnabled: true,
      resolution: 416,

      // Alarm
      alarmEnabled: true,
      alarmSound: "siren",
      alarmVolume: 0.8,

      // Storage
      saveFolder: null,
      maxStorageGB: 10,
      autoDelete: false,
      autoDeleteDays: 30,

      // Notifications
      desktopNotif: true,
      toastNotif: true,
      soundNotif: true,

      // Camera defaults
      streamQuality: "medium",
      reconnectAttempts: 5,
      timeout: 15000,

      update: (patch) => set((s) => ({ ...s, ...patch })),
    }),
    { name: "drone-settings" },
  ),
);

// ─── UI Store (not persisted) ──────────────────────────────────────────────────
export const useUIStore = create((set) => ({
  page: "dashboard",
  sidebarOpen: true,
  addCameraOpen: false,
  editCamera: null,

  setPage: (page) => set({ page }),
  setSidebar: (v) => set({ sidebarOpen: v }),
  openAddCamera: () => set({ addCameraOpen: true }),
  closeAddCamera: () => set({ addCameraOpen: false, editCamera: null }),
  setEditCamera: (cam) => set({ editCamera: cam, addCameraOpen: true }),
}));
