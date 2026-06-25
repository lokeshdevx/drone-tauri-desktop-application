#!/usr/bin/env python3
"""
Download the drone detection model (drone.pt).

  python download_model.py --url https://your-server.com/drone.pt

Roboflow (train your own):
  pip install roboflow
  python download_model.py --roboflow --api-key YOUR_KEY

The backend requires python-backend/models/drone.pt for detection.
Generic COCO models such as yolov8n.pt are not used.
"""

import argparse
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

def progress(count, block, total):
    pct = min(100, count * block * 100 // total)
    bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
    print(f"\r  [{bar}] {pct}%", end="", flush=True)


def download_from_url(url: str):
    dest = MODELS_DIR / "drone.pt"
    print(f"Downloading custom model from {url}…")
    urllib.request.urlretrieve(url, dest, reporthook=progress)
    print(f"\n✅ Saved to {dest}")
    print("✅ Backend will use this as the primary drone detection model")


def download_roboflow(api_key: str):
    try:
        from roboflow import Roboflow
    except ImportError:
        print("Install roboflow: pip install roboflow")
        sys.exit(1)

    print("Connecting to Roboflow…")
    rf = Roboflow(api_key=api_key)

    # Try to find a drone detection project
    try:
        project  = rf.workspace().project("drone-detection-4")
        dataset  = project.version(4).download("yolov8")
        print(f"✅ Dataset downloaded to {dataset.location}")
        print("\nNow train the model:")
        print(f"  yolo train model=yolov8n.pt data={dataset.location}/data.yaml epochs=100 imgsz=640")
        print("\nThen copy the trained model:")
        print("  cp runs/detect/train/weights/best.pt python-backend/models/drone.pt")
    except Exception as e:
        print(f"Roboflow error: {e}")
        print("\nManual steps:")
        print("1. Go to https://universe.roboflow.com/search?q=drone+detection")
        print("2. Pick a dataset with 'drone' class")
        print("3. Export as YOLOv8 PyTorch format")
        print("4. Train or use pre-trained weights")
        print("5. Copy best.pt → python-backend/models/drone.pt")


def main():
    p = argparse.ArgumentParser(
        description="Download drone.pt for the detection backend."
    )
    p.add_argument("--url", help="Direct URL to download drone.pt")
    p.add_argument("--roboflow", action="store_true",
                   help="Download dataset from Roboflow (needs --api-key)")
    p.add_argument("--api-key", help="Roboflow API key")
    args = p.parse_args()

    if args.url:
        download_from_url(args.url)
    elif args.roboflow:
        if not args.api_key:
            print("--api-key required for Roboflow download")
            sys.exit(1)
        download_roboflow(args.api_key)
    else:
        print("Provide --url to download drone.pt, or --roboflow to fetch a training dataset.")
        print(f"Expected model path: {MODELS_DIR / 'drone.pt'}")
        sys.exit(1)


if __name__ == "__main__":
    main()