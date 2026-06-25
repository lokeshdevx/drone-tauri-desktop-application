# Drone Detection System

Real-time multi-camera drone detection desktop app built with Tauri v2 + Next.js 15.

## Quick Start

### Prerequisites
- Node.js 18+
- Rust 1.70+
- Python 3.8+ (for AI engine)

### Install & Run

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Development
npm run dev          # Terminal 1 — Next.js dev server
npm run tauri-dev   # Terminal 2 — Tauri desktop window
```

### Build

```bash
npm run tauri-build
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── layout.js           # Root layout
│   └── page.js             # Entry point → AppShell
├── components/
│   ├── AppShell.js         # Root app container
│   ├── Sidebar.js          # Navigation
│   ├── Header.js           # Top bar
│   ├── CameraFeed.js       # Camera tile (live/offline)
│   ├── AddCameraModal.js   # Add/edit camera dialog
│   └── pages/
│       ├── Dashboard.js    # Live camera grid + focus mode
│       ├── CamerasPage.js  # Camera management
│       ├── GalleryPage.js  # Detection images
│       ├── LogsPage.js     # Analytics (Recharts)
│       ├── SettingsPage.js # Configuration
│       └── AboutPage.js    # Info
├── store/
│   └── index.js            # Zustand stores (camera, detection, settings, UI)
├── lib/
│   ├── utils.js            # cn(), formatDate(), STATUS_CONFIG
│   ├── tauri.js            # invoke() bridge + mock fallbacks
│   ├── alarm.js            # Web Audio API alarm sounds
│   └── detection-engine.js # Detection loop + notification dispatch
└── styles/
    └── globals.css         # Tailwind + custom CSS
src-tauri/
├── src/main.rs             # All Tauri commands
├── Cargo.toml
├── tauri.conf.json
└── capabilities/
    └── default.json
```

## Camera Types Supported

| Type   | Example URL |
|--------|-------------|
| RTSP   | `rtsp://192.168.1.100:554/stream` |
| HTTP   | `http://192.168.1.100:8080/video` |
| IP Cam | `http://192.168.1.100/cgi-bin/stream` |
| USB    | `/dev/video0` or `0` (device index) |
| CCTV   | `rtsp://nvr.local:554/ch1` |
| ONVIF  | `http://192.168.1.100:80/onvif/device_service` |

## Detection Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Confidence threshold | 65% | Minimum confidence to trigger alert |
| Detection interval | 150ms | Time between detection runs |
| Frame skip | 2 | Skip N frames per detection |
| Resolution | 416×416 | YOLOv8 input resolution |
| GPU | Enabled | Use CUDA/Metal acceleration |

## Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS, Zustand, Recharts
- **Desktop**: Tauri v2, Rust
- **AI**: YOLOv8, Python, PyTorch, OpenCV
- **Notifications**: Sonner (toast) + Tauri native
- **Icons**: Lucide React
