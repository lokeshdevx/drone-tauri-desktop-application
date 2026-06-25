"use client";
import { useState } from "react";
import {
  Plus,
  Power,
  RotateCcw,
  Trash2,
  Edit2,
  Camera,
  MapPin,
  Loader2,
  Monitor,
  Radio,
} from "lucide-react";
import { useCameraStore, useUIStore } from "@/store";
import { stopStream } from "@/lib/api";
import { cn, STATUS_CONFIG } from "@/lib/utils";
import { toast } from "sonner";

function CamIcon({ type, size = 16, className }) {
  if (type === "usb") return <Monitor size={size} className={className} />;
  if (type === "rtsp") return <Radio size={size} className={className} />;
  return <Camera size={size} className={className} />;
}

export default function CamerasPage() {
  const cameras = useCameraStore((s) => s.cameras);
  const updateCamera = useCameraStore((s) => s.updateCamera);
  const removeCamera = useCameraStore((s) => s.removeCamera);
  const setStatus = useCameraStore((s) => s.setStatus);
  const openAdd = useUIStore((s) => s.openAddCamera);
  const setEdit = useUIStore((s) => s.setEditCamera);

  const [busyId, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const handleToggle = (cam) => {
    updateCamera(cam.id, { enabled: !cam.enabled });
    setStatus(cam.id, cam.enabled ? "offline" : "connecting");
    toast.info(cam.enabled ? `${cam.name} disabled` : `${cam.name} enabled`);
  };

  const handleReconnect = async (cam) => {
    setBusy(cam.id);
    try {
      updateCamera(cam.id, { enabled: false });
      setStatus(cam.id, "offline");
      await new Promise((r) => setTimeout(r, 400));
      updateCamera(cam.id, { enabled: true });
      setStatus(cam.id, "connecting");
      toast.success(`Reconnecting ${cam.name}…`);
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async (cam) => {
    await stopStream(cam.id).catch(() => {});
    removeCamera(cam.id);
    setDeleting(null);
    toast.success(`${cam.name} removed`);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Cameras</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {cameras.length} camera{cameras.length !== 1 ? "s" : ""} ·{" "}
            {cameras.filter((c) => c.enabled).length} active
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={15} /> Add Camera
        </button>
      </div>

      {/* Empty state */}
      {cameras.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <Camera size={52} className="text-muted-foreground/20" />
          <div>
            <p className="text-foreground font-semibold">No cameras yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add a camera to start monitoring
            </p>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={15} /> Add Camera
          </button>
        </div>
      )}

      {/* Camera list */}
      {cameras.length > 0 && (
        <div className="space-y-2">
          {cameras.map((cam) => {
            const cfg = STATUS_CONFIG[cam.status] || STATUS_CONFIG.offline;
            const busy = busyId === cam.id;
            return (
              <div
                key={cam.id}
                className={cn(
                  "flex items-center gap-4 bg-card border rounded-xl px-4 py-3 transition-all",
                  cam.status === "detecting"
                    ? "border-red-500/50 shadow-sm shadow-red-500/10"
                    : cam.status === "error"
                      ? "border-red-900/40"
                      : "border-border hover:border-primary/30",
                )}
              >
                {/* Icon */}
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    cfg.bg,
                  )}
                >
                  {busy ? (
                    <Loader2
                      size={18}
                      className="animate-spin text-muted-foreground"
                    />
                  ) : (
                    <CamIcon type={cam.type} size={18} className={cfg.color} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-foreground text-sm">
                      {cam.name}
                    </span>
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium",
                        cfg.bg,
                        cfg.color,
                      )}
                    >
                      {cfg.label}
                    </span>
                    {!cam.enabled && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Disabled
                      </span>
                    )}
                    {cam.fps > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {cam.fps} fps
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground font-mono truncate max-w-sm">
                      {cam.url}
                    </span>
                    {cam.location && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                        <MapPin size={10} /> {cam.location}
                      </span>
                    )}
                  </div>
                  {cam.status === "error" && cam.last_error && (
                    <p
                      className="text-xs text-red-400/80 mt-0.5 truncate"
                      title={cam.last_error}
                    >
                      {cam.last_error}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(cam)}
                    disabled={busy}
                    title={cam.enabled ? "Disable" : "Enable"}
                    className={cn(
                      "p-2 rounded-lg transition-colors disabled:opacity-40",
                      cam.enabled
                        ? "text-green-400 hover:bg-green-500/10"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Power size={15} />
                  </button>
                  <button
                    onClick={() => handleReconnect(cam)}
                    disabled={busy || !cam.enabled}
                    title="Reconnect"
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
                  >
                    <RotateCcw
                      size={15}
                      className={busy ? "animate-spin" : ""}
                    />
                  </button>
                  <button
                    onClick={() => setEdit(cam)}
                    title="Edit"
                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Edit2 size={15} />
                  </button>
                  <button
                    onClick={() => setDeleting(cam.id)}
                    title="Remove"
                    className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirm */}
      {deleting &&
        (() => {
          const cam = cameras.find((c) => c.id === deleting);
          if (!cam) return null;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                <h3 className="font-semibold text-foreground">
                  Remove Camera?
                </h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Remove <strong>{cam.name}</strong>? The stream will stop
                  immediately.
                </p>
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={() => setDeleting(null)}
                    className="flex-1 px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => confirmDelete(cam)}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
