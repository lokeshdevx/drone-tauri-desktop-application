/**
 * Shared video WebSocket pool — one connection per camera, survives React remounts.
 */

import { resolveVideoWsUrl } from "@/lib/api";

/** @type {Map<string, { refs: number, ws: WebSocket|null, listeners: Set<(data: ArrayBuffer) => void>, retryTimer: ReturnType<typeof setTimeout>|null, opening: boolean }>} */
const pools = new Map();

function dispatch(pool, data) {
  for (const fn of pool.listeners) {
    try {
      fn(data);
    } catch (_) {}
  }
}

function closePool(cameraId, pool) {
  if (pool.retryTimer) {
    clearTimeout(pool.retryTimer);
    pool.retryTimer = null;
  }
  if (pool.ws) {
    const ws = pool.ws;
    pool.ws = null;
    clearInterval(ws._ping);
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
  }
  pool.opening = false;
}

async function connect(cameraId, pool) {
  if (pool.ws || pool.opening) return;

  pool.opening = true;
  let wsUrl;
  try {
    wsUrl = await resolveVideoWsUrl(cameraId);
  } catch {
    pool.opening = false;
    scheduleRetry(cameraId, pool);
    return;
  }

  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  pool.ws = ws;

  ws.onopen = () => {
    pool.opening = false;
    if (!pools.has(cameraId)) {
      ws.close();
      return;
    }
    ws._ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 10_000);
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === "string") return;
    dispatch(pool, ev.data);
  };

  ws.onerror = () => {
    clearInterval(ws._ping);
  };

  ws.onclose = () => {
    clearInterval(ws._ping);
    pool.ws = null;
    pool.opening = false;
    if (pools.has(cameraId) && pool.refs > 0) {
      scheduleRetry(cameraId, pool);
    }
  };
}

function scheduleRetry(cameraId, pool) {
  if (pool.retryTimer) return;
  pool.retryTimer = setTimeout(() => {
    pool.retryTimer = null;
    if (pools.has(cameraId) && pool.refs > 0) {
      connect(cameraId, pool);
    }
  }, 2000);
}

/**
 * Subscribe to JPEG frames for a camera. Returns an unsubscribe function.
 * @param {string} cameraId
 * @param {(data: ArrayBuffer) => void} onFrame
 */
export function subscribeVideo(cameraId, onFrame) {
  let pool = pools.get(cameraId);
  if (!pool) {
    pool = { refs: 0, ws: null, listeners: new Set(), retryTimer: null, opening: false };
    pools.set(cameraId, pool);
  }

  pool.refs += 1;
  pool.listeners.add(onFrame);
  connect(cameraId, pool);

  return () => {
    pool.listeners.delete(onFrame);
    pool.refs -= 1;
    if (pool.refs <= 0) {
      closePool(cameraId, pool);
      pools.delete(cameraId);
    }
  };
}
