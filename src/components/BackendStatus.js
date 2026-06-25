"use client";
/**
 * BackendStatus
 * Shows a pill in the header: "AI ready · cuda" | "AI connecting…" | "AI offline"
 * Polls /api/health every 5 s, retrying immediately on error.
 */
import { useState, useEffect, useRef } from "react";
import { health } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function BackendStatus() {
  const [state, setState] = useState("connecting");   // connecting | ok | error
  const [info,  setInfo]  = useState(null);
  const timerRef = useRef(null);

  const probe = async () => {
    try {
      const data = await health();
      setState("ok");
      setInfo(data);
      timerRef.current = setTimeout(probe, 5_000);
    } catch {
      setState("error");
      setInfo(null);
      // Retry faster while offline
      timerRef.current = setTimeout(probe, 3_000);
    }
  };

  useEffect(() => {
    // First probe after 1.5 s (give backend time to start)
    timerRef.current = setTimeout(probe, 1_500);
    return () => clearTimeout(timerRef.current);
  }, []);   // eslint-disable-line

  const styles = {
    connecting: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",
    ok:         "bg-green-500/15  text-green-400  border-green-500/25",
    error:      "bg-red-500/15    text-red-400    border-red-500/25",
  };

  const dot = {
    connecting: "bg-yellow-500 animate-pulse",
    ok:         "bg-green-500",
    error:      "bg-red-500",
  };

  let label = "AI connecting…";
  if (state === "ok") {
    label = `AI ready · ${info?.model_device ?? "cpu"}`;
    if (info?.active_streams > 0)
      label += ` · ${info.active_streams} stream${info.active_streams > 1 ? "s" : ""}`;
  }
  if (state === "error") label = "AI offline";

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-medium select-none",
      styles[state]
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot[state])} />
      {label}
    </div>
  );
}
