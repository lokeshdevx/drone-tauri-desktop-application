// python_sidecar.rs — finds Python, spawns python-backend/main.py, waits for health.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub struct PythonSidecar {
    child: Option<Child>,
}

impl PythonSidecar {
    pub fn new() -> Self {
        Self { child: None }
    }

    pub async fn start(&mut self) -> Result<u16, String> {
        let python = find_python()?;
        let script = find_script()?;
        let port   = find_free_port(7000);

        eprintln!(
            "[sidecar] python={:?}  script={}  port={}",
            python,
            script.display(),
            port
        );

        let child = Command::new(&python)
            .arg(&script)
            .env("DRONE_PORT", port.to_string())
            .current_dir(script.parent().unwrap_or(&script))
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn {:?}: {}", python, e))?;

        self.child = Some(child);

        wait_for_health(port, Duration::from_secs(60)).await?;
        Ok(port)
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("[sidecar] Python backend stopped");
        }
    }
}

impl Drop for PythonSidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

// ── Find Python ────────────────────────────────────────────────────────────────

fn find_python() -> Result<String, String> {
    let candidates: Vec<String> = if cfg!(target_os = "windows") {
        vec![
            // Check venv inside project first (most reliable for builds)
            r"python-backend\.venv\Scripts\python.exe".into(),
            "python".into(),
            "python3".into(),
            "py".into(),
        ]
    } else {
        vec![
            "python-backend/.venv/bin/python3".into(),
            "python3".into(),
            "python".into(),
        ]
    };

    for c in &candidates {
        if cmd_exists(c) {
            return Ok(c.clone());
        }
    }

    Err(format!(
        "Python not found. Tried: {}\nInstall Python 3.9+",
        candidates.join(", ")
    ))
}

fn cmd_exists(name: &str) -> bool {
    if std::path::Path::new(name).exists() {
        return true;
    }
    Command::new(name)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// ── Find python-backend/main.py ────────────────────────────────────────────────

fn find_script() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));

    let candidates = [
        // Production bundle: python-backend/ is next to the .exe
        exe_dir.join("python-backend").join("main.py"),
        // Dev: target/debug → up 3 levels
        exe_dir.join("..").join("..").join("..").join("python-backend").join("main.py"),
        exe_dir.join("..").join("..").join("python-backend").join("main.py"),
        // CWD fallback (cargo tauri dev from project root)
        PathBuf::from("python-backend").join("main.py"),
    ];

    for p in &candidates {
        if let Ok(canon) = p.canonicalize() {
            if canon.is_file() {
                // Strip Windows \\?\ extended-length path prefix
                // Python doesn't handle it well on older Windows versions
                let path_str = canon.to_string_lossy().into_owned();
                let clean = if path_str.starts_with(r"\\?\") {
                    PathBuf::from(&path_str[4..])
                } else {
                    canon
                };
                return Ok(clean);
            }
        }
    }

    Err(format!(
        "python-backend/main.py not found.\nSearched:\n{}",
        candidates.iter().map(|p| format!("  {}", p.display())).collect::<Vec<_>>().join("\n")
    ))
}

// ── Port helpers ───────────────────────────────────────────────────────────────

fn find_free_port(start: u16) -> u16 {
    (start..start + 100)
        .find(|&p| std::net::TcpListener::bind(format!("127.0.0.1:{}", p)).is_ok())
        .unwrap_or(start)
}

// ── Health check ───────────────────────────────────────────────────────────────

async fn wait_for_health(port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let addr     = format!("127.0.0.1:{}", port);

    loop {
        if Instant::now() >= deadline {
            return Err(format!(
                "Python backend did not start within {}s on port {}.\n\
                 Check the terminal for Python errors.",
                timeout.as_secs(),
                port
            ));
        }

        if TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(300),
        ).is_ok() {
            let url = format!("http://{}/api/health", addr);
            if let Ok(body) = http_get(&url) {
                if body.contains("\"ok\"") || body.contains("\"status\"") {
                    eprintln!("[sidecar] backend healthy ✓");
                    return Ok(());
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

fn http_get(url: &str) -> Result<String, String> {
    let without_scheme = url.trim_start_matches("http://");
    let slash = without_scheme.find('/').unwrap_or(without_scheme.len());
    let addr  = &without_scheme[..slash];
    let path  = if slash < without_scheme.len() { &without_scheme[slash..] } else { "/" };

    let mut stream = TcpStream::connect(addr).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    write!(
        stream,
        "GET {} HTTP/1.0\r\nHost: {}\r\nConnection: close\r\n\r\n",
        path, addr
    ).map_err(|e| e.to_string())?;

    let mut buf = String::new();
    stream.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}