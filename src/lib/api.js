/**
 * api.js — HTTP + WebSocket client for the Python backend.
 *
 * KEY: In Tauri production build the backend starts AFTER the frontend loads.
 * We must wait for the "backend-ready" event before making any connections.
 * _backendReady is a Promise that resolves with the confirmed port/URL.
 */

let _baseUrl = null;
let _ws = null;
let _onMessage = null;

// ── Backend readiness promise ──────────────────────────────────────────────────
// Resolves with the confirmed base URL once backend is healthy.
// All API calls and WS connections await this before proceeding.
let _resolveReady;
let _backendReady = new Promise((resolve) => {
  _resolveReady = resolve;
});

// ── URL resolution ─────────────────────────────────────────────────────────────

async function resolveBaseUrl() {
  if (_baseUrl) return _baseUrl;

  try {
    const { invoke, event } = await import("@tauri-apps/api");

    // Listen for "backend-ready" event fired by Rust after backend health check passes
    const unlisten = await event.listen("backend-ready", (e) => {
      const url =
        e.payload?.url || `http://127.0.0.1:${e.payload?.port || 7000}`;
      _baseUrl = url;
      _resolveReady(url);
      unlisten();
    });

    // Also try invoking immediately — backend might already be running
    try {
      const info = await invoke("get_backend_info");
      if (info?.url && info?.port) {
        // Verify it's actually up before trusting it
        const check = await fetch(`${info.url}/api/health`, {
          signal: AbortSignal.timeout(2000),
        })
          .then((r) => r.ok)
          .catch(() => false);
        if (check) {
          _baseUrl = info.url;
          _resolveReady(info.url);
          unlisten();
          return _baseUrl;
        }
      }
    } catch (_) {}

    // Wait for backend-ready event (with 90s timeout for cold start)
    const url = await Promise.race([
      _backendReady,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 90_000),
      ),
    ]);
    return url;
  } catch {
    // Browser dev mode — backend is already running on 7000
    _baseUrl = "http://127.0.0.1:7000";
    _resolveReady(_baseUrl);
    return _baseUrl;
  }
}

async function resolveWsUrl() {
  const base = await resolveBaseUrl();
  return base.replace(/^http/, "ws") + "/ws";
}

export async function getWsBase() {
  const base = await resolveBaseUrl();
  return base.replace(/^http/, "ws");
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────
async function get(path) {
  const base = await resolveBaseUrl();
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function post(path, body) {
  const base = await resolveBaseUrl();
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
  return r.json();
}

// ── WebSocket ──────────────────────────────────────────────────────────────────
export async function connectWs(onMessage) {
  if (onMessage) _onMessage = onMessage;
  if (!_onMessage) return;

  if (
    _ws &&
    (_ws.readyState === WebSocket.OPEN ||
      _ws.readyState === WebSocket.CONNECTING)
  ) {
    return _ws;
  }

  const wsUrl = await resolveWsUrl();
  console.log("[ws] connecting to", wsUrl);
  const ws = new WebSocket(wsUrl);
  _ws = ws;

  ws.onopen = () => {
    ws._ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 20_000);
  };

  ws.onmessage = (ev) => {
    if (ev.data === "pong") return;
    try {
      _onMessage?.(JSON.parse(ev.data));
    } catch (_) {}
  };

  ws.onclose = () => {
    clearInterval(ws._ping);
    _ws = null;
    setTimeout(() => connectWs(), 3_000);
  };

  ws.onerror = () => ws.close();
  return ws;
}

export function closeWs() {
  if (_ws) {
    clearInterval(_ws._ping);
    _ws.onclose = null;
    _ws.close();
    _ws = null;
  }
}

// ── Camera API ─────────────────────────────────────────────────────────────────
export const startStream = (data) => post("/api/cameras/start", data);
export const stopStream = (id) => post(`/api/cameras/stop/${id}`);
export const allStatus = () => get("/api/cameras/status");
export const cameraStatus = (id) => get(`/api/cameras/status/${id}`);
export const testConnection = (data) => post("/api/cameras/test", data);
export const snapshot = (id) => post(`/api/cameras/snapshot/${id}`);
export const bulkSettings = (s) => post("/api/settings/bulk", { settings: s });
export const getSettings = () => get("/api/settings");
export const health = () => get("/api/health");

export function detectionImageUrl(id) {
  return `${_baseUrl || "http://127.0.0.1:7000"}/api/detections/${id}/image`;
}
