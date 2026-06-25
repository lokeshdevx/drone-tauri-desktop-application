"use client";
import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { AlertCircle, TrendingUp, Camera, BarChart2 } from "lucide-react";
import { useDetectionStore, useCameraStore } from "@/store";
import { cn, formatDate, formatConfidence } from "@/lib/utils";

const RANGES = [
  { label: "Today", id: "today" },
  { label: "7 Days", id: "week" },
  { label: "30 Days", id: "month" },
  { label: "All", id: "all" },
];

function getRangeStart(id) {
  const now = new Date();
  if (id === "today")
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (id === "week") return new Date(now.getTime() - 7 * 86400000);
  if (id === "month") return new Date(now.getTime() - 30 * 86400000);
  return new Date(0);
}

function bucketKey(ts, range) {
  const d = new Date(ts);
  if (range === "today") return d.getHours() + ":00";
  if (range === "week")
    return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function LogsPage() {
  const detections = useDetectionStore((s) => s.detections);
  const cameras = useCameraStore((s) => s.cameras);
  const [range, setRange] = useState("today");

  const filtered = useMemo(() => {
    const start = getRangeStart(range);
    return detections.filter((d) => new Date(d.timestamp) >= start);
  }, [detections, range]);

  const stats = useMemo(() => {
    if (!filtered.length)
      return { total: 0, avgConf: 0, topCam: null, camCounts: {} };
    const avgConf =
      filtered.reduce((a, d) => a + d.confidence, 0) / filtered.length;
    const camCounts = {};
    filtered.forEach((d) => {
      camCounts[d.cameraName] = (camCounts[d.cameraName] || 0) + 1;
    });
    const topCam =
      Object.entries(camCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { total: filtered.length, avgConf, topCam, camCounts };
  }, [filtered]);

  const chartData = useMemo(() => {
    const buckets = {};
    filtered.forEach((d) => {
      const k = bucketKey(d.timestamp, range);
      buckets[k] = (buckets[k] || 0) + 1;
    });
    return Object.entries(buckets).map(([k, v]) => ({ time: k, count: v }));
  }, [filtered, range]);

  const camChartData = useMemo(
    () =>
      Object.entries(stats.camCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    [stats.camCounts],
  );

  const TOOLTIP_STYLE = {
    backgroundColor: "hsl(222,47%,8%)",
    border: "1px solid hsl(217,33%,15%)",
    borderRadius: "8px",
    fontSize: "12px",
    color: "hsl(210,40%,98%)",
  };

  return (
    <div className="p-6 max-w-9xl mx-auto space-y-6">
      {/* Range selector */}
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
              range === r.id
                ? "bg-primary text-white"
                : "bg-card border border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Total Detections",
            value: stats.total,
            icon: AlertCircle,
            color: "text-red-400",
            bg: "bg-red-500/10",
          },
          {
            label: "Avg. Confidence",
            value: formatConfidence(stats.avgConf),
            icon: TrendingUp,
            color: "text-green-400",
            bg: "bg-green-500/10",
          },
          {
            label: "Most Active Camera",
            value: stats.topCam || "—",
            icon: Camera,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
          {
            label: "Cameras Monitored",
            value: cameras.length,
            icon: BarChart2,
            color: "text-purple-400",
            bg: "bg-purple-500/10",
          },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div
            key={label}
            className="bg-card border border-border rounded-xl p-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className={cn("text-xl font-bold mt-1 truncate", color)}>
                  {value}
                </p>
              </div>
              <div className={cn("p-2 rounded-lg", bg)}>
                <Icon size={16} className={color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Time chart */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Detections Over Time
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={20}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(217,33%,15%)"
                />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: "hsl(215,20%,55%)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(215,20%,55%)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                />
                <Bar dataKey="count" name="Detections" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill="hsl(0,84%,55%)" fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          )}
        </div>

        {/* Per-camera chart */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            By Camera
          </h3>
          {camChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={camChartData} layout="vertical" barSize={14}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(217,33%,15%)"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "hsl(215,20%,55%)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "hsl(215,20%,55%)" }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar
                  dataKey="count"
                  name="Detections"
                  fill="hsl(0,84%,55%)"
                  fillOpacity={0.8}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          )}
        </div>
      </div>

      {/* Detection table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">
            Recent Detections{" "}
            {filtered.length > 0 && (
              <span className="text-muted-foreground font-normal">
                ({Math.min(filtered.length, 50)} shown)
              </span>
            )}
          </h3>
        </div>
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No detections in this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  {["Time", "Camera", "Confidence", "Type"].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs font-medium text-muted-foreground px-4 py-2"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 50).map((d, i) => (
                  <tr
                    key={d.id}
                    className={cn(
                      "border-t border-border hover:bg-accent/30 transition-colors",
                      i % 2 === 0 ? "" : "bg-muted/10",
                    )}
                  >
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatDate(d.timestamp)}
                    </td>
                    <td className="px-4 py-2.5 text-foreground font-medium">
                      {d.cameraName}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "font-bold",
                          d.confidence >= 0.9
                            ? "text-red-400"
                            : d.confidence >= 0.7
                              ? "text-orange-400"
                              : "text-yellow-400",
                        )}
                      >
                        {formatConfidence(d.confidence)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 capitalize text-foreground">
                      {d.type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
