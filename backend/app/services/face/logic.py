"""Server-side face decisions and encrypted template storage.

This module is the ONLY reader/writer of biometric.face_templates.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.models import FaceTemplate
from app.reason_codes import AttendanceError, Reason
from app.security import decrypt_template, encrypt_template, utcnow
from app.services.face.verifier import FaceVerifier, FrameAnalysis, similarity

CHALLENGES = ("turn_left", "turn_right")
LIVENESS_METHOD = "active_head_turn_v1"


def new_challenge() -> str:
    return secrets.choice(CHALLENGES)


def _direction_ok(yaw: float, challenge: str) -> bool:
    s = get_settings()
    signed = yaw * s.liveness_yaw_sign * (1 if challenge == "turn_left" else -1)
    return signed >= s.liveness_min_yaw


def _first_issue(frames: list[FrameAnalysis]) -> Reason:
    # Report the most actionable problem to the student.
    for reason in (Reason.MULTIPLE_FACES, Reason.FACE_NOT_DETECTED, Reason.LOW_QUALITY):
        if any(f.issue == reason for f in frames):
            return reason
    return Reason.LOW_QUALITY


@dataclass
class Decision:
    decision: str  # match | no_match | low_quality | spoof_suspected
    reason: Reason | None
    score: float | None
    liveness_passed: bool | None


def decide(
    verifier: FaceVerifier,
    template: np.ndarray,
    front_frames: list[bytes],
    challenge_frames: list[bytes],
    challenge: str,
) -> Decision:
    s = get_settings()
    fronts = [verifier.analyse(b) for b in front_frames]
    good_fronts = [f for f in fronts if f.issue is None and abs(f.yaw) <= s.face_frontal_max_yaw]
    if not good_fronts:
        return Decision("low_quality", _first_issue(fronts) if any(f.issue for f in fronts) else Reason.LOW_QUALITY, None, None)

    best = max(good_fronts, key=lambda f: similarity(f.embedding, template))
    score = similarity(best.embedding, template)
    if score < s.face_match_threshold:
        return Decision("no_match", Reason.FACE_MISMATCH, score, None)

    turns = [verifier.analyse(b) for b in challenge_frames]
    # Liveness: at least one challenge frame shows the requested head turn AND is the same person
    # as the matched frontal frame (prevents swapping in a different face for the turn).
    same_person_min = s.face_match_threshold * 0.8
    live = any(
        t.issue is None and _direction_ok(t.yaw, challenge) and similarity(t.embedding, best.embedding) >= same_person_min
        for t in turns
    )
    if not live:
        return Decision("spoof_suspected", Reason.LIVENESS_FAILED, score, False)
    return Decision("match", None, score, True)


# ----- enrollment -----
@dataclass
class EnrollmentResult:
    embedding: np.ndarray
    quality: float
    status: str  # active | pending_review


def build_template(verifier: FaceVerifier, front: list[bytes], left: list[bytes], right: list[bytes]) -> EnrollmentResult:
    s = get_settings()
    f = [verifier.analyse(b) for b in front]
    l_ = [verifier.analyse(b) for b in left]
    r = [verifier.analyse(b) for b in right]

    good_front = [a for a in f if a.issue is None and abs(a.yaw) <= s.face_frontal_max_yaw]
    if not good_front:
        raise AttendanceError(_first_issue(f) if any(a.issue for a in f) else Reason.LOW_QUALITY)
    # Enrollment liveness: the guided left/right turns must actually happen.
    good_left = [a for a in l_ if a.issue is None and _direction_ok(a.yaw, "turn_left")]
    good_right = [a for a in r if a.issue is None and _direction_ok(a.yaw, "turn_right")]
    if not good_left or not good_right:
        raise AttendanceError(Reason.LIVENESS_FAILED)

    samples = good_front + good_left + good_right
    anchor = good_front[0].embedding
    consistency = min(similarity(a.embedding, anchor) for a in samples)
    if consistency < s.face_match_threshold * 0.6:
        # Samples look like different people: reject outright.
        raise AttendanceError(Reason.FACE_MISMATCH)

    # The template is built from frontal samples (what verification compares against).
    emb = np.mean([a.embedding for a in good_front], axis=0)
    emb = emb / (np.linalg.norm(emb) + 1e-9)
    quality = float(np.mean([a.quality for a in samples]))
    status = "active" if consistency >= s.face_match_threshold and quality >= 0.3 else "pending_review"
    return EnrollmentResult(embedding=emb.astype(np.float32), quality=quality, status=status)


def store_template(
    db: Session, student_id: uuid.UUID, result: EnrollmentResult, verifier: FaceVerifier, actor_id: uuid.UUID
) -> FaceTemplate:
    ciphertext, key_version = encrypt_template(result.embedding.tobytes(), aad=student_id.bytes)
    existing = db.scalar(select(FaceTemplate).where(FaceTemplate.student_id == student_id))
    if existing is not None:
        # Re-enrollment: overwrite the old template in place (old ciphertext is gone).
        db.delete(existing)
        db.flush()
        audit(db, "template.replace", actor_id, student_id)
    tpl = FaceTemplate(
        student_id=student_id,
        template_ciphertext=ciphertext,
        key_version=key_version,
        model_name=verifier.model_name,
        model_version=verifier.model_version,
        quality_score=round(result.quality, 3),
        enrolled_by=actor_id,
        status=result.status,
    )
    db.add(tpl)
    audit(db, "enrollment.create", actor_id, student_id, status=result.status)
    return tpl


def load_active_template(db: Session, student_id: uuid.UUID, verifier: FaceVerifier, actor_id: uuid.UUID) -> np.ndarray:
    tpl = db.scalar(select(FaceTemplate).where(FaceTemplate.student_id == student_id, FaceTemplate.status == "active"))
    if tpl is None:
        raise AttendanceError(Reason.FACE_NOT_ENROLLED)
    if tpl.model_name != verifier.model_name or tpl.model_version != verifier.model_version:
        # Model changed: templates are model-specific, re-enrollment required.
        raise AttendanceError(Reason.FACE_NOT_ENROLLED)
    audit(db, "template.read", actor_id, student_id, purpose="attendance_verification")
    raw = decrypt_template(tpl.template_ciphertext, tpl.key_version, aad=student_id.bytes)
    return np.frombuffer(raw, dtype=np.float32)


def has_active_template(db: Session, student_id: uuid.UUID) -> bool:
    return (
        db.scalar(
            select(FaceTemplate.id).where(FaceTemplate.student_id == student_id, FaceTemplate.status == "active")
        )
        is not None
    )


def delete_template(db: Session, student_id: uuid.UUID, actor_id: uuid.UUID, reason: str) -> bool:
    tpl = db.scalar(select(FaceTemplate).where(FaceTemplate.student_id == student_id))
    if tpl is None:
        return False
    db.delete(tpl)
    audit(db, "template.delete", actor_id, student_id, reason=reason)
    return True


def face_change_info(user) -> dict:
    """Re-enrollment allowance. Initial enrollment is free; each later successful replacement uses one."""
    from app.models import FACE_CHANGE_LIMIT

    allowed = FACE_CHANGE_LIMIT + (user.face_changes_extra or 0)
    used = user.face_changes_used or 0
    return {
        "enrolled_once": bool(user.face_enrolled_once),
        "changes_used": used,
        "changes_allowed": allowed,
        "changes_remaining": max(0, allowed - used),
        "limit_reached": bool(user.face_enrolled_once) and used >= allowed,
    }


def verification_purge_after():
    return utcnow() + timedelta(days=get_settings().verification_result_retention_days)
