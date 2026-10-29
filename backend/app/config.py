import base64
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str

    # Auth
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 7

    # QR
    qr_signing_key: str
    qr_rotation_seconds: int = 5
    # Backend accepts the current window and this many previous windows (scan + network latency).
    # With 5 s rotation and 2 grace windows a token is valid for at most ~15 s.
    qr_grace_windows: int = 2

    # Attendance
    challenge_ttl_seconds: int = 120
    max_attempts_per_session: int = 3
    attempt_cooldown_seconds: int = 5
    max_session_minutes: int = 240

    # Device fingerprint hashing (HMAC key so raw device ids are never stored)
    device_hash_key: str

    # Biometric template encryption. Format: "v1:<base64 32 bytes>,v2:<base64 32 bytes>"
    # In production these come from a KMS / secret manager, injected as env at runtime.
    template_keys: str
    template_active_key_version: str = "v1"

    # Face verification
    face_verifier: str = "sface"  # "sface" | "mock"
    face_models_dir: str = "models"
    face_pool_size: int = 2  # detector/recogniser instances; use 1 on 512 MB hosts
    # OpenCV SFace cosine-similarity threshold. 0.363 is the model authors' published value.
    # MUST be re-tuned from measured FAR/FRR on your own pilot group before rollout.
    face_match_threshold: float = 0.363
    face_min_size_ratio: float = 0.18  # face width / frame width
    face_min_brightness: float = 60.0
    face_max_brightness: float = 220.0
    face_min_sharpness: float = 40.0  # variance of Laplacian on face crop
    face_frontal_max_yaw: float = 0.12  # |yaw| allowed for a "look straight" frame
    liveness_min_yaw: float = 0.15  # normalised nose offset required for a head-turn
    # +1 if a subject turning to THEIR left moves the nose to the right of the (non-mirrored) frame.
    liveness_yaw_sign: int = 1
    max_image_bytes: int = 1_500_000

    # Location restriction (geofence)
    geofence_default_radius_m: int = 100
    geofence_min_radius_m: int = 30
    geofence_max_radius_m: int = 500
    geofence_max_teacher_accuracy_m: float = 100.0
    geofence_max_student_accuracy_m: float = 100.0
    geofence_anchor_tolerance_m: float = 30.0

    # Retention
    verification_result_retention_days: int = 90
    template_retention_days_after_inactive: int = 30

    # Rate limiting storage ("memory://" or "redis://host:6379")
    rate_limit_storage: str = "memory://"

    @field_validator("database_url")
    @classmethod
    def _psycopg_driver(cls, v: str) -> str:
        # Hosted Postgres (Neon, Render, ...) hands out postgres:// or postgresql:// URLs.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @field_validator("jwt_secret", "qr_signing_key", "device_hash_key")
    @classmethod
    def _long_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("secret must be at least 32 characters")
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def template_key_map(self) -> dict[str, bytes]:
        keys: dict[str, bytes] = {}
        for part in self.template_keys.split(","):
            version, _, b64 = part.strip().partition(":")
            raw = base64.b64decode(b64)
            if len(raw) != 32:
                raise ValueError(f"template key {version} must be 32 bytes")
            keys[version] = raw
        if self.template_active_key_version not in keys:
            raise ValueError("active template key version not found in TEMPLATE_KEYS")
        return keys


@lru_cache
def get_settings() -> Settings:
    return Settings()
