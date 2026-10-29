"""Student attendance endpoints."""

import base64
import binascii
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_student
from app.models import AttendanceRecord, AttendanceSession, Class, ClassMember, User
from app.ratelimit import limiter, user_or_ip
from app.security import hash_device_id
from app.services import attendance as svc
from app.services.geo import LocationIn
from app.services.face.verifier import get_verifier

router = APIRouter(prefix="/attendance", tags=["student"])

# Any client-sent "face_verified"/"student_id" fields are simply not part of these schemas,
# and extra fields are rejected outright.


class StartIn(BaseModel, extra="forbid"):
    qr: str = Field(min_length=10, max_length=200)
    location: LocationIn | None = None  # required when the session is location-restricted


class VerifyIn(BaseModel, extra="forbid"):
    nonce: str = Field(min_length=10, max_length=200)
    front_frames: list[str] = Field(min_length=1, max_length=3)
    challenge_frames: list[str] = Field(min_length=1, max_length=4)


class ManualRequestIn(BaseModel, extra="forbid"):
    session_id: uuid.UUID


def decode_frames(frames: list[str]) -> list[bytes]:
    limit = get_settings().max_image_bytes
    out = []
    for f in frames:
        if "," in f[:64]:  # tolerate data URLs
            f = f.split(",", 1)[1]
        if len(f) > limit * 4 // 3 + 4:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Image too large")
        try:
            out.append(base64.b64decode(f, validate=True))
        except (binascii.Error, ValueError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid image encoding")
    return out


def _device(request: Request) -> str | None:
    return hash_device_id(request.headers.get("x-device-id"))


@router.post("/start")
@limiter.limit("20/minute", key_func=user_or_ip)
def start(request: Request, body: StartIn, student: User = Depends(require_student), db: Session = Depends(get_db)):
    return svc.start(db, student, body.qr, _device(request), request, body.location)


@router.post("/verify")
@limiter.limit("10/minute", key_func=user_or_ip)
def verify(request: Request, body: VerifyIn, student: User = Depends(require_student), db: Session = Depends(get_db)):
    data = svc.VerifyInput(
        nonce=body.nonce,
        front_frames=decode_frames(body.front_frames),
        challenge_frames=decode_frames(body.challenge_frames),
    )
    return svc.verify(db, student, data, get_verifier(), _device(request), request)


@router.post("/requests")
@limiter.limit("10/minute", key_func=user_or_ip)
def request_manual(
    request: Request, body: ManualRequestIn, student: User = Depends(require_student), db: Session = Depends(get_db)
):
    return svc.request_manual(db, student, body.session_id, request)


@router.get("/me")
def my_attendance(student: User = Depends(require_student), db: Session = Depends(get_db)):
    """Own history only. Includes every session of the student's classes (present or absent)."""
    rows = db.execute(
        select(AttendanceSession, Class, AttendanceRecord)
        .join(Class, Class.id == AttendanceSession.class_id)
        .join(ClassMember, (ClassMember.class_id == Class.id) & (ClassMember.student_id == student.id))
        .outerjoin(
            AttendanceRecord,
            (AttendanceRecord.session_id == AttendanceSession.id) & (AttendanceRecord.student_id == student.id),
        )
        .where(AttendanceSession.status != "cancelled")
        .order_by(AttendanceSession.starts_at.desc())
        .limit(200)
    ).all()
    method_label = {"qr_face": "QR + Face", "qr_only": "QR", "manual_exception": "Teacher verified"}
    history = []
    for s, c, rec in rows:
        state = svc.session_state(s)
        if rec is not None:
            status_ = rec.status
        elif state == "open":
            status_ = "open"
        else:
            status_ = "absent"
        history.append(
            {
                "session_id": str(s.id),
                "class_code": c.code,
                "class_name": c.name,
                "starts_at": s.starts_at.isoformat(),
                "status": status_,
                "method": method_label.get(rec.verification_method) if rec else None,
                "marked_at": rec.marked_at.isoformat() if rec else None,
            }
        )

    summary = db.execute(
        select(
            Class.code,
            Class.name,
            func.count(AttendanceSession.id),
            func.count(AttendanceRecord.id),
            func.coalesce(func.sum(AttendanceSession.weight), 0),
            func.coalesce(func.sum(AttendanceSession.weight).filter(AttendanceRecord.id.is_not(None)), 0),
        )
        .join(ClassMember, (ClassMember.class_id == Class.id) & (ClassMember.student_id == student.id))
        .outerjoin(
            AttendanceSession, (AttendanceSession.class_id == Class.id) & (AttendanceSession.status != "cancelled")
        )
        .outerjoin(
            AttendanceRecord,
            (AttendanceRecord.session_id == AttendanceSession.id) & (AttendanceRecord.student_id == student.id),
        )
        .group_by(Class.id)
        .order_by(Class.code)
    ).all()
    all_w = sum(float(r[4]) for r in summary)
    got_w = sum(float(r[5]) for r in summary)
    return {
        "history": history,
        "classes": [
            {"class_code": code, "class_name": name, "sessions": total, "attended": attended,
             "weighted_percent": round(float(gw) / float(tw) * 100, 1) if tw else None}
            for code, name, total, attended, tw, gw in summary
        ],
        "overall_weighted_percent": round(got_w / all_w * 100, 1) if all_w else None,
    }
