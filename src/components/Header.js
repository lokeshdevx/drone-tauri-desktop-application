"use client";
import { useState, useEffect } from "react";
import { Plus, Wifi, WifiOff } from "lucide-react";
import { useCameraStore, useUIStore } from "@/store";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

const BackendStatus = dynamic(() => import("./BackendStatus"), { ssr: false });

const PAGE_TITLES = {
  dashboard: "Live Dashboard",
  cameras:   "Camera Management",
  gallery:   "Detection Gallery",
  logs:      "Detection Logs",
  settings:  "Settings",
  about:     "About",
};

export default function Header() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const openAdd   = useUIStore((s) => s.openAddCamera);
  const page      = useUIStore((s) => s.page);
  const cameras   = useCameraStore((s) => s.cameras);
  const online    = cameras.filter((c) => ["online", "detecting"].includes(c.status)).length;
  const detecting = cameras.filter((c) => c.status === "detecting").length;

  return (
    <header className="flex items-center justify-between px-5 h-14 border-b border-border bg-card shrink-0 gap-3">
      {/* Left */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-sm font-semibold text-foreground truncate">
          {PAGE_TITLES[page] || "Drone Detection"}
        </h1>
        {detecting > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 animate-pulse shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className="text-xs font-medium text-red-400">{detecting} detecting</span>
          </div>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 shrink-0">
        <BackendStatus />

        <div className={cn(
          "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
          online > 0 ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
        )}>
          {online > 0 ? <Wifi size={11} /> : <WifiOff size={11} />}
          <span>{online}/{cameras.length}</span>
        </div>

        <span className="text-xs text-muted-foreground font-mono hidden sm:block">{time}</span>

        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={13} /> Add Camera
        </button>
      </div>
    </header>
  );
}
