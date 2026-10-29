"""Rotating, signed QR tokens (roadmap Section 5.4).

QR text:  QRA1.<session_id>.<window>.<signature>
- window    = floor(unix_time / rotation_seconds)
- signature = HMAC-SHA256(per_session_key, "<session_id>.<window>")[:16 bytes], base64url
- per_session_key = HMAC-SHA256(QR_SIGNING_KEY, session.qr_secret_ref)

The QR carries no student identity, biometric data or secrets. The backend accepts the
current window and `qr_grace_windows` previous windows only.
"""

import base64
import hashlib
import hmac
import time
import uuid
from dataclasses import dataclass

from app.config import get_settings

PREFIX = "QRA1"


@dataclass
class QrPayload:
    session_id: uuid.UUID
    window: int


def _session_key(salt: str) -> bytes:
    return hmac.new(get_settings().qr_signing_key.encode(), salt.encode(), hashlib.sha256).digest()


def _sign(salt: str, session_id: uuid.UUID, window: int) -> str:
    mac = hmac.new(_session_key(salt), f"{session_id}.{window}".encode(), hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(mac).rstrip(b"=").decode()


def current_window(now: float | None = None) -> int:
    return int((now if now is not None else time.time()) // get_settings().qr_rotation_seconds)


def build_qr(session_id: uuid.UUID, salt: str, now: float | None = None) -> tuple[str, float]:
    """Returns (qr_text, unix time the token rotates)."""
    w = current_window(now)
    rotates_at = (w + 1) * get_settings().qr_rotation_seconds
    return f"{PREFIX}.{session_id}.{w}.{_sign(salt, session_id, w)}", rotates_at


def parse_qr(text: str) -> QrPayload | None:
    parts = text.strip().split(".")
    if len(parts) != 4 or parts[0] != PREFIX:
        return None
    try:
        return QrPayload(session_id=uuid.UUID(parts[1]), window=int(parts[2]))
    except ValueError:
        return None


def verify_qr(text: str, salt: str, now: float | None = None) -> bool:
    payload = parse_qr(text)
    if payload is None:
        return False
    w = current_window(now)
    if not (w - get_settings().qr_grace_windows <= payload.window <= w):
        return False
    expected = _sign(salt, payload.session_id, payload.window)
    return hmac.compare_digest(expected, text.strip().split(".")[3])
