#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod python_sidecar;

use python_sidecar::PythonSidecar;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

// ── State ──────────────────────────────────────────────────────────────────────

struct AppState {
    backend_port: Mutex<u16>,
    sidecar:      Mutex<Option<PythonSidecar>>,
}

// AppState only holds Mutex<T> where T: Send, so it is Send + Sync
unsafe impl Send for AppState {}
unsafe impl Sync for AppState {}

#[derive(Serialize, Deserialize, Clone)]
struct BackendInfo {
    port:   u16,
    url:    String,
    ws_url: String,
}

impl BackendInfo {
    fn from_port(port: u16) -> Self {
        Self {
            port,
            url:    format!("http://127.0.0.1:{}", port),
            ws_url: format!("ws://127.0.0.1:{}/ws", port),
        }
    }
}

// ── Commands ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_backend_info(state: State<'_, AppState>) -> BackendInfo {
    BackendInfo::from_port(*state.backend_port.lock().unwrap())
}

#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// pick_folder must be a plain (non-async) command when using blocking_pick_folder
#[tauri::command]
fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

// ── Main ───────────────────────────────────────────────────────────────────────

fn main() {
    let state = AppState {
        backend_port: Mutex::new(7000),
        sidecar:      Mutex::new(None),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let mut sc = PythonSidecar::new();
                match sc.start().await {
                    Ok(port) => {
                        eprintln!("[tauri] Python backend on :{}", port);
                        // Update stored port
                        if let Some(s) = handle.try_state::<AppState>() {
                            *s.backend_port.lock().unwrap() = port;
                        }
                        let _ = handle.emit("backend-ready", BackendInfo::from_port(port));
                    }
                    Err(e) => {
                        eprintln!("[tauri] Python backend failed: {}", e);
                        let _ = handle.emit("backend-error", e.to_string());
                    }
                }
                // Store sidecar so it lives until app exits
                if let Some(s) = handle.try_state::<AppState>() {
                    *s.sidecar.lock().unwrap() = Some(sc);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut lock) = state.sidecar.lock() {
                        if let Some(sc) = lock.as_mut() {
                            sc.stop();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_info,
            pick_folder,
            open_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}