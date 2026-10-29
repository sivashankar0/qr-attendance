"""Download the OpenCV Zoo face models used by the SFace verifier.

- YuNet face detector (MIT licence)
- SFace face recogniser (Apache-2.0 licence)
Source: https://github.com/opencv/opencv_zoo

Usage: python scripts/download_models.py
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/opencv/opencv_zoo/raw/main/models"
MODELS = {
    "face_detection_yunet_2023mar.onnx": f"{BASE}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx": f"{BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
}
# Pinned after first verified download; a mismatch aborts so a swapped model is never loaded.
SHA256 = {
    "face_detection_yunet_2023mar.onnx": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    "face_recognition_sface_2021dec.onnx": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
}

out_dir = Path(__file__).resolve().parent.parent / "models"
out_dir.mkdir(exist_ok=True)

for name, url in MODELS.items():
    dest = out_dir / name
    if not dest.exists():
        print(f"downloading {name} ...")
        urllib.request.urlretrieve(url, dest)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    if dest.stat().st_size < 100_000:
        sys.exit(f"{name} looks truncated ({dest.stat().st_size} bytes); delete it and retry")
    if SHA256[name] and SHA256[name] != digest:
        sys.exit(f"{name} checksum mismatch: {digest}")
    print(f"{name}: {dest.stat().st_size} bytes sha256={digest}")
