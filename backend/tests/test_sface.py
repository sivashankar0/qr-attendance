"""Smoke tests for the real SFace verifier (skipped if models are not downloaded)."""

from pathlib import Path

import cv2
import numpy as np
import pytest

from app.reason_codes import Reason

MODELS = Path(__file__).resolve().parent.parent / "models"
pytestmark = pytest.mark.skipif(
    not (MODELS / "face_recognition_sface_2021dec.onnx").exists(), reason="face models not downloaded"
)


@pytest.fixture(scope="module")
def sface():
    from app.services.face.verifier import SFaceVerifier

    return SFaceVerifier(str(MODELS))


def _jpeg(img) -> bytes:
    return cv2.imencode(".jpg", img)[1].tobytes()


def test_blank_image_has_no_face(sface):
    assert sface.analyse(_jpeg(np.full((480, 640, 3), 128, np.uint8))).issue == Reason.FACE_NOT_DETECTED


def test_garbage_bytes_rejected(sface):
    assert sface.analyse(b"not an image").issue == Reason.LOW_QUALITY
