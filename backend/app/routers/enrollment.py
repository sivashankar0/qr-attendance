"""Face enrollment, consent, status and deletion (student self-service)."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.audit import audit
from app.consent import CONSENT_NOTICE, CONSENT_VERSION
from app.db import get_db
from app.deps import require_student
from app.models import ConsentRecord, FaceTemplate, FaceVerificationOptOut, User
from app.ratelimit import limiter, user_or_ip
from app.reason_codes import AttendanceError
from app.routers.attendance import decode_frames
from app.security import utcnow
from app.services.face import logic
from app.services.face.verifier import get_verifier

router = APIRouter(prefix="/face", tags=["enrollment"])


class ConsentIn(BaseModel, extra="forbid"):
    consent_version: str
    accepted: bool


class EnrollIn(BaseModel, extra="forbid"):
    front: list[str] = Field(min_length=1, max_length=3)
    left: list[str] = Field(min_length=1, max_length=3)
    right: list[str] = Field(min_length=1, max_length=3)


def _active_consent(db: Session, student_id) -> ConsentRecord | None:
    return db.scalar(
        select(ConsentRecord)
        .where(
            ConsentRecord.student_id == student_id,
            ConsentRecord.withdrawn_at.is_(None),
            ConsentRecord.consent_version == CONSENT_VERSION,
        )
        .order_by(ConsentRecord.granted_at.desc())
    )


@router.get("/consent-notice")
def consent_notice():
    return CONSENT_NOTICE


@router.get("/enrollment/status")
def enrollment_status(student: User = Depends(require_student), db: Session = Depends(get_db)):
    tpl = db.scalar(select(FaceTemplate).where(FaceTemplate.student_id == student.id))
    history = db.scalars(
        select(ConsentRecord).where(ConsentRecord.student_id == student.id).order_by(ConsentRecord.granted_at.desc())
    ).all()
    return {
        "identity_verified": student.identity_verified_at is not None,
        "consent_active": _active_consent(db, student.id) is not None,
        "current_consent_version": CONSENT_VERSION,
        "template_status": tpl.status if tpl else "not_enrolled",
        "enrolled_at": tpl.enrolled_at.isoformat() if tpl else None,
        "alternative_method": db.get(FaceVerificationOptOut, student.id) is not None,
        "consent_history": [
            {
                "version": c.consent_version,
                "granted_at": c.granted_at.isoformat(),
                "withdrawn_at": c.withdrawn_at.isoformat() if c.withdrawn_at else None,
            }
            for c in history
        ],
    }


@router.post("/enrollment/consent", status_code=201)
def give_consent(
    body: ConsentIn, request: Request, student: User = Depends(require_student), db: Session = Depends(get_db)
):
    if not body.accepted:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Consent must be explicitly accepted")
    if body.consent_version != CONSENT_VERSION:
        raise HTTPException(status.HTTP_409_CONFLICT, "The consent notice has changed. Please read it again.")
    if _active_consent(db, student.id) is None:
        db.add(ConsentRecord(student_id=student.id, consent_version=CONSENT_VERSION))
        audit(db, "consent.grant", student.id, student.id, version=CONSENT_VERSION, request=request)
        db.commit()
    return {"ok": True}


@router.post("/enrollment", status_code=201)
@limiter.limit("6/hour", key_func=user_or_ip)
def enroll(request: Request, body: EnrollIn, student: User = Depends(require_student), db: Session = Depends(get_db)):
    # An unverified account must never enrol a face: an impostor could bind their face to someone else's ID.
    if student.identity_verified_at is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your identity has not been verified by the college yet. Visit the office with your college ID.",
        )
    if _active_consent(db, student.id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Consent is required before enrollment")

    verifier = get_verifier()
    try:
        result = logic.build_template(
            verifier, decode_frames(body.front), decode_frames(body.left), decode_frames(body.right)
        )
    except AttendanceError as e:
        audit(db, "enrollment.rejected", student.id, student.id, reason=e.reason.value, request=request)
        db.commit()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, e.body())
    # Raw images are only in memory for this request and are never written anywhere.
    logic.store_template(db, student.id, result, verifier, actor_id=student.id)
    db.commit()
    return {"ok": True, "status": result.status}


@router.delete("/enrollment")
def withdraw_and_delete(request: Request, student: User = Depends(require_student), db: Session = Depends(get_db)):
    deleted = logic.delete_template(db, student.id, actor_id=student.id, reason="consent_withdrawn")
    db.execute(
        update(ConsentRecord)
        .where(ConsentRecord.student_id == student.id, ConsentRecord.withdrawn_at.is_(None))
        .values(withdrawn_at=utcnow())
    )
    audit(db, "consent.withdraw", student.id, student.id, template_deleted=deleted, request=request)
    db.commit()
    return {"ok": True, "template_deleted": deleted}
