"use client";
import { Shield, Zap, Camera, Bell, HardDrive, Cpu, Globe, Github } from "lucide-react";

const FEATURES = [
  { icon: Camera,    title: "Multi-Camera Support",    desc: "Unlimited simultaneous RTSP, IP, USB, CCTV and ONVIF cameras" },
  { icon: Zap,       title: "Real-time Detection",     desc: "YOLOv8/v11 AI model with GPU acceleration for sub-100ms inference" },
  { icon: Bell,      title: "Instant Alerts",          desc: "Sound alarm, desktop notifications and in-app toasts on detection" },
  { icon: HardDrive, title: "Detection Gallery",       desc: "Auto-saved images with search, filter, export and bulk operations" },
  { icon: Cpu,       title: "GPU Acceleration",        desc: "NVIDIA CUDA, AMD ROCm and Apple Metal support for maximum speed" },
  { icon: Globe,     title: "Cross-Platform",          desc: "Native binaries for Windows, macOS and Linux via Tauri v2" },
];

const STACK = [
  { cat: "Frontend",  items: ["Next.js 15 (App Router)", "React 19", "Tailwind CSS", "Zustand", "Recharts", "Framer Motion"] },
  { cat: "Desktop",   items: ["Tauri v2", "Rust", "SQLite", "Native notifications", "System tray"] },
  { cat: "AI Engine", items: ["YOLOv8 / YOLOv11", "Python + PyTorch", "OpenCV", "CUDA / ROCm / Metal"] },
];

export default function AboutPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Hero */}
      <div className="flex flex-col items-center text-center py-8 gap-4">
        <div className="w-20 h-20 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
          <Shield size={36} className="text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Drone Detection System</h1>
          <p className="text-muted-foreground mt-1">Version 1.0.0 — Production Ready</p>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground leading-relaxed">
          A professional-grade desktop application for real-time drone detection across multiple
          cameras using state-of-the-art AI models. All processing happens locally — no data
          leaves your machine.
        </p>
      </div>

      {/* Features grid */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">Key Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-card border border-border rounded-xl p-4 flex gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Icon size={16} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tech stack */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-4">Technology Stack</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STACK.map(({ cat, items }) => (
            <div key={cat} className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{cat}</p>
              <ul className="space-y-1.5">
                {items.map((i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                    <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Requirements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm font-semibold text-foreground mb-3">Minimum Requirements</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• CPU: Intel Core i5 / AMD Ryzen 5</li>
            <li>• RAM: 8 GB</li>
            <li>• Storage: 2 GB free</li>
            <li>• OS: Windows 10+, macOS 10.15+, Ubuntu 18.04+</li>
          </ul>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm font-semibold text-foreground mb-3">Recommended</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>• CPU: Intel Core i7 / AMD Ryzen 7</li>
            <li>• RAM: 16 GB</li>
            <li>• GPU: NVIDIA with CUDA support</li>
            <li>• Storage: 10 GB NVMe SSD</li>
          </ul>
        </div>
      </div>

      {/* Privacy */}
      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-green-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-400">100% Local Processing</p>
            <p className="text-xs text-muted-foreground mt-1">
              All camera feeds, detection results and settings are processed and stored entirely
              on your local machine. No data is sent to external servers.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-muted-foreground pb-4">
        <p>Built with Next.js 15, Tauri v2, Rust &amp; Python</p>
        <p className="mt-1">© 2024 Drone Detection System. MIT License.</p>
      </div>
    </div>
  );
}
