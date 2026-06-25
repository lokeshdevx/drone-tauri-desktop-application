/**
 * tauri.js — safe Tauri bridge
 * Dynamically imports Tauri only at runtime inside the desktop app.
 * In browser/Next.js build it falls back to no-ops so the build never fails.
 */

async function getInvoke() {
  try {
    // Tauri v2 — the invoke function lives at the top-level package
    const mod = await import("@tauri-apps/api");
    return mod.invoke;
  } catch {
    // Running in browser dev or Next.js static build — return a mock
    return async (cmd, args) => {
      console.warn(`[tauri mock] invoke("${cmd}")`, args);
      return null;
    };
  }
}

let _invoke = null;
export async function invoke(cmd, args = {}) {
  if (!_invoke) _invoke = await getInvoke();
  return _invoke(cmd, args);
}

export async function sendDesktopNotification(title, body) {
  try {
    const { sendNotification } =
      await import("@tauri-apps/plugin-notification");
    await sendNotification({ title, body });
  } catch {
    console.log(`[notif] ${title}: ${body}`);
  }
}

export async function pickFolder() {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    return open({ directory: true, title: "Select Folder" });
  } catch {
    return null;
  }
}
