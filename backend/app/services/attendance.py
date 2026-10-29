"""Attendance business rules. Validation order follows roadmap Section 7.2.

Identity ALWAYS comes from the authenticated user object, never from request bodies.
Timestamps ALWAYS come from the database server (now()).
"""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.models import (
    AttendanceAttempt,
    AttendanceChallenge,
    AttendanceRecord,
    AttendanceSession,
    ClassMember,
    FaceVerificationOptOut,
    User,
    VerificationRequest,
    VerificationResult,
)
from app.reason_codes import MESSAGES, AttendanceError, Reason
from app.security import new_opaque_token, sha256_hex, utcnow
from app.services import geo, qr
from app.services.face import logic
from app.services.face.verifier import FaceVerifier


def session_state(s: AttendanceSession) -> str:
    if s.status == "open" and utcnow() >= s.expires_at:
        return "expired"
    return s.status


def _check_session_open(s: AttendanceSession | None) -> AttendanceSession:
    if s is None or s.status == "cancelled":
        raise AttendanceError(Reason.SESSION_INVALID)
    if session_state(s) != "open" or utcnow() < s.starts_at:
        raise AttendanceError(Reason.SESSION_EXPIRED)
    return s


def _check_member(db: Session, s: AttendanceSession, student_id: uuid.UUID) -> None:
    if db.get(ClassMember, (s.class_id, student_id)) is None:
        raise AttendanceError(Reason.NOT_IN_CLASS, status_code=403)


def _check_not_marked(db: Session, session_id: uuid.UUID, student_id: uuid.UUID) -> None:
    exists = db.scalar(
        select(AttendanceRecord.id).where(
            AttendanceRecord.session_id == session_id, AttendanceRecord.student_id == student_id
        )
    )
    if exists:
        raise AttendanceError(Reason.ALREADY_MARKED, status_code=409)


def _attempt_count(db: Session, session_id: uuid.UUID, student_id: uuid.UUID) -> int:
    return db.scalar(
        select(func.count()).select_from(AttendanceAttempt).where(
            AttendanceAttempt.session_id == session_id, AttendanceAttempt.student_id == student_id
        )
    ) or 0


def _issue_challenge(db: Session, session_id: uuid.UUID, student_id: uuid.UUID) -> tuple[str, str]:
    # Any older unused challenge for this pair is invalidated: only one live nonce at a time.
    db.execute(
        update(AttendanceChallenge)
        .where(
            AttendanceChallenge.session_id == session_id,
            AttendanceChallenge.student_id == student_id,
            AttendanceChallenge.used_at.is_(None),
        )
        .values(used_at=func.now())
    )
    nonce = new_opaque_token()
    challenge = logic.new_challenge()
    db.add(
        AttendanceChallenge(
            student_id=student_id,
            session_id=session_id,
            nonce_hash=sha256_hex(nonce),
            liveness_challenge=challenge,
            expires_at=utcnow() + timedelta(seconds=get_settings().challenge_ttl_seconds),
        )
    )
    return nonce, challenge


def _session_info(s: AttendanceSession) -> dict:
    return {"session_id": str(s.id), "class_code": s.klass.code, "class_name": s.klass.name}


def _record(db: Session, **kwargs) -> AttendanceRecord:
    rec = AttendanceRecord(**kwargs)
    db.add(rec)
    try:
        db.flush()
    except IntegrityError:
        # UNIQUE(student_id, session_id) is the race-safe duplicate guard.
        db.rollback()
        raise AttendanceError(Reason.ALREADY_MARKED, status_code=409)
    return rec


def _upsert_request(db: Session, session_id: uuid.UUID, student_id: uuid.UUID, reason: str | None) -> None:
    req = db.scalar(
        select(VerificationRequest).where(
            VerificationRequest.session_id == session_id, VerificationRequest.student_id == student_id
        )
    )
    if req is None:
        db.add(VerificationRequest(session_id=session_id, student_id=student_id, last_reason_code=reason))
    elif req.status != "approved":
        req.status = "pending"
        req.last_reason_code = reason or req.last_reason_code


# ---------------------------------------------------------------- start
def _check_location(db: Session, s: AttendanceSession, student: User, location, request: Request) -> None:
    try:
        distance = geo.check_student_location(s, location)
    except AttendanceError as e:
        # Audit the rejection with the rounded distance only; student coordinates are never stored.
        d = e.extra.get("_distance")
        audit(db, "location.reject", student.id, s.id, reason=e.reason.value,
              distance_m=round(d) if d is not None else None, request=request)
        db.commit()
        e.extra.update(_session_info(s))
        raise
    if distance is not None:
        audit(db, "location.pass", student.id, s.id, distance_m=round(distance), request=request)


def start(
    db: Session, student: User, qr_text: str, device_hash: str | None, request: Request,
    location: "geo.LocationIn | None" = None,
) -> dict:
    payload = qr.parse_qr(qr_text)
    if payload is None:
        raise AttendanceError(Reason.SESSION_INVALID)
    s = db.get(AttendanceSession, payload.session_id)
    if s is None or not qr.verify_qr(qr_text, s.qr_secret_ref):
        raise AttendanceError(Reason.SESSION_INVALID)
    _check_session_open(s)
    _check_member(db, s, student.id)
    _check_not_marked(db, s.id, student.id)
    _check_location(db, s, student, location, request)

    if not s.face_required:
        rec = _record(
            db, student_id=student.id, session_id=s.id, status="present", verification_method="qr_only",
            device_id_hash=device_hash,
        )
        audit(db, "attendance.mark", student.id, rec.id, method="qr_only", request=request)
        db.commit()
        db.refresh(rec)
        return {"ok": True, "mode": "done", "status": "present", "method": "qr_only",
                "marked_at": rec.marked_at.isoformat(), **_session_info(s)}

    if db.get(FaceVerificationOptOut, student.id) is not None:
        # Approved alternative method: route to teacher verification, no face step.
        _upsert_request(db, s.id, student.id, "ALTERNATIVE_METHOD")
        db.commit()
        return {"ok": True, "mode": "manual", "message": MESSAGES[Reason.MANUAL_REQUIRED], **_session_info(s)}

    if not logic.has_active_template(db, student.id):
        raise AttendanceError(Reason.FACE_NOT_ENROLLED, extra={"can_request_manual": True, **_session_info(s)})

    used = _attempt_count(db, s.id, student.id)
    max_attempts = get_settings().max_attempts_per_session
    if used >= max_attempts:
        raise AttendanceError(Reason.RETRY_LIMIT, status_code=429, extra={"can_request_manual": True, **_session_info(s)})

    nonce, challenge = _issue_challenge(db, s.id, student.id)
    db.commit()
    return {
        "ok": True,
        "mode": "face",
        "nonce": nonce,
        "challenge": challenge,
        "attempt_no": used + 1,
        "max_attempts": max_attempts,
        "expires_in": get_settings().challenge_ttl_seconds,
        **_session_info(s),
    }


# ---------------------------------------------------------------- verify
@dataclass
class VerifyInput:
    nonce: str
    front_frames: list[bytes]
    challenge_frames: list[bytes]


def verify(
    db: Session, student: User, data: VerifyInput, verifier: FaceVerifier, device_hash: str | None, request: Request
) -> dict:
    s_cfg = get_settings()
    nonce_hash = sha256_hex(data.nonce)

    # 1-2. nonce: exists, unused, belongs to THIS student, not expired
    ch = db.scalar(select(AttendanceChallenge).where(AttendanceChallenge.nonce_hash == nonce_hash))
    if ch is None or ch.student_id != student.id or ch.used_at is not None or utcnow() >= ch.expires_at:
        raise AttendanceError(Reason.CHALLENGE_INVALID)

    # 3-5. session, membership, duplicate
    s = _check_session_open(db.get(AttendanceSession, ch.session_id))
    _check_member(db, s, student.id)
    _check_not_marked(db, s.id, student.id)

    # 6. retry limit + cooldown
    used = _attempt_count(db, s.id, student.id)
    if used >= s_cfg.max_attempts_per_session:
        raise AttendanceError(Reason.RETRY_LIMIT, status_code=429, extra={"can_request_manual": True})
    last = db.scalar(
        select(func.max(AttendanceAttempt.created_at)).where(
            AttendanceAttempt.session_id == s.id, AttendanceAttempt.student_id == student.id
        )
    )
    if last is not None and utcnow() - last < timedelta(seconds=s_cfg.attempt_cooldown_seconds):
        raise AttendanceError(Reason.COOLDOWN, status_code=429)

    # Consume the nonce atomically BEFORE heavy work: a concurrent replay finds it used.
    consumed = db.execute(
        update(AttendanceChallenge)
        .where(AttendanceChallenge.id == ch.id, AttendanceChallenge.used_at.is_(None))
        .values(used_at=func.now())
    ).rowcount
    db.commit()
    if consumed != 1:
        raise AttendanceError(Reason.CHALLENGE_INVALID)

    # 7. quality -> match -> liveness, all server-side
    try:
        template = logic.load_active_template(db, student.id, verifier, actor_id=student.id)
        decision = logic.decide(verifier, template, data.front_frames, data.challenge_frames, ch.liveness_challenge)
    except AttendanceError as e:
        db.commit()  # keep the template.read audit row
        raise e

    # 8. device signal: one device marking several students in a session is flagged (not silently rejected)
    shared_device = False
    if device_hash:
        shared_device = (
            db.scalar(
                select(AttendanceRecord.id).where(
                    AttendanceRecord.session_id == s.id,
                    AttendanceRecord.device_id_hash == device_hash,
                    AttendanceRecord.student_id != student.id,
                )
            )
            is not None
        )

    # 9. one transaction: verification result + attempt + (attendance record)
    vr = VerificationResult(
        student_id=student.id,
        session_id=s.id,
        match_score=decision.score,
        threshold_used=s_cfg.face_match_threshold,
        liveness_passed=decision.liveness_passed,
        liveness_method=logic.LIVENESS_METHOD,
        decision=decision.decision,
        purge_after=logic.verification_purge_after(),
    )
    db.add(vr)
    attempt_no = used + 1
    accepted = decision.decision == "match"
    db.add(
        AttendanceAttempt(
            student_id=student.id,
            session_id=s.id,
            nonce_hash=nonce_hash,
            result="accepted" if accepted else "rejected",
            reason_code=None if accepted else decision.reason.value,
            attempt_no=attempt_no,
            device_id_hash=device_hash,
        )
    )
    db.flush()

    if accepted:
        rec = _record(
            db, student_id=student.id, session_id=s.id, status="present", verification_method="qr_face",
            face_verification_id=vr.id, device_id_hash=device_hash,
        )
        audit(db, "attendance.mark", student.id, rec.id, method="qr_face", shared_device=shared_device, request=request)
        if shared_device:
            audit(db, "anomaly.shared_device", student.id, s.id, request=request)
        db.commit()
        db.refresh(rec)
        return {"ok": True, "status": "present", "method": "qr_face", "marked_at": rec.marked_at.isoformat(),
                **_session_info(s)}

    # rejected
    can_retry = attempt_no < s_cfg.max_attempts_per_session
    retry = None
    if can_retry:
        nonce, challenge = _issue_challenge(db, s.id, student.id)
        retry = {"nonce": nonce, "challenge": challenge, "attempt_no": attempt_no + 1}
    reason = decision.reason if can_retry else Reason.RETRY_LIMIT
    db.commit()
    return {
        "ok": False,
        "reason": reason.value,
        "detail_reason": decision.reason.value,
        "message": MESSAGES[decision.reason] if can_retry else MESSAGES[Reason.RETRY_LIMIT],
        "attempt_no": attempt_no,
        "max_attempts": s_cfg.max_attempts_per_session,
        "retry": retry,
        "retry_after": s_cfg.attempt_cooldown_seconds,
        "can_request_manual": True,
        **_session_info(s),
    }


# ---------------------------------------------------------------- manual verification
def request_manual(db: Session, student: User, session_id: uuid.UUID, request: Request) -> dict:
    s = db.get(AttendanceSession, session_id)
    if s is None or s.status == "cancelled":
        raise AttendanceError(Reason.SESSION_INVALID)
    _check_member(db, s, student.id)
    _check_not_marked(db, s.id, student.id)
    last_reason = db.scalar(
        select(AttendanceAttempt.reason_code)
        .where(AttendanceAttempt.session_id == s.id, AttendanceAttempt.student_id == student.id)
        .order_by(AttendanceAttempt.created_at.desc())
        .limit(1)
    )
    _upsert_request(db, s.id, student.id, last_reason)
    audit(db, "exception.request", student.id, s.id, request=request)
    db.commit()
    return {"ok": True, "message": "Your request has been sent to the teacher."}
