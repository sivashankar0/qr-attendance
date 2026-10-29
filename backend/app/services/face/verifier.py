"""Pluggable face verification (roadmap Section 4: `FaceVerifier`).

Implementations:
- SFaceVerifier: OpenCV YuNet detector + SFace recogniser, runs on the SERVER.
- MockFaceVerifier: deterministic fake for automated tests ONLY. Refuses to load in production.

The client never decides anything: it only uploads frames; every decision below is server-side.
Liveness here is a BASIC active challenge (random head-turn direction bound to a server nonce).
It defeats static photos and naive replays; it is NOT certified presentation-attack detection.
"""

import hashlib
import queue
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from app.config import get_settings
from app.reason_codes import Reason


@dataclass
class FrameAnalysis:
    issue: Reason | None  # None = usable frame
    yaw: float = 0.0  # >0: subject turned to THEIR left (non-mirrored camera frame)
    embedding: np.ndarray | None = None  # L2-normalised
    quality: float = 0.0  # 0..1, for enrollment review only


class FaceVerifier(Protocol):
    model_name: str
    model_version: str

    def analyse(self, image_bytes: bytes) -> FrameAnalysis: ...


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def _normalise(v: np.ndarray) -> np.ndarray:
    v = v.astype(np.float32).ravel()
    return v / (np.linalg.norm(v) + 1e-9)


class SFaceVerifier:
    model_name = "opencv-sface"
    model_version = "2021dec"

    def __init__(self, models_dir: str, pool_size: int = 2):
        d = Path(models_dir)
        det = d / "face_detection_yunet_2023mar.onnx"
        rec = d / "face_recognition_sface_2021dec.onnx"
        if not det.exists() or not rec.exists():
            raise RuntimeError(f"Face models missing in {d}. Run: python scripts/download_models.py")
        # OpenCV DNN objects are not thread-safe: keep a small pool and check one out per call.
        self._pool: queue.Queue = queue.Queue()
        for _ in range(pool_size):
            self._pool.put(
                (
                    cv2.FaceDetectorYN.create(str(det), "", (320, 320), 0.8, 0.3, 50),
                    cv2.FaceRecognizerSF.create(str(rec), ""),
                )
            )

    def analyse(self, image_bytes: bytes) -> FrameAnalysis:
        s = get_settings()
        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            return FrameAnalysis(issue=Reason.LOW_QUALITY)
        h, w = img.shape[:2]
        if max(h, w) > 1280:
            scale = 1280 / max(h, w)
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
            h, w = img.shape[:2]

        detector, recogniser = self._pool.get()
        try:
            detector.setInputSize((w, h))
            _, faces = detector.detect(img)
            if faces is None or len(faces) == 0:
                return FrameAnalysis(issue=Reason.FACE_NOT_DETECTED)
            if len(faces) > 1:
                return FrameAnalysis(issue=Reason.MULTIPLE_FACES)
            face = faces[0]

            x, y, fw, fh = (int(v) for v in face[:4])
            if fw / w < s.face_min_size_ratio:
                return FrameAnalysis(issue=Reason.LOW_QUALITY)
            crop = img[max(0, y) : y + fh, max(0, x) : x + fw]
            if crop.size == 0:
                return FrameAnalysis(issue=Reason.LOW_QUALITY)
            gray = cv2.cvtColor(cv2.resize(crop, (160, 160)), cv2.COLOR_BGR2GRAY)
            brightness = float(gray.mean())
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            if not (s.face_min_brightness <= brightness <= s.face_max_brightness) or sharpness < s.face_min_sharpness:
                return FrameAnalysis(issue=Reason.LOW_QUALITY)

            # Landmarks: [4:6] right eye, [6:8] left eye, [8:10] nose tip (YuNet order)
            eye_a, eye_b, nose = face[4:6], face[6:8], face[8:10]
            eye_dist = abs(float(eye_b[0] - eye_a[0])) + 1e-6
            yaw = (float(nose[0]) - float(eye_a[0] + eye_b[0]) / 2) / eye_dist

            aligned = recogniser.alignCrop(img, face)
            embedding = _normalise(recogniser.feature(aligned))
        finally:
            self._pool.put((detector, recogniser))

        quality = min(1.0, float(face[14])) * min(1.0, sharpness / (s.face_min_sharpness * 4))
        return FrameAnalysis(issue=None, yaw=yaw, embedding=embedding, quality=quality)


class MockFaceVerifier:
    """TEST ONLY. Frame bytes are text: b"MOCK|<person>|<yaw>" or b"MOCK|<ISSUE_CODE>"."""

    model_name = "mock"
    model_version = "1"

    def __init__(self):
        if get_settings().is_production:
            raise RuntimeError("MockFaceVerifier must never be used in production")

    def analyse(self, image_bytes: bytes) -> FrameAnalysis:
        parts = image_bytes.decode(errors="ignore").split("|")
        if len(parts) < 2 or parts[0] != "MOCK":
            return FrameAnalysis(issue=Reason.FACE_NOT_DETECTED)
        if parts[1] in Reason.__members__:
            return FrameAnalysis(issue=Reason[parts[1]])
        seed = int.from_bytes(hashlib.sha256(parts[1].encode()).digest()[:4], "big")
        emb = _normalise(np.random.default_rng(seed).standard_normal(128))
        yaw = float(parts[2]) if len(parts) > 2 else 0.0
        return FrameAnalysis(issue=None, yaw=yaw, embedding=emb, quality=0.9)


_verifier: FaceVerifier | None = None


def get_verifier() -> FaceVerifier:
    global _verifier
    if _verifier is None:
        s = get_settings()
        if s.face_verifier == "mock":
            _verifier = MockFaceVerifier()
        else:
            models_dir = Path(s.face_models_dir)
            if not models_dir.is_absolute():
                models_dir = Path(__file__).resolve().parents[3] / models_dir
            _verifier = SFaceVerifier(str(models_dir), pool_size=s.face_pool_size)
    return _verifier
