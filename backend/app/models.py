"""Database models. Mirrors Section 6 of the roadmap.

Biometric tables live in the separate `biometric` schema. Only app/services/face/* and
app/routers/enrollment.py may touch them.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

ROLES = ("student", "teacher", "admin", "biometric_officer")
EXCEPTION_REASONS = ("camera_failure", "accessibility", "false_rejection", "not_enrolled", "other")


def _in(col: str, values: tuple[str, ...]) -> str:
    return f"{col} IN ({', '.join(repr(v) for v in values)})"


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# ===== Core =====
class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="ck_users_role"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    college_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    identity_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class Class(Base):
    __tablename__ = "classes"
    __table_args__ = (UniqueConstraint("code", "term", name="uq_classes_code_term"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    teacher_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    term: Mapped[str] = mapped_column(String(32), nullable=False)

    teacher: Mapped[User] = relationship()


class ClassMember(Base):
    __tablename__ = "class_members"

    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), primary_key=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"
    __table_args__ = (
        CheckConstraint(_in("status", ("scheduled", "open", "closed", "cancelled")), name="ck_sessions_status"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    class_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("classes.id"), nullable=False, index=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    face_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Random per-session salt. The QR signing key is derived from QR_SIGNING_KEY (secret manager)
    # and this salt; the key itself is never stored.
    qr_secret_ref: Mapped[str] = mapped_column(String(64), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Location restriction: teacher's position at session start + radius. NULL radius = not restricted.
    location_lat: Mapped[float | None] = mapped_column(Float)
    location_lon: Mapped[float | None] = mapped_column(Float)
    location_accuracy_m: Mapped[float | None] = mapped_column(Float)
    geofence_radius_m: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = _now()

    klass: Mapped[Class] = relationship()


# ===== Attendance =====
class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("student_id", "session_id", name="uq_attendance_student_session"),
        CheckConstraint(_in("status", ("present", "present_exception")), name="ck_records_status"),
        CheckConstraint(
            _in("verification_method", ("qr_only", "qr_face", "manual_exception")), name="ck_records_method"
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_sessions.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    verification_method: Mapped[str] = mapped_column(String(32), nullable=False)
    face_verification_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("biometric.verification_results.id", ondelete="SET NULL")
    )
    exception_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("attendance_exceptions.id"))
    marked_at: Mapped[datetime] = _now()  # SERVER time only
    device_id_hash: Mapped[str | None] = mapped_column(String(64))


class AttendanceChallenge(Base):
    """Single-use, student-bound, session-bound nonce issued by /attendance/start."""

    __tablename__ = "attendance_challenges"

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_sessions.id"), nullable=False)
    nonce_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    liveness_challenge: Mapped[str] = mapped_column(String(32), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class AttendanceAttempt(Base):
    """Every verification try, including rejections."""

    __tablename__ = "attendance_attempts"
    __table_args__ = (Index("idx_attempts_student_session", "student_id", "session_id"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_sessions.id"), nullable=False)
    nonce_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[str] = mapped_column(String(16), nullable=False)  # accepted / rejected
    reason_code: Mapped[str | None] = mapped_column(String(32))
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    device_id_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _now()


# ===== Biometric (separate schema) =====
class FaceTemplate(Base):
    __tablename__ = "face_templates"
    __table_args__ = (
        CheckConstraint(_in("status", ("active", "pending_review", "revoked", "deleted")), name="ck_tpl_status"),
        {"schema": "biometric"},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    template_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)  # encrypted embedding, NOT an image
    key_version: Mapped[str] = mapped_column(String(16), nullable=False)
    model_name: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str] = mapped_column(String(32), nullable=False)
    quality_score: Mapped[float | None] = mapped_column(Float)
    enrolled_at: Mapped[datetime] = _now()
    enrolled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    delete_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ConsentRecord(Base):
    __tablename__ = "consent_records"
    __table_args__ = {"schema": "biometric"}

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    consent_version: Mapped[str] = mapped_column(String(32), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purpose: Mapped[str] = mapped_column(String(64), nullable=False, default="attendance_verification")


class VerificationResult(Base):
    __tablename__ = "verification_results"
    __table_args__ = (
        CheckConstraint(
            _in("decision", ("match", "no_match", "low_quality", "spoof_suspected", "error")), name="ck_vr_decision"
        ),
        {"schema": "biometric"},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_sessions.id"), nullable=False)
    match_score: Mapped[float | None] = mapped_column(Float)
    threshold_used: Mapped[float | None] = mapped_column(Float)
    liveness_passed: Mapped[bool | None] = mapped_column(Boolean)
    liveness_method: Mapped[str | None] = mapped_column(String(64))
    decision: Mapped[str] = mapped_column(String(32), nullable=False)
    verified_at: Mapped[datetime] = _now()
    purge_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


# ===== Exceptions & enrollment support =====
class AttendanceException(Base):
    __tablename__ = "attendance_exceptions"
    __table_args__ = (CheckConstraint(_in("reason_category", EXCEPTION_REASONS), name="ck_exc_reason"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_sessions.id"), nullable=False, index=True)
    approved_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    reason_category: Mapped[str] = mapped_column(String(32), nullable=False)
    reason_note: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = _now()
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VerificationRequest(Base):
    """A student's 'Request teacher verification' tap; appears in the teacher's queue."""

    __tablename__ = "verification_requests"
    __table_args__ = (
        UniqueConstraint("student_id", "session_id", name="uq_vreq_student_session"),
        CheckConstraint(_in("status", ("pending", "approved", "dismissed")), name="ck_vreq_status"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("attendance_sessions.id"), nullable=False, index=True)
    last_reason_code: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = _now()
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FaceVerificationOptOut(Base):
    __tablename__ = "face_verification_opt_outs"

    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    reason_category: Mapped[str] = mapped_column(String(32), nullable=False)
    approved_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    alternative_method: Mapped[str] = mapped_column(String(32), nullable=False, default="teacher_verified")
    created_at: Mapped[datetime] = _now()


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("idx_audit_created", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column()
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column()
    ip_address: Mapped[str | None] = mapped_column(INET)
    details: Mapped[dict | None] = mapped_column(JSONB)  # never include raw biometric data
    created_at: Mapped[datetime] = _now()
