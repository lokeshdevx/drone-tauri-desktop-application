"use client";
import { useState } from "react";
import { Save, Volume2, FolderOpen, CheckCircle2 } from "lucide-react";
import { useSettingsStore } from "@/store";
import { testAlarm } from "@/lib/alarm";
import { pickFolder } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Reusable layout components ────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/20">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-5 space-y-5">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

// ── Main settings page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const s = useSettingsStore();
  const update = useSettingsStore((x) => x.update);
  const [saved, setSaved] = useState(false);

  // All changes apply immediately to the Zustand store (which is persisted).
  // The detection-engine's useEffect([settingsHash]) picks up changes
  // and re-syncs the backend automatically.
  const set = (key, val) => {
    update({ [key]: val });
  };

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handlePickFolder = async () => {
    const folder = await pickFolder();
    if (folder) {
      set("saveFolder", folder);
      toast.success("Save folder updated");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto px-6 py-5 space-y-5 pb-24 max-w-3xl mx-auto w-full">
        {/* ── General ─────────────────────────────────────────────────────── */}
        <Section title="General">
          <Row label="Theme">
            <select
              value={s.theme}
              onChange={(e) => set("theme", e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </Row>
          <Row
            label="Start on boot"
            hint="Launch automatically when your computer starts"
          >
            <Toggle
              checked={s.startOnBoot}
              onChange={(v) => set("startOnBoot", v)}
            />
          </Row>
          <Row
            label="Minimize to tray"
            hint="Keep running in system tray when window is closed"
          >
            <Toggle
              checked={s.minimizeToTray}
              onChange={(v) => set("minimizeToTray", v)}
            />
          </Row>
          <Row
            label="Auto reconnect cameras"
            hint="Automatically reconnect cameras that drop"
          >
            <Toggle
              checked={s.autoReconnect}
              onChange={(v) => set("autoReconnect", v)}
            />
          </Row>
        </Section>

        {/* ── Detection ────────────────────────────────────────────────────── */}
        <Section title="Detection">
          <div className="text-xs text-primary/80 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">
            ⚡ Changes apply instantly — running cameras are updated
            automatically
          </div>

          <Row
            label="Confidence threshold"
            hint={`Only alert when detection confidence ≥ ${Math.round(s.confidenceThreshold * 100)}%. Lower = more detections, higher = fewer false positives.`}
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="10"
                max="95"
                step="5"
                value={s.confidenceThreshold * 100}
                onChange={(e) =>
                  set("confidenceThreshold", +e.target.value / 100)
                }
                className="w-32 accent-primary"
              />
              <span className="text-sm font-mono font-bold text-primary w-10 text-right">
                {Math.round(s.confidenceThreshold * 100)}%
              </span>
            </div>
          </Row>

          <Row
            label="Frame skip"
            hint={`Run AI on 1 in every ${s.frameSkip + 1} frames. Higher = less CPU usage, slightly slower detection.`}
          >
            <div className="flex items-center gap-2">
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  onClick={() => set("frameSkip", v)}
                  className={cn(
                    "w-8 h-8 rounded-lg text-sm font-medium transition-colors",
                    s.frameSkip === v
                      ? "bg-primary text-white"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </Row>

          <Row
            label="Detection resolution"
            hint="Image size fed to the AI model. Larger = more accurate but slower."
          >
            <div className="flex gap-2 flex-wrap">
              {[
                { val: 320, label: "320", hint: "Fast" },
                { val: 416, label: "416", hint: "Balanced" },
                { val: 512, label: "512", hint: "Accurate" },
                { val: 640, label: "640", hint: "Best" },
              ].map(({ val, label, hint }) => (
                <button
                  key={val}
                  onClick={() => set("resolution", val)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                    s.resolution === val
                      ? "bg-primary text-white border-primary"
                      : "bg-muted text-muted-foreground border-border hover:bg-accent hover:text-foreground",
                  )}
                >
                  {label}
                  <span className="ml-1 opacity-60">{hint}</span>
                </button>
              ))}
            </div>
          </Row>

          <Row
            label="GPU acceleration"
            hint="Use NVIDIA CUDA or Apple Metal for faster inference"
          >
            <Toggle
              checked={s.gpuEnabled}
              onChange={(v) => set("gpuEnabled", v)}
            />
          </Row>

          {/* Test button */}
          <DetectionTestButton />
        </Section>

        {/* ── Alarm ────────────────────────────────────────────────────────── */}
        <Section title="Alarm">
          <Row label="Enable alarm">
            <Toggle
              checked={s.alarmEnabled}
              onChange={(v) => set("alarmEnabled", v)}
            />
          </Row>

          {s.alarmEnabled && (
            <>
              <Row label="Sound">
                <div className="flex items-center gap-2">
                  <select
                    value={s.alarmSound}
                    onChange={(e) => set("alarmSound", e.target.value)}
                    className="bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="siren">Siren</option>
                    <option value="bell">Bell</option>
                    <option value="chime">Chime</option>
                    <option value="default">Default</option>
                  </select>
                  <button
                    onClick={() => testAlarm(s.alarmSound, s.alarmVolume)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Volume2 size={14} /> Test
                  </button>
                </div>
              </Row>

              <Row label="Volume">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={s.alarmVolume * 100}
                    onChange={(e) => set("alarmVolume", +e.target.value / 100)}
                    className="w-28 accent-primary"
                  />
                  <span className="text-sm font-mono text-muted-foreground w-9 text-right">
                    {Math.round(s.alarmVolume * 100)}%
                  </span>
                </div>
              </Row>
            </>
          )}
        </Section>

        {/* ── Notifications ─────────────────────────────────────────────────── */}
        <Section title="Notifications">
          <Row
            label="Desktop notifications"
            hint="Native OS notification on each detection"
          >
            <Toggle
              checked={s.desktopNotif}
              onChange={(v) => set("desktopNotif", v)}
            />
          </Row>
          <Row
            label="In-app toast notifications"
            hint="Popup inside the app on each detection"
          >
            <Toggle
              checked={s.toastNotif}
              onChange={(v) => set("toastNotif", v)}
            />
          </Row>
          <Row label="Alarm sound" hint="Play alarm sound on each detection">
            <Toggle
              checked={s.soundNotif}
              onChange={(v) => set("soundNotif", v)}
            />
          </Row>
        </Section>

        {/* ── Storage ──────────────────────────────────────────────────────── */}
        <Section title="Storage">
          <Row
            label="Detection image folder"
            hint={s.saveFolder || "Default: python-backend/detections/"}
          >
            <button
              onClick={handlePickFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <FolderOpen size={14} /> Browse
            </button>
          </Row>

          <Row
            label="Max storage"
            hint="Older files are removed when limit is reached"
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="1000"
                value={s.maxStorageGB}
                onChange={(e) => set("maxStorageGB", +e.target.value)}
                className="w-20 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <span className="text-xs text-muted-foreground">GB</span>
            </div>
          </Row>

          <Row label="Auto-delete old detections">
            <Toggle
              checked={s.autoDelete}
              onChange={(v) => set("autoDelete", v)}
            />
          </Row>

          {s.autoDelete && (
            <Row label="Delete detections older than">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={s.autoDeleteDays}
                  onChange={(e) => set("autoDeleteDays", +e.target.value)}
                  className="w-20 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
            </Row>
          )}
        </Section>

        {/* ── Camera defaults ──────────────────────────────────────────────── */}
        <Section title="Camera Defaults">
          <Row label="Auto reconnect attempts">
            <input
              type="number"
              min="1"
              max="20"
              value={s.reconnectAttempts ?? 5}
              onChange={(e) => set("reconnectAttempts", +e.target.value)}
              className="w-20 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </Row>
          <Row label="Connection timeout">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="5"
                max="60"
                value={Math.round((s.timeout ?? 15000) / 1000)}
                onChange={(e) => set("timeout", +e.target.value * 1000)}
                className="w-20 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground text-right focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <span className="text-xs text-muted-foreground">seconds</span>
            </div>
          </Row>
        </Section>
      </div>

      {/* ── Sticky save bar ──────────────────────────────────────────────── */}
      <div className="border-t border-border bg-card/90 backdrop-blur-md px-6 py-3 flex items-center justify-between sticky bottom-0">
        <p className="text-xs text-muted-foreground">
          Detection settings apply instantly to all running cameras
        </p>
        <button
          onClick={showSaved}
          className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          {saved ? <CheckCircle2 size={15} /> : <Save size={15} />}
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

// ── Detection test button ─────────────────────────────────────────────────────
export function DetectionTestButton() {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setTesting(true);
    setResult(null);
    try {
      // Use hardcoded backend URL — same as rest of app
      const base = "http://127.0.0.1:7000";
      const r = await fetch(`${base}/api/test-detection`, { method: "POST" });
      const data = await r.json();
      setResult(
        data.ok
          ? "✅ Test fired! Check for toast + alarm."
          : `❌ ${data.error}`,
      );
    } catch (e) {
      setResult(`❌ ${e.message}`);
    } finally {
      setTesting(false);
      setTimeout(() => setResult(null), 5000);
    }
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
      <div>
        <p className="text-sm text-foreground">Test Detection Pipeline</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Fires a synthetic detection to verify alarms and notifications work
        </p>
        {result && <p className="text-xs text-yellow-400 mt-1">{result}</p>}
      </div>
      <button
        onClick={run}
        disabled={testing}
        className="ml-4 px-3 py-1.5 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
      >
        {testing ? "Testing…" : "🚨 Test"}
      </button>
    </div>
  );
}
