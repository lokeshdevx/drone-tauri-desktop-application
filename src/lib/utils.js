import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function formatConfidence(conf) {
  return `${Math.round(conf * 100)}%`;
}

export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const STATUS_CONFIG = {
  online:     { label: "Online",      color: "text-green-400",  bg: "bg-green-500/15",  dot: "bg-green-500"  },
  offline:    { label: "Offline",     color: "text-red-400",    bg: "bg-red-500/15",    dot: "bg-red-500"    },
  connecting: { label: "Connecting",  color: "text-yellow-400", bg: "bg-yellow-500/15", dot: "bg-yellow-500" },
  error:      { label: "Error",       color: "text-red-500",    bg: "bg-red-600/15",    dot: "bg-red-600"    },
  detecting:  { label: "Detecting",   color: "text-orange-400", bg: "bg-orange-500/15", dot: "bg-orange-500" },
};
