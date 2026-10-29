import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings

_hasher = PasswordHasher()
# Used to equalise timing when the user does not exist (prevents user enumeration).
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ----- passwords -----
def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, InvalidHashError):
        return False


# ----- tokens -----
def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def create_access_token(user_id: uuid.UUID, role: str) -> str:
    s = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=s.access_token_minutes),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    s = get_settings()
    payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm], options={"require": ["exp", "sub"]})
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload


def hash_device_id(device_id: str | None) -> str | None:
    if not device_id:
        return None
    key = get_settings().device_hash_key.encode()
    return hmac.new(key, device_id[:128].encode(), hashlib.sha256).hexdigest()


# ----- biometric template encryption (AES-256-GCM, versioned keys) -----
def encrypt_template(plaintext: bytes, aad: bytes) -> tuple[bytes, str]:
    s = get_settings()
    version = s.template_active_key_version
    key = s.template_key_map()[version]
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad), version


def decrypt_template(ciphertext: bytes, key_version: str, aad: bytes) -> bytes:
    key = get_settings().template_key_map()[key_version]
    return AESGCM(key).decrypt(ciphertext[:12], ciphertext[12:], aad)
