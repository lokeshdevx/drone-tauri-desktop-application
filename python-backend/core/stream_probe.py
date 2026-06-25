"""
stream_probe.py — Universal camera stream URL discovery.

Probes an IP/URL to find a working video stream without any hardcoding.
Strategy:
  1. If it's RTSP → use directly
  2. If it's HTTP → fetch the page, parse it for stream hints
  3. Try standard paths in parallel with short timeouts
  4. Verify each candidate by actually reading a frame
"""

from __future__ import annotations

import logging
import os
import re
import socket
import threading
import time
from typing import Optional
from urllib.parse import urljoin, urlparse

logger = logging.getLogger("drone-backend.probe")


# ── Known path patterns (ordered by likelihood) ───────────────────────────────
# These are tried in parallel — no hardcoding to a specific brand
_STREAM_PATHS = [
    # Most common first
    "/video",
    "/video.cgi",
    "/?action=stream",
    "/mjpeg",
    "/mjpg/video.cgi",
    "/stream",
    "/live",
    "/live/stream",
    "/live/ch0",
    "/cgi-bin/mjpg/video.cgi",
    "/videostream.asf",
    "/img/video.mjpeg",
    "/img/mjpeg.cgi",
    "/streaming/channels/1",
    "/streaming/channels/101",
    "/h264",
    "/mpeg4",
    "/live.sdp",
    "/cam/realmonitor?channel=1&subtype=0",
    "/user=admin_password=_channel=1_stream=0.sdp",
    "/nphMotionJpeg?Resolution=640x480&Quality=Standard",
    "/cgi-bin/camera?resolution=640&quality=5&Language=0&fps=15",
    "/cgi-bin/video.cgi",
    "/axis-cgi/mjpg/video.cgi",
    "/axis-cgi/mjpg/video.cgi?fps=15",
    "/GetData.cgi",
    "/snapshot.cgi",
    "/video.m3u8",
    "/index.m3u8",
    "/cgi-bin/viewer/video.jpg?size=4",
]


def probe(url: str, timeout: float = 10.0) -> str:
    """
    Given any camera URL, return the best working stream URL.
    Falls back to the original URL if nothing better is found.
    
    Tries:
    1. The URL itself
    2. Parse the HTML page for stream hints (src=, data-src=, RTSP links)
    3. Parallel probe of all known paths
    """
    url = url.strip()

    if not url:
        return url

    # USB device
    if url.isdigit():
        return url

    # Pure RTSP — use as-is
    if url.lower().startswith("rtsp://"):
        return url

    # If it already has a meaningful path (not just /), try it first
    parsed = urlparse(url)
    has_path = parsed.path not in ("", "/")

    if has_path:
        # Try as-is, but still run discovery in case it's a web page
        if _can_read_frame(url, timeout=min(timeout, 5.0)):
            logger.info(f"[probe] direct URL works: {url}")
            return url

    # Step 1: Try to fetch the page and extract stream hints
    discovered = _parse_html_for_streams(url, timeout=min(timeout, 4.0))
    for candidate in discovered:
        if _can_read_frame(candidate, timeout=min(timeout, 5.0)):
            logger.info(f"[probe] discovered from HTML: {candidate}")
            return candidate

    # Step 2: Parallel probe all known paths
    base = _base_url(url)
    result = _parallel_probe(base, timeout=timeout)
    if result:
        logger.info(f"[probe] found via parallel probe: {result}")
        return result

    # Step 3: Nothing worked — return original and let OpenCV error naturally
    logger.warning(f"[probe] no stream found for {url}, using as-is")
    return url


def _base_url(url: str) -> str:
    """Extract scheme://host:port from a URL."""
    m = re.match(r"(https?://[^/]+)", url)
    return m.group(1) if m else url


def _can_read_frame(url: str, timeout: float = 5.0) -> bool:
    """
    Verify a URL actually delivers video frames.
    Opens VideoCapture and tries cap.read() once.
    """
    import cv2
    cap = None
    try:
        if url.lower().startswith("rtsp://"):
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                f"rtsp_transport;tcp|stimeout;{int(timeout*1e6)}"
            )
        else:
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                f"stimeout;{int(timeout*1e6)}|fflags;nobuffer"
            )

        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            return False

        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, frame = cap.read()
        return ok and frame is not None and frame.size > 0

    except Exception:
        return False
    finally:
        if cap:
            try: cap.release()
            except Exception: pass


def _parse_html_for_streams(url: str, timeout: float = 4.0) -> list[str]:
    """
    Fetch the URL as HTML and look for:
    - src= / data-src= with video/stream hints
    - RTSP links
    - Common stream path references
    - JavaScript variables with stream URLs
    """
    try:
        import urllib.request
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; stream-probe/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "")

            # If it's already a video stream, return as-is
            if any(t in content_type for t in [
                "video/", "image/jpeg", "multipart/x-mixed-replace",
                "application/octet-stream",
            ]):
                return [url]

            # Not HTML — not useful to parse
            if "text/html" not in content_type and "text/" not in content_type:
                return []

            html = resp.read(64 * 1024).decode("utf-8", errors="ignore")

    except Exception as e:
        logger.debug(f"[probe] HTML fetch failed for {url}: {e}")
        return []

    candidates = []
    base = _base_url(url)

    # Pattern 1: RTSP links in HTML
    for m in re.finditer(r'rtsp://[\w.:/\-@?=&%]+', html, re.IGNORECASE):
        candidates.append(m.group())

    # Pattern 2: src= or data-src= attributes with video-like values
    for m in re.finditer(
        r'(?:src|data-src|data-url|href)\s*=\s*["\']([^"\']+)["\']',
        html, re.IGNORECASE
    ):
        val = m.group(1)
        if any(hint in val.lower() for hint in [
            "video", "mjpeg", "mjpg", "stream", "live", "camera",
            ".cgi", ".asf", ".sdp", ".m3u8",
        ]):
            full = val if val.startswith("http") else urljoin(url, val)
            candidates.append(full)

    # Pattern 3: JavaScript string literals with stream paths
    for m in re.finditer(
        r'["\']([^"\']*(?:video|mjpeg|stream|live)[^"\']*)["\']',
        html, re.IGNORECASE
    ):
        val = m.group(1)
        if val.startswith("/") and len(val) < 200:
            candidates.append(base + val)

    # Deduplicate preserving order
    seen = set()
    result = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            result.append(c)

    logger.debug(f"[probe] HTML scan found {len(result)} candidates")
    return result


def _parallel_probe(base_url: str, timeout: float = 10.0) -> Optional[str]:
    """
    Probe all known stream paths in parallel threads.
    Returns the first one that delivers a frame, or None.
    """
    candidates = [base_url + path for path in _STREAM_PATHS]

    result_holder = [None]
    result_lock   = threading.Lock()
    found_event   = threading.Event()

    # Per-URL timeout: short enough to try many in parallel
    per_timeout = min(4.0, timeout / 2)

    def try_one(url: str):
        if found_event.is_set():
            return
        try:
            if _can_read_frame(url, timeout=per_timeout):
                with result_lock:
                    if result_holder[0] is None:
                        result_holder[0] = url
                        found_event.set()
        except Exception:
            pass

    threads = [threading.Thread(target=try_one, args=(c,), daemon=True)
               for c in candidates]
    
    # Launch in small batches to avoid overwhelming the camera
    batch_size = 6
    deadline = time.time() + timeout

    for i in range(0, len(threads), batch_size):
        if found_event.is_set() or time.time() > deadline:
            break
        batch = threads[i:i + batch_size]
        for t in batch:
            t.start()
        # Wait for this batch or until found
        found_event.wait(timeout=per_timeout + 0.5)

    return result_holder[0]