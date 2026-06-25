"use client";
import { useState, useEffect, useMemo } from "react";
import { Search, Trash2, Download, Grid, List, Camera, X } from "lucide-react";
import { useDetectionStore, useCameraStore } from "@/store";
import { cn, formatDate, formatConfidence } from "@/lib/utils";
import { toast } from "sonner";

const PER_PAGE = 16;
const BACKEND = "http://127.0.0.1:7000";

// ── Smart image component ─────────────────────────────────────────────────────
// Priority:  1. base64 thumbnail (instant, no network)
//            2. fetch from backend → blob URL (bypasses CSP img-src if needed)
//            3. camera icon placeholder
function DetectionImage({ det, className }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);

    // 1. Thumbnail in store (base64)
    if (det.thumbnail) {
      setSrc(`data:image/jpeg;base64,${det.thumbnail}`);
      return;
    }

    // 2. Fetch from backend if we have a backendId
    if (!det.backendId) {
      setFailed(true);
      return;
    }

    fetch(`${BACKEND}/api/detections/${det.backendId}/image`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status);
        return r.blob();
      })
      .then((blob) => {
        if (!cancelled) setSrc(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [det.id, det.thumbnail, det.backendId]);

  // Cleanup blob URL
  useEffect(() => {
    return () => {
      if (src && src.startsWith("blob:")) URL.revokeObjectURL(src);
    };
  }, [src]);

  if (failed || (!src && !det.thumbnail && !det.backendId)) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 bg-muted/20",
          className,
        )}
      >
        <Camera size={20} className="text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground/40">No image</p>
      </div>
    );
  }

  if (!src) {
    // Loading
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/10",
          className,
        )}
      >
        <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="Detection"
      className={cn("object-cover", className)}
      onError={() => {
        setFailed(true);
        setSrc(null);
      }}
    />
  );
}

// ── Gallery page ──────────────────────────────────────────────────────────────
export default function GalleryPage() {
  const detections = useDetectionStore((s) => s.detections);
  const remove = useDetectionStore((s) => s.remove);
  const removeMany = useDetectionStore((s) => s.removeMany);
  const cameras = useCameraStore((s) => s.cameras);

  const [search, setSearch] = useState("");
  const [camFilter, setCamFilter] = useState("all");
  const [minConf, setMinConf] = useState(0);
  const [view, setView] = useState("grid");
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(null);

  const filtered = useMemo(
    () =>
      detections.filter((d) => {
        if (camFilter !== "all" && d.cameraId !== camFilter) return false;
        if (d.confidence < minConf) return false;
        if (
          search &&
          !d.cameraName?.toLowerCase().includes(search.toLowerCase())
        )
          return false;
        return true;
      }),
    [detections, camFilter, minConf, search],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const toggleSel = (id) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };
  const selectAll = () =>
    setSelected(
      selected.size === paged.length
        ? new Set()
        : new Set(paged.map((d) => d.id)),
    );

  const deleteSingle = (id) => {
    remove(id);
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    toast.success("Detection deleted");
  };
  const deleteSelected = () => {
    removeMany([...selected]);
    toast.success(`${selected.size} detection(s) deleted`);
    setSelected(new Set());
  };

  const downloadDet = async (det) => {
    let src;
    if (det.thumbnail) {
      src = `data:image/jpeg;base64,${det.thumbnail}`;
    } else if (det.backendId) {
      try {
        const r = await fetch(
          `${BACKEND}/api/detections/${det.backendId}/image`,
        );
        const blob = await r.blob();
        src = URL.createObjectURL(blob);
      } catch {
        toast.error("Image not available");
        return;
      }
    } else {
      toast.error("No image saved for this detection");
      return;
    }
    const a = document.createElement("a");
    a.href = src;
    a.download = `drone_${det.cameraName}_${new Date(det.timestamp).toISOString().slice(0, 19).replace(/:/g, "-")}.jpg`;
    a.click();
  };

  const confColor = (c) =>
    c >= 0.85
      ? "text-red-400"
      : c >= 0.65
        ? "text-orange-400"
        : "text-yellow-400";

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="border-b border-border px-5 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search camera…"
              className="w-full pl-9 pr-3 py-1.5 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <select
            value={camFilter}
            onChange={(e) => {
              setCamFilter(e.target.value);
              setPage(1);
            }}
            className="bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none"
          >
            <option value="all">All Cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Min conf:</span>
            <input
              type="range"
              min="0"
              max="95"
              step="5"
              value={minConf * 100}
              onChange={(e) => {
                setMinConf(+e.target.value / 100);
                setPage(1);
              }}
              className="w-20 accent-primary"
            />
            <span className="text-xs text-muted-foreground w-7">
              {Math.round(minConf * 100)}%
            </span>
          </div>

          <div className="flex border border-border rounded-lg overflow-hidden">
            {[
              { v: "grid", I: Grid },
              { v: "list", I: List },
            ].map(({ v, I }) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "p-1.5 transition-colors",
                  view === v
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <I size={15} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === paged.length}
              onChange={selectAll}
              className="rounded"
            />
            Select all
          </label>
          <span>
            {filtered.length} detection{filtered.length !== 1 ? "s" : ""}
          </span>
          {selected.size > 0 && (
            <>
              <span className="text-foreground font-medium">
                {selected.size} selected
              </span>
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25"
              >
                <Trash2 size={11} /> Delete
              </button>
              <button onClick={() => setSelected(new Set())}>
                <X size={13} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4">
        {paged.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Camera size={40} className="text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">No detections yet</p>
            <p className="text-xs text-muted-foreground/50">
              Detected drones will appear here automatically
            </p>
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {paged.map((d) => (
              <div
                key={d.id}
                className={cn(
                  "bg-card border rounded-xl overflow-hidden group cursor-pointer transition-all hover:shadow-lg",
                  selected.has(d.id)
                    ? "border-primary ring-1 ring-primary/40 hover:border-primary"
                    : "border-border hover:border-primary/40",
                )}
                onClick={() => setPreview(d)}
              >
                {/* Image */}
                <div className="aspect-video relative overflow-hidden bg-zinc-900">
                  <DetectionImage det={d} className="w-full h-full" />

                  <label
                    className="absolute top-1.5 left-1.5 z-10 cursor-pointer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggleSel(d.id)}
                      className="rounded"
                    />
                  </label>

                  <div className="absolute top-1.5 right-1.5 bg-black/75 px-1.5 py-0.5 rounded text-xs font-bold">
                    <span className={confColor(d.confidence)}>
                      {formatConfidence(d.confidence)}
                    </span>
                  </div>
                </div>

                {/* Info */}
                <div className="p-2.5">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {d.cameraName}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(d.timestamp)}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex border-t border-border opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadDet(d);
                    }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Download size={11} /> Save
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSingle(d.id);
                    }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            {paged.map((d) => (
              <div
                key={d.id}
                className={cn(
                  "flex items-center gap-3 bg-card border rounded-xl px-4 py-2.5 cursor-pointer transition-all hover:border-primary/40",
                  selected.has(d.id) ? "border-primary" : "border-border",
                )}
                onClick={() => setPreview(d)}
              >
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => toggleSel(d.id)}
                  className="rounded"
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="w-16 h-10 rounded overflow-hidden bg-zinc-900 shrink-0">
                  <DetectionImage det={d} className="w-full h-full" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {d.cameraName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(d.timestamp)}
                  </p>
                </div>
                <span
                  className={cn(
                    "text-sm font-bold shrink-0",
                    confColor(d.confidence),
                  )}
                >
                  {formatConfidence(d.confidence)}
                </span>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadDet(d);
                    }}
                    className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSingle(d.id);
                    }}
                    className="p-1.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {pages > 1 && (
        <div className="border-t border-border px-5 py-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              disabled={page === pages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Preview modal ─────────────────────────────────────────────────── */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-card border border-border rounded-xl p-5 max-w-lg w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">
                Detection Detail
              </h3>
              <button
                onClick={() => setPreview(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden mb-4">
              <DetectionImage det={preview} className="w-full h-full" />
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              {[
                ["Camera", preview.cameraName],
                ["Confidence", formatConfidence(preview.confidence)],
                ["Time", formatDate(preview.timestamp)],
                ["Type", preview.type || "drone"],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p
                    className={cn(
                      "font-medium mt-0.5",
                      label === "Confidence"
                        ? confColor(preview.confidence)
                        : "text-foreground",
                    )}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => downloadDet(preview)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Download size={14} /> Download Full Image
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
