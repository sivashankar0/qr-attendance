"""Retention / deletion job (roadmap Section 11.2).

- verification_results past purge_after  -> deleted
- face templates of inactive users / past delete_after -> deleted
- used/expired challenges older than 1 day, revoked/expired refresh tokens older than 30 days -> deleted

Run periodically: `python -m app.jobs.retention` (cron / scheduler), or via the admin endpoint.
"""

from datetime import timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.db import SessionLocal
from app.models import AttendanceChallenge, AttendanceRecord, FaceTemplate, RefreshToken, User, VerificationResult
from app.security import utcnow


def run_retention(db: Session, actor_id=None) -> dict:
    now = utcnow()
    s = get_settings()

    expired_vr = select(VerificationResult.id).where(VerificationResult.purge_after <= now)
    # Attendance records keep their status; only the biometric link is removed.
    db.execute(
        update(AttendanceRecord)
        .where(AttendanceRecord.face_verification_id.in_(expired_vr))
        .values(face_verification_id=None)
    )
    vr = db.execute(delete(VerificationResult).where(VerificationResult.purge_after <= now)).rowcount

    # Schedule deletion for templates of deactivated users, then delete those past their deadline.
    db.execute(
        update(FaceTemplate)
        .where(
            FaceTemplate.delete_after.is_(None),
            FaceTemplate.student_id.in_(select(User.id).where(User.is_active.is_(False))),
        )
        .values(delete_after=now + timedelta(days=s.template_retention_days_after_inactive))
    )
    tpl = db.execute(
        delete(FaceTemplate).where(or_(FaceTemplate.delete_after <= now, FaceTemplate.status == "deleted"))
    ).rowcount

    ch = db.execute(
        delete(AttendanceChallenge).where(AttendanceChallenge.expires_at <= now - timedelta(days=1))
    ).rowcount
    rt = db.execute(delete(RefreshToken).where(RefreshToken.expires_at <= now - timedelta(days=30))).rowcount

    result = {"verification_results": vr, "templates": tpl, "challenges": ch, "refresh_tokens": rt}
    audit(db, "retention.run", actor_id, None, **result)
    db.commit()
    return result


if __name__ == "__main__":
    with SessionLocal() as session:
        print(run_retention(session))
