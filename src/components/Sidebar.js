"use client";
import {
  LayoutDashboard, Camera, Image, BarChart3,
  Settings, Info, ChevronLeft, ChevronRight, Shield,
} from "lucide-react";
import { useUIStore, useCameraStore, useDetectionStore } from "@/store";
import { cn } from "@/lib/utils";

const NAV = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "cameras",   icon: Camera,          label: "Cameras" },
  { id: "gallery",   icon: Image,           label: "Gallery" },
  { id: "logs",      icon: BarChart3,       label: "Detection Logs" },
  { id: "settings",  icon: Settings,        label: "Settings" },
  { id: "about",     icon: Info,            label: "About" },
];

export default function Sidebar() {
  const page       = useUIStore((s) => s.page);
  const setPage    = useUIStore((s) => s.setPage);
  const open       = useUIStore((s) => s.sidebarOpen);
  const setSidebar = useUIStore((s) => s.setSidebar);

  const totalCams  = useCameraStore((s) => s.cameras.length);
  const online     = useCameraStore((s) => s.cameras.filter((c) => c.status === "online" || c.status === "detecting").length);
  const todayDets  = useDetectionStore((s) => {
    const today = new Date().toDateString();
    return s.detections.filter((d) => new Date(d.timestamp).toDateString() === today).length;
  });

  return (
    <aside
      className={cn(
        "flex flex-col bg-card border-r border-border transition-all duration-300 shrink-0",
        open ? "w-56" : "w-16"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <Shield size={16} className="text-white" />
        </div>
        {open && (
          <div className="overflow-hidden">
            <p className="font-bold text-sm text-foreground leading-tight">Drone</p>
            <p className="font-bold text-sm text-primary leading-tight">Detection</p>
          </div>
        )}
      </div>

      {/* Status pills */}
      {open && (
        <div className="px-3 py-3 space-y-1 border-b border-border">
          <div className="flex items-center justify-between bg-green-500/10 rounded-md px-2 py-1">
            <span className="text-xs text-green-400">Cameras online</span>
            <span className="text-xs font-bold text-green-400">{online}/{totalCams}</span>
          </div>
          <div className="flex items-center justify-between bg-orange-500/10 rounded-md px-2 py-1">
            <span className="text-xs text-orange-400">Today's detections</span>
            <span className="text-xs font-bold text-orange-400">{todayDets}</span>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-1">
        {NAV.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            title={!open ? label : undefined}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              page === id
                ? "bg-primary text-white shadow-lg shadow-primary/30"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon size={18} className="shrink-0" />
            {open && <span className="truncate">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setSidebar(!open)}
        className="flex items-center justify-center py-3 border-t border-border text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </aside>
  );
}
