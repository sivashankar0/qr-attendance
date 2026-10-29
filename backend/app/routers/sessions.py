"""Teacher endpoints: classes, sessions, rotating QR, live dashboard, exceptions, export."""

import csv
import io
import secrets
import time
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.db import get_db
from app.deps import get_owned_class, require_teacher
from app.models import (
    EXCEPTION_REASONS,
    AttendanceAttempt,
    AttendanceException,
    AttendanceRecord,
    AttendanceSession,
    AuditLog,
    Class,
    ClassMember,
    FaceVerificationOptOut,
    User,
    VerificationRequest,
)
from app.security import utcnow
from app.services import qr
from app.services.geo import LocationIn, validate_teacher_location
from app.reason_codes import AttendanceError
from app.services.attendance import session_state

router = APIRouter(tags=["teacher"])

# Category labels shown to teachers. Never scores, thresholds or liveness details.
REJECTION_CATEGORY = {
    "FACE_MISMATCH": "Face mismatch",
    "LIVENESS_FAILED": "Live check failed",
    "LOW_QUALITY": "Poor image quality",
    "FACE_NOT_DETECTED": "No face detected",
    "MULTIPLE_FACES": "Multiple faces",
}


class SessionCreate(BaseModel):
    class_id: uuid.UUID
    duration_minutes: int = Field(ge=1, le=240)
    face_required: bool = True
    # Teacher's current position; when given, students must be within geofence_radius_m of it.
    location: LocationIn | None = None
    geofence_radius_m: int | None = None


class ExceptionCreate(BaseModel):
    session_id: uuid.UUID
    student_id: uuid.UUID
    reason_category: str
    reason_note: str | None = Field(default=None, max_length=500)
    identity_confirmed: bool


def _owned_session(db: Session, session_id: uuid.UUID, teacher: User) -> AttendanceSession:
    s = db.get(AttendanceSession, session_id)
    if s is None or s.klass.teacher_id != teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return s


def _session_out(s: AttendanceSession) -> dict:
    return {
        "id": str(s.id),
        "class_id": str(s.class_id),
        "class_code": s.klass.code,
        "class_name": s.klass.name,
        "starts_at": s.starts_at.isoformat(),
        "expires_at": s.expires_at.isoformat(),
        "status": session_state(s),
        "face_required": s.face_required,
        "location_restricted": s.geofence_radius_m is not None,
        "geofence_radius_m": s.geofence_radius_m,
    }


@router.get("/teacher/classes")
def my_classes(teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Class, func.count(ClassMember.student_id))
        .outerjoin(ClassMember, ClassMember.class_id == Class.id)
        .where(Class.teacher_id == teacher.id)
        .group_by(Class.id)
        .order_by(Class.code)
    ).all()
    return [
        {"id": str(c.id), "code": c.code, "name": c.name, "term": c.term, "student_count": n} for c, n in rows
    ]


@router.get("/teacher/classes/{class_id}/sessions")
def class_sessions(class_id: uuid.UUID, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    klass = get_owned_class(db, class_id, teacher)
    sessions = db.scalars(
        select(AttendanceSession)
        .where(AttendanceSession.class_id == klass.id)
        .order_by(AttendanceSession.starts_at.desc())
        .limit(100)
    ).all()
    counts = dict(
        db.execute(
            select(AttendanceRecord.session_id, func.count())
            .where(AttendanceRecord.session_id.in_([s.id for s in sessions]))
            .group_by(AttendanceRecord.session_id)
        ).all()
    )
    return [{**_session_out(s), "present_count": counts.get(s.id, 0)} for s in sessions]


@router.post("/sessions", status_code=201)
def create_session(
    body: SessionCreate, request: Request, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)
):
    klass = get_owned_class(db, body.class_id, teacher)
    if body.duration_minutes > get_settings().max_session_minutes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Duration too long")
    open_existing = db.scalar(
        select(AttendanceSession).where(
            AttendanceSession.class_id == klass.id,
            AttendanceSession.status == "open",
            AttendanceSession.expires_at > func.now(),
        )
    )
    if open_existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This class already has an open session")
    radius = None
    if body.location is not None:
        cfg = get_settings()
        radius = body.geofence_radius_m or cfg.geofence_default_radius_m
        if not cfg.geofence_min_radius_m <= radius <= cfg.geofence_max_radius_m:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Radius must be {cfg.geofence_min_radius_m}-{cfg.geofence_max_radius_m} m",
            )
        try:
            validate_teacher_location(body.location)
        except AttendanceError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, e.body()["message"])
    elif body.geofence_radius_m is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your location is needed to restrict by location")
    now = utcnow()
    s = AttendanceSession(
        class_id=klass.id,
        created_by=teacher.id,
        starts_at=now,
        expires_at=now + timedelta(minutes=body.duration_minutes),
        status="open",
        face_required=body.face_required,
        qr_secret_ref=secrets.token_hex(16),
        location_lat=body.location.latitude if body.location else None,
        location_lon=body.location.longitude if body.location else None,
        location_accuracy_m=body.location.accuracy if body.location else None,
        geofence_radius_m=radius,
    )
    db.add(s)
    db.flush()
    audit(db, "session.create", teacher.id, s.id, face_required=body.face_required, geofence_radius_m=radius,
          request=request)
    db.commit()
    db.refresh(s)
    return _session_out(s)


@router.get("/sessions/{session_id}")
def get_session(session_id: uuid.UUID, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    return _session_out(_owned_session(db, session_id, teacher))


@router.get("/sessions/{session_id}/qr")
def session_qr(session_id: uuid.UUID, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    s = _owned_session(db, session_id, teacher)
    if session_state(s) != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "Session is not open")
    text, rotates_at = qr.build_qr(s.id, s.qr_secret_ref)
    now = time.time()
    return {
        "qr": text,
        "rotates_in": max(0.0, rotates_at - now),
        "rotation_seconds": get_settings().qr_rotation_seconds,
        "server_time": datetime.fromtimestamp(now).astimezone().isoformat(),
    }


@router.post("/sessions/{session_id}/close")
def close_session(
    session_id: uuid.UUID, request: Request, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)
):
    s = _owned_session(db, session_id, teacher)
    if s.status == "open":
        s.status = "closed"
        s.closed_at = utcnow()
        audit(db, "session.close", teacher.id, s.id, request=request)
        db.commit()
    return _session_out(s)


def _dashboard_rows(db: Session, s: AttendanceSession) -> list[dict]:
    members = db.execute(
        select(User)
        .join(ClassMember, ClassMember.student_id == User.id)
        .where(ClassMember.class_id == s.class_id)
        .order_by(User.college_id)
    ).scalars().all()
    records = {r.student_id: r for r in db.scalars(select(AttendanceRecord).where(AttendanceRecord.session_id == s.id))}
    exceptions = {
        e.id: e for e in db.scalars(select(AttendanceException).where(AttendanceException.session_id == s.id))
    }
    requests = {
        r.student_id: r
        for r in db.scalars(select(VerificationRequest).where(VerificationRequest.session_id == s.id))
    }
    opt_outs = set(db.scalars(select(FaceVerificationOptOut.student_id)).all())
    last_attempts: dict[uuid.UUID, AttendanceAttempt] = {}
    for a in db.scalars(
        select(AttendanceAttempt).where(AttendanceAttempt.session_id == s.id).order_by(AttendanceAttempt.created_at)
    ):
        last_attempts[a.student_id] = a
    location_failed = set(
        db.scalars(
            select(AuditLog.actor_id).where(AuditLog.action == "location.reject", AuditLog.target_id == s.id)
        ).all()
    )
    device_counts: dict[str, int] = {}
    for r in records.values():
        if r.device_id_hash:
            device_counts[r.device_id_hash] = device_counts.get(r.device_id_hash, 0) + 1

    rows = []
    for u in members:
        rec = records.get(u.id)
        req = requests.get(u.id)
        last = last_attempts.get(u.id)
        if rec is not None and rec.status == "present":
            status_, method = "present", "QR + Face" if rec.verification_method == "qr_face" else "QR only"
        elif rec is not None:
            exc = exceptions.get(rec.exception_id)
            status_ = "present_exception"
            method = f"Manual – {exc.reason_category.replace('_', ' ')}" if exc else "Manual"
        elif last is not None and last.result == "rejected":
            status_, method = "rejected", REJECTION_CATEGORY.get(last.reason_code or "", "Verification failed")
        else:
            status_, method = "pending", None
        rows.append(
            {
                "student_id": str(u.id),
                "college_id": u.college_id,
                "full_name": u.full_name,
                "status": status_,
                "method": method,
                "marked_at": rec.marked_at.isoformat() if rec else None,
                "alternative_method": u.id in opt_outs,
                "verification_requested": req is not None and req.status == "pending" and rec is None,
                "shared_device": bool(rec and rec.device_id_hash and device_counts.get(rec.device_id_hash, 0) > 1),
                "location_failed": u.id in location_failed and rec is None,
            }
        )
    return rows


@router.get("/sessions/{session_id}/attendance")
def session_dashboard(session_id: uuid.UUID, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)):
    s = _owned_session(db, session_id, teacher)
    rows = _dashboard_rows(db, s)
    counts = {k: sum(1 for r in rows if r["status"] == k) for k in ("present", "present_exception", "pending", "rejected")}
    return {
        "session": _session_out(s),
        "counts": {
            "total": len(rows),
            "present": counts["present"] + counts["present_exception"],
            "face_verified": sum(1 for r in rows if r["method"] == "QR + Face"),
            "exceptions": counts["present_exception"],
            "pending": counts["pending"],
            "rejected": counts["rejected"],
            "requests": sum(1 for r in rows if r["verification_requested"]),
        },
        "students": rows,
    }


@router.get("/sessions/{session_id}/export.csv")
def export_csv(
    session_id: uuid.UUID, request: Request, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)
):
    s = _owned_session(db, session_id, teacher)
    rows = _dashboard_rows(db, s)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["class_code", "session_start", "roll_no", "name", "status", "method", "marked_at"])
    for r in rows:
        # Prevent CSV/formula injection when opened in spreadsheet tools.
        safe = [("'" + str(v)) if str(v)[:1] in ("=", "+", "-", "@") else v for v in
                (s.klass.code, s.starts_at.isoformat(), r["college_id"], r["full_name"], r["status"], r["method"] or "",
                 r["marked_at"] or "")]
        w.writerow(safe)
    audit(db, "attendance.export", teacher.id, s.id, request=request)
    db.commit()
    filename = f"attendance_{s.klass.code}_{s.starts_at:%Y%m%d_%H%M}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/attendance/exceptions", status_code=201)
def create_exception(
    body: ExceptionCreate, request: Request, teacher: User = Depends(require_teacher), db: Session = Depends(get_db)
):
    if body.reason_category not in EXCEPTION_REASONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid reason category")
    if not body.identity_confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You must confirm the student's identity in person")
    s = _owned_session(db, body.session_id, teacher)
    if s.status == "cancelled":
        raise HTTPException(status.HTTP_409_CONFLICT, "Session was cancelled")
    if db.get(ClassMember, (s.class_id, body.student_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not in this class")

    exc = AttendanceException(
        student_id=body.student_id,
        session_id=s.id,
        approved_by=teacher.id,
        reason_category=body.reason_category,
        reason_note=(body.reason_note or "").strip() or None,
    )
    db.add(exc)
    db.flush()
    db.add(
        AttendanceRecord(
            student_id=body.student_id,
            session_id=s.id,
            status="present_exception",
            verification_method="manual_exception",
            exception_id=exc.id,
        )
    )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Attendance is already recorded for this student")
    req = db.scalar(
        select(VerificationRequest).where(
            VerificationRequest.session_id == s.id, VerificationRequest.student_id == body.student_id
        )
    )
    if req is not None:
        req.status, req.resolved_by, req.resolved_at = "approved", teacher.id, utcnow()
    audit(db, "exception.approve", teacher.id, body.student_id, session_id=str(s.id),
          reason=body.reason_category, request=request)
    db.commit()
    return {"ok": True, "exception_id": str(exc.id)}


@router.post("/sessions/{session_id}/requests/{student_id}/dismiss")
def dismiss_request(
    session_id: uuid.UUID,
    student_id: uuid.UUID,
    request: Request,
    teacher: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    s = _owned_session(db, session_id, teacher)
    req = db.scalar(
        select(VerificationRequest).where(
            VerificationRequest.session_id == s.id, VerificationRequest.student_id == student_id
        )
    )
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    req.status, req.resolved_by, req.resolved_at = "dismissed", teacher.id, utcnow()
    audit(db, "exception.dismiss", teacher.id, student_id, session_id=str(s.id), request=request)
    db.commit()
    return {"ok": True}
