# 🚁 Drone Detection System

Real-time multi-camera drone detection desktop application built using **Tauri v2**, **Next.js 15**, **YOLOv8**, and **Python AI Engine**.

---

## ✨ Features

* Real-time drone detection using YOLOv8
* Multi-camera simultaneous detection
* RTSP, HTTP, USB, CCTV, and ONVIF camera support
* Live preview of all connected cameras
* Focus mode for selected camera
* Detection image gallery with camera information
* Alarm and desktop notifications
* GPU acceleration support (CUDA/Metal)
* Cross-platform desktop application using Tauri v2

---

# 📋 System Requirements

| Software                      | Version |
| ----------------------------- | ------- |
| Node.js                       | 18+     |
| Rust                          | 1.70+   |
| Python                        | 3.8+    |
| Tauri CLI                     | Latest  |
| Visual Studio C++ Build Tools | Latest  |

---

# 🛠 Complete Installation Guide

## 1. Install Node.js

Download and install the latest LTS version of Node.js:

https://nodejs.org/en/download

Verify installation:

```bash
node --version
npm --version
```

Expected output:

```bash
v18.x.x
9.x.x
```

---

## 2. Install Rust

Install Rust using Rustup.

### Windows

Download and install from:

https://rustup.rs/

Or install via Winget:

```powershell
winget install --id Rustlang.Rustup
```

Verify installation:

```bash
rustc --version
cargo --version
```

Update Rust:

```bash
rustup update
```

---

## 3. Install Microsoft Visual Studio C++ Build Tools

Tauri and some Python packages require Microsoft C++ Build Tools.

Download:

https://visualstudio.microsoft.com/visual-cpp-build-tools/

During installation, select:

* Desktop development with C++
* MSVC v143 Build Tools
* Windows 10 SDK or Windows 11 SDK
* CMake Tools for Windows

After installation, restart your computer.

Verify installation:

```bash
cl
```

If installed correctly, Microsoft compiler information should appear.

---

## 4. Install Python

Download Python:

https://www.python.org/downloads/

**Important:** Enable the following option during installation:

```text
✔ Add Python to PATH
```

Verify installation:

```bash
python --version
pip --version
```

Expected output:

```bash
Python 3.10.x
```

---

## 5. Install Tauri CLI Globally

Install Tauri CLI globally:

```bash
npm install -g @tauri-apps/cli
```

Verify installation:

```bash
tauri --version
```

Expected output:

```bash
tauri-cli 2.x.x
```

---

# 🚀 Project Setup

Clone the repository:

```bash
git clone <repository-url>

cd drone-detection-system
```

---

## Install Frontend Dependencies

```bash
npm install
```

---

## Install Python Backend Dependencies

Create a virtual environment.

### Windows

```bash
python -m venv venv

venv\Scripts\activate
```

### Linux/macOS

```bash
python3 -m venv venv

source venv/bin/activate
```

Upgrade pip:

```bash
pip install --upgrade pip
```

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## Example requirements.txt

```txt
ultralytics
torch
torchvision
opencv-python
numpy
pillow
onnxruntime
fastapi
uvicorn
python-multipart
pydantic
requests
```

---

# 🏃 Development Workflow

The application requires three processes.

---

## Terminal 1 — Start Python AI Backend

Activate virtual environment:

### Windows

```bash
venv\Scripts\activate
```

### Linux/macOS

```bash
source venv/bin/activate
```

Start the AI server:

```bash
python ai_server.py
```

Expected:

```bash
AI Engine running on http://127.0.0.1:8000
```

---

## Terminal 2 — Start Next.js Frontend

```bash
npm run dev
```

Frontend runs on:

```text
http://localhost:3000
```

---

## Terminal 3 — Start Tauri Desktop Application

```bash
npm run tauri-dev
```

This command launches the desktop application.

---

# 📦 Production Build

Build the desktop application:

```bash
npm run tauri-build
```

Generated installers will be available in:

```text
src-tauri/target/release/bundle/
```

Examples:

```text
.exe
.msi
.app
.AppImage
```

---

# 📁 Project Structure

```text
src/
├── app/
│   ├── layout.js
│   └── page.js
│
├── components/
│   ├── AppShell.js
│   ├── Sidebar.js
│   ├── Header.js
│   ├── CameraFeed.js
│   ├── AddCameraModal.js
│   └── pages/
│       ├── Dashboard.js
│       ├── CamerasPage.js
│       ├── GalleryPage.js
│       ├── LogsPage.js
│       ├── SettingsPage.js
│       └── AboutPage.js
│
├── store/
│   └── index.js
│
├── lib/
│   ├── utils.js
│   ├── tauri.js
│   ├── alarm.js
│   └── detection-engine.js
│
└── styles/
    └── globals.css

src-tauri/
├── src/
│   └── main.rs
├── Cargo.toml
├── tauri.conf.json
└── capabilities/
    └── default.json

python-backend/
├── ai_server.py
├── detector.py
├── models/
├── weights/
└── requirements.txt
```

---

# 📹 Supported Camera Types

| Type        | Example                                     |
| ----------- | ------------------------------------------- |
| RTSP        | `rtsp://192.168.1.100:554/stream`           |
| HTTP Stream | `http://192.168.1.100:8080/video`           |
| IP Camera   | `http://192.168.1.100/cgi-bin/stream`       |
| USB Camera  | `0`, `1`, `/dev/video0`                     |
| CCTV/NVR    | `rtsp://nvr.local:554/ch1`                  |
| ONVIF       | `http://192.168.1.100/onvif/device_service` |

---

# ⚙ Detection Settings

| Setting              | Default | Description                         |
| -------------------- | ------- | ----------------------------------- |
| Confidence Threshold | 65%     | Minimum confidence to trigger alert |
| Detection Interval   | 150ms   | Time between detection runs         |
| Frame Skip           | 2       | Skip N frames per detection         |
| Resolution           | 416×416 | YOLOv8 input resolution             |
| GPU                  | Enabled | Use CUDA/Metal acceleration         |

---

# 🧰 Technology Stack

## Frontend

* Next.js 15
* React 19
* Tailwind CSS
* Zustand
* Recharts

## Desktop

* Tauri v2
* Rust

## AI Engine

* YOLOv8
* Python
* PyTorch
* OpenCV

## Notifications

* Sonner
* Tauri Native Notifications

## Icons

* Lucide React

---

# 🔧 Troubleshooting

## Failed to Load Cargo Metadata

```bash
cargo clean
rustup update
npm install
```

---

## Python Module Not Found

```bash
pip install -r requirements.txt
```

---

## Tauri Build Fails

Ensure the following are installed:

* Rust
* Visual Studio C++ Build Tools
* Tauri CLI

---

## PyTorch GPU Not Detected

Run:

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

If the output is:

```bash
True
```

GPU acceleration is working successfully.

---

# 📜 License

MIT License

---

# 👨‍💻 Author

Drone Detection System Team
