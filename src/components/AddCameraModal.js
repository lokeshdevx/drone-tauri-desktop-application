"use client";
import { useState, useEffect } from "react";
import { X, Loader2, CheckCircle2, XCircle, Wifi } from "lucide-react";
import { useCameraStore, useUIStore, useSettingsStore } from "@/store";
import { testConnection, startStream } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TYPES = [
  { value: "rtsp", label: "RTSP Camera" },
  { value: "http", label: "HTTP / MJPEG" },
  { value: "ip", label: "IP Camera" },
  { value: "usb", label: "USB Webcam" },
  { value: "cctv", label: "CCTV" },
  { value: "onvif", label: "ONVIF" },
];

const URL_HINTS = {
  rtsp: "rtsp://192.168.1.100:554/stream1",
  http: "http://210.248.127.20/nphMotionJpeg?Resolution=640x480&Quality=Standard",
  ip: "http://192.168.1.100/cgi-bin/camera?resolution=640&quality=5&fps=15",
  usb: "0  (device index)",
  cctv: "rtsp://192.168.1.100:554/ch01",
  onvif: "http://192.168.1.100:80/onvif/device_service",
};

// Auto-detect stream URL from common camera web page URLs
function resolveStreamUrl(url) {
  url = url.trim();
  if (!url) return url;

  // Panasonic BB/BL: /CgiStart?page=... → /nphMotionJpeg
  if (url.includes("CgiStart") || url.includes("CgiMJpeg")) {
    const base = url.match(/^(https?:\/\/[^/]+)/);
    if (base)
      return base[1] + "/nphMotionJpeg?Resolution=640x480&Quality=Standard";
  }

  // Axis: web UI → MJPEG stream
  if (
    url.match(/https?:\/\/[^/]+\/?$/) &&
    !url.includes("nphMotionJpeg") &&
    !url.includes("mjpg")
  ) {
    // Could be any camera — return as-is, backend will try
    return url;
  }

  return url;
}

const EMPTY = {
  name: "",
  type: "rtsp",
  url: "",
  username: "",
  password: "",
  location: "",
};

export default function AddCameraModal() {
  const close = useUIStore((s) => s.closeAddCamera);
  const editCam = useUIStore((s) => s.editCamera);
  const addCamera = useCameraStore((s) => s.addCamera);
  const updCamera = useCameraStore((s) => s.updateCamera);
  const setStatus = useCameraStore((s) => s.setStatus);
  const settings = useSettingsStore();

  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState(null); // null | { ok, latency_ms }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editCam) {
      setForm({
        name: editCam.name,
        type: editCam.type,
        url: editCam.url,
        username: editCam.username || "",
        password: editCam.password || "",
        location: editCam.location || "",
      });
    }
  }, [editCam]);

  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: "" }));
    setTestRes(null);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Camera name is required";
    if (!form.url.trim()) e.url = "Stream URL is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleTest = async () => {
    if (!validate()) return;
    setTesting(true);
    setTestRes(null);
    try {
      const res = await testConnection({
        url: form.url,
        username: form.username,
        password: form.password,
        timeout: 8000,
      });
      setTestRes(res);
      if (res.ok) {
        toast.success(`Connected in ${res.latency_ms ?? "?"}ms`);
      } else {
        toast.error(
          res.error || "Connection failed — check URL and credentials",
        );
      }
    } catch (err) {
      setTestRes({ ok: false });
      toast.error("Test failed", { description: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);

    try {
      if (editCam) {
        // Edit existing camera
        updCamera(editCam.id, form);
        // Restart stream with new settings
        await startStream({
          camera_id: editCam.id,
          url: form.url,
          name: form.name,
          username: form.username || "",
          password: form.password || "",
          frame_skip: settings.frameSkip ?? 2,
          resolution: settings.resolution ?? 416,
          confidence: settings.confidenceThreshold ?? 0.35,
        }).catch(() => {});
        toast.success(`${form.name} updated`);
        close();
      } else {
        // New camera — generate ID first
        const camId = `cam_${Date.now()}`;

        // STEP 1: Start stream on backend IMMEDIATELY (before React re-render)
        // This ensures the backend CaptureThread is spawning BEFORE the
        // CameraFeed component mounts and opens its video WebSocket.
        // STEP 1: Start backend stream immediately (fire-and-forget)
        // Pass original url - backend's stream_probe handles discovery
        startStream({
          camera_id: camId,
          url: form.url,
          name: form.name,
          username: form.username || "",
          password: form.password || "",
          frame_skip: settings.frameSkip ?? 2,
          resolution: settings.resolution ?? 416,
          confidence: settings.confidenceThreshold ?? 0.35,
        }).catch(() => {});

        // STEP 2: Add to store with same url so detection-engine and
        // backend's idempotent check stay consistent
        addCamera({ ...form, id: camId });

        toast.success(`${form.name} added`);
        close();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl mx-4 max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">
            {editCam ? "Edit Camera" : "Add New Camera"}
          </h2>
          <button
            onClick={close}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Camera Name *
            </label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Gate Camera"
              className={cn(
                "w-full bg-input border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50",
                errors.name ? "border-red-500" : "border-border",
              )}
            />
            {errors.name && (
              <p className="text-xs text-red-400 mt-1">{errors.name}</p>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Camera Type
            </label>
            <select
              value={form.type}
              onChange={(e) => set("type", e.target.value)}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* URL */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Stream URL *
            </label>
            <input
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder={URL_HINTS[form.type]}
              className={cn(
                "w-full bg-input border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono",
                errors.url ? "border-red-500" : "border-border",
              )}
            />
            {errors.url && (
              <p className="text-xs text-red-400 mt-1">{errors.url}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              e.g. {URL_HINTS[form.type]}
            </p>
          </div>

          {/* Auth */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Username
              </label>
              <input
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                placeholder="optional"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="optional"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Location
            </label>
            <input
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="e.g. Main Gate, Rooftop"
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* Test result */}
          {testRes && (
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                testRes.ok
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400",
              )}
            >
              {testRes.ok ? (
                <>
                  <CheckCircle2 size={15} /> Connected in {testRes.latency_ms}ms
                  — ready to add
                </>
              ) : (
                <>
                  <XCircle size={15} /> Connection failed — check URL and
                  credentials
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 pb-6">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            {testing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wifi size={14} />
            )}
            Test Connection
          </button>
          <div className="flex-1" />
          <button
            onClick={close}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50",
              testRes?.ok
                ? "bg-green-500 hover:bg-green-600 text-white"
                : "bg-primary hover:bg-primary/90 text-white",
            )}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {editCam
              ? "Save Changes"
              : testRes?.ok
                ? "✓ Add Camera"
                : "Add Camera"}
          </button>
        </div>
      </div>
    </div>
  );
}
