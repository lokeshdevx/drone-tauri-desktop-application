"use client";
import { useState } from "react";
import { useCameraStore, useUIStore, useDetectionStore } from "@/store";
import CameraFeed from "@/components/CameraFeed";
import { Plus, X, ChevronLeft, LayoutGrid } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";

// Compute responsive grid class
function gridClass(n) {
  if (n === 1) return "grid-cols-1";
  if (n === 2) return "grid-cols-2";
  if (n <= 4) return "grid-cols-2";
  if (n <= 6) return "grid-cols-3";
  if (n <= 9) return "grid-cols-3";
  return "grid-cols-4";
}

// ─── Focus View ────────────────────────────────────────────────────────────────
function FocusView({ camera, others, onClose }) {
  const [thumb, setThumb] = useState(camera.id);
  const focused = thumb === camera.id ? camera : others.find((c) => c.id === thumb) || camera;
  const detections = useDetectionStore((s) => s.byCamera(focused.id));

  const setFocused = useCameraStore((s) => s.setFocused);

  return (
    <div className="flex gap-4 h-full p-4">
      {/* Main view */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft size={14} /> All cameras
          </button>
          <span className="text-xs text-muted-foreground">→</span>
          <span className="text-xs font-medium text-foreground">{focused.name}</span>
        </div>

        <div className="flex-1">
          <CameraFeed camera={focused} />
        </div>

        {/* Info row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card rounded-lg p-3 border border-border">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="text-sm font-semibold capitalize mt-1" style={{ color: focused.status === "online" || focused.status === "detecting" ? "#4ade80" : "#f87171" }}>
              {focused.status}
            </p>
          </div>
          <div className="bg-card rounded-lg p-3 border border-border">
            <p className="text-xs text-muted-foreground">Detections</p>
            <p className="text-sm font-semibold text-orange-400 mt-1">{detections.length}</p>
          </div>
          <div className="bg-card rounded-lg p-3 border border-border">
            <p className="text-xs text-muted-foreground">FPS</p>
            <p className="text-sm font-semibold text-foreground mt-1">{focused.fps || "—"}</p>
          </div>
        </div>

        {/* Recent detections */}
        {detections.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Recent Detections</p>
            <div className="space-y-1">
              {detections.slice(0, 4).map((d) => (
                <div key={d.id} className="flex items-center justify-between text-xs">
                  <span className="text-orange-400 font-semibold">{Math.round(d.confidence * 100)}% confidence</span>
                  <span className="text-muted-foreground">{formatDate(d.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {others.length > 0 && (
        <div className="w-44 flex flex-col gap-2 overflow-auto">
          <p className="text-xs text-muted-foreground font-medium px-1">Other Cameras</p>
          {[camera, ...others].filter((c) => c.id !== focused.id).map((c) => (
            <div key={c.id} onClick={() => setThumb(c.id)} className="cursor-pointer">
              <CameraFeed camera={c} compact />
              <p className="text-xs text-muted-foreground mt-1 truncate px-1">{c.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const cameras   = useCameraStore((s) => s.cameras);
  const openAdd   = useUIStore((s) => s.openAddCamera);
  const [focused, setFocused] = useState(null);

  if (focused) {
    const cam    = cameras.find((c) => c.id === focused.id) || focused;
    const others = cameras.filter((c) => c.id !== cam.id);
    return (
      <div className="h-full">
        <FocusView camera={cam} others={others} onClose={() => setFocused(null)} />
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <LayoutGrid size={28} className="text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">No cameras connected</h2>
          <p className="text-sm text-muted-foreground mt-1">Add a camera to start monitoring for drones</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} /> Add First Camera
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 h-full">
      <div className={cn("grid gap-3 h-full", gridClass(cameras.length))}>
        {cameras.map((cam) => (
          <CameraFeed
            key={cam.id}
            camera={cam}
            onClick={() => setFocused(cam)}
          />
        ))}
      </div>
    </div>
  );
}
