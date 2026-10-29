"""Admin and biometric-officer tools. Admins never see templates, images or match scores."""

import csv
import io
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import audit
from app.db import get_db
from app.deps import require_admin, require_staff_admin
from app.jobs.retention import run_retention
from app.models import (
    EXCEPTION_REASONS,
    ROLES,
    AttendanceRecord,
    AttendanceSession,
    AuditLog,
    Class,
    ClassMember,
    FaceTemplate,
    FaceVerificationOptOut,
    User,
)
from app.routers.auth import user_out
from app.security import hash_password, utcnow
from app.services.face import logic

router = APIRouter(prefix="/admin", tags=["admin"])


class UserCreate(BaseModel):
    role: str
    college_id: str = Field(min_length=1, max_length=64)
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    is_active: bool | None = None
    identity_verified: bool | None = None
    new_password: str | None = Field(default=None, min_length=10, max_length=256)


class ImportIn(BaseModel):
    csv_text: str = Field(max_length=2_000_000)


class ClassCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=200)
    term: str = Field(min_length=1, max_length=32)
    teacher_id: uuid.UUID


class MembersIn(BaseModel):
    college_ids: list[str] = Field(min_length=1, max_length=1000)


class ReviewIn(BaseModel):
    decision: str  # approve | reject


class OptOutIn(BaseModel):
    student_id: uuid.UUID
    reason_category: str


def _admin_user_out(u: User) -> dict:
    return {**user_out(u), "is_active": u.is_active, "created_at": u.created_at.isoformat()}


def _new_user(db: Session, body: UserCreate) -> User:
    if body.role not in ROLES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid role {body.role}")
    u = User(
        role=body.role,
        college_id=body.college_id.strip(),
        full_name=body.full_name.strip(),
        email=body.email.lower(),
        password_hash=hash_password(body.password),
    )
    db.add(u)
    return u


# ---------------- users ----------------
@router.get("/users")
def list_users(
    role: str | None = None,
    q: str | None = Query(default=None, max_length=100),
    _: User = Depends(require_staff_admin),
    db: Session = Depends(get_db),
):
    stmt = select(User).order_by(User.role, User.college_id).limit(500)
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(User.full_name.ilike(like), User.college_id.ilike(like), User.email.ilike(like)))
    return [_admin_user_out(u) for u in db.scalars(stmt)]


@router.post("/users", status_code=201)
def create_user(body: UserCreate, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    u = _new_user(db, body)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "College ID or email already exists")
    audit(db, "user.create", admin.id, u.id, role=u.role, request=request)
    db.commit()
    return _admin_user_out(u)


@router.post("/users/import")
def import_users(body: ImportIn, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """CSV header: role,college_id,full_name,email,password"""
    reader = csv.DictReader(io.StringIO(body.csv_text.strip()))
    required = {"role", "college_id", "full_name", "email", "password"}
    if not reader.fieldnames or not required.issubset({f.strip() for f in reader.fieldnames}):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"CSV header must contain: {', '.join(sorted(required))}")
    created, errors = 0, []
    for i, row in enumerate(reader, start=2):
        try:
            data = UserCreate(**{k.strip(): (v or "").strip() for k, v in row.items() if k})
            with db.begin_nested():
                _new_user(db, data)
            created += 1
        except IntegrityError:
            errors.append({"line": i, "error": "duplicate college_id or email"})
        except (ValueError, HTTPException) as e:
            errors.append({"line": i, "error": str(getattr(e, "detail", e))[:200]})
    audit(db, "user.import", admin.id, None, created=created, failed=len(errors), request=request)
    db.commit()
    return {"created": created, "errors": errors}


@router.patch("/users/{user_id}")
def update_user(
    user_id: uuid.UUID, body: UserUpdate, request: Request, admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    changes = {}
    if body.full_name is not None:
        u.full_name = body.full_name.strip()
        changes["full_name"] = True
    if body.is_active is not None:
        if u.id == admin.id and not body.is_active:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate yourself")
        u.is_active = body.is_active
        changes["is_active"] = body.is_active
    if body.identity_verified is not None:
        u.identity_verified_at = utcnow() if body.identity_verified else None
        changes["identity_verified"] = body.identity_verified
    if body.new_password:
        u.password_hash = hash_password(body.new_password)
        u.failed_logins, u.locked_until = 0, None
        changes["password_reset"] = True
    audit(db, "user.update", admin.id, u.id, request=request, **changes)
    db.commit()
    return _admin_user_out(u)


# ---------------- classes ----------------
@router.get("/classes")
def list_classes(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.execute(
        select(Class, User.full_name, func.count(ClassMember.student_id))
        .join(User, User.id == Class.teacher_id)
        .outerjoin(ClassMember, ClassMember.class_id == Class.id)
        .group_by(Class.id, User.full_name)
        .order_by(Class.term.desc(), Class.code)
    ).all()
    return [
        {"id": str(c.id), "code": c.code, "name": c.name, "term": c.term, "teacher_id": str(c.teacher_id),
         "teacher_name": t, "student_count": n}
        for c, t, n in rows
    ]


@router.post("/classes", status_code=201)
def create_class(body: ClassCreate, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    teacher = db.get(User, body.teacher_id)
    if teacher is None or teacher.role != "teacher":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "teacher_id must be a teacher")
    c = Class(code=body.code.strip().upper(), name=body.name.strip(), term=body.term.strip(), teacher_id=teacher.id)
    db.add(c)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Class code already exists for this term")
    audit(db, "class.create", admin.id, c.id, request=request)
    db.commit()
    return {"id": str(c.id), "code": c.code, "name": c.name, "term": c.term}


@router.get("/classes/{class_id}/members")
def class_members(class_id: uuid.UUID, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.scalars(
        select(User).join(ClassMember, ClassMember.student_id == User.id)
        .where(ClassMember.class_id == class_id).order_by(User.college_id)
    ).all()
    return [_admin_user_out(u) for u in users]


@router.post("/classes/{class_id}/members")
def add_members(
    class_id: uuid.UUID, body: MembersIn, request: Request, admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.get(Class, class_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Class not found")
    ids = [c.strip() for c in body.college_ids if c.strip()]
    students = db.scalars(select(User).where(User.college_id.in_(ids), User.role == "student")).all()
    found = {s.college_id for s in students}
    existing = set(db.scalars(select(ClassMember.student_id).where(ClassMember.class_id == class_id)).all())
    added = 0
    for s in students:
        if s.id not in existing:
            db.add(ClassMember(class_id=class_id, student_id=s.id))
            added += 1
    audit(db, "class.members_add", admin.id, class_id, added=added, request=request)
    db.commit()
    return {"added": added, "not_found": sorted(set(ids) - found)}


@router.delete("/classes/{class_id}/members/{student_id}")
def remove_member(
    class_id: uuid.UUID, student_id: uuid.UUID, request: Request, admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    m = db.get(ClassMember, (class_id, student_id))
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member")
    db.delete(m)
    audit(db, "class.member_remove", admin.id, class_id, student_id=str(student_id), request=request)
    db.commit()
    return {"ok": True}


# ---------------- enrollments (biometric officer / admin) ----------------
@router.get("/enrollments")
def list_enrollments(
    status_filter: str | None = Query(default=None, alias="status"),
    _: User = Depends(require_staff_admin),
    db: Session = Depends(get_db),
):
    # Metadata only. Ciphertext is never selected here.
    stmt = (
        select(FaceTemplate.student_id, FaceTemplate.status, FaceTemplate.enrolled_at, FaceTemplate.model_name,
               FaceTemplate.model_version, FaceTemplate.quality_score, User.college_id, User.full_name)
        .join(User, User.id == FaceTemplate.student_id)
        .order_by(FaceTemplate.enrolled_at.desc())
        .limit(500)
    )
    if status_filter:
        stmt = stmt.where(FaceTemplate.status == status_filter)
    return [
        {"student_id": str(r.student_id), "college_id": r.college_id, "full_name": r.full_name, "status": r.status,
         "enrolled_at": r.enrolled_at.isoformat(), "model": f"{r.model_name}/{r.model_version}",
         "quality_score": r.quality_score}
        for r in db.execute(stmt)
    ]


@router.post("/enrollments/{student_id}/review")
def review_enrollment(
    student_id: uuid.UUID, body: ReviewIn, request: Request, officer: User = Depends(require_staff_admin),
    db: Session = Depends(get_db),
):
    tpl = db.scalar(select(FaceTemplate).where(FaceTemplate.student_id == student_id))
    if tpl is None or tpl.status != "pending_review":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No enrollment pending review")
    if body.decision == "approve":
        tpl.status = "active"
    elif body.decision == "reject":
        logic.delete_template(db, student_id, officer.id, reason="review_rejected")
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "decision must be approve or reject")
    audit(db, "enrollment.review", officer.id, student_id, decision=body.decision, request=request)
    db.commit()
    return {"ok": True}


@router.delete("/enrollments/{student_id}")
def delete_enrollment(
    student_id: uuid.UUID, request: Request, officer: User = Depends(require_staff_admin), db: Session = Depends(get_db)
):
    if not logic.delete_template(db, student_id, officer.id, reason="officer_request"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No template for this student")
    db.commit()
    return {"ok": True}


# ---------------- opt-outs ----------------
@router.get("/opt-outs")
def list_opt_outs(_: User = Depends(require_staff_admin), db: Session = Depends(get_db)):
    rows = db.execute(
        select(FaceVerificationOptOut, User).join(User, User.id == FaceVerificationOptOut.student_id)
        .order_by(FaceVerificationOptOut.created_at.desc())
    ).all()
    return [
        {"student_id": str(o.student_id), "college_id": u.college_id, "full_name": u.full_name,
         "reason_category": o.reason_category, "created_at": o.created_at.isoformat()}
        for o, u in rows
    ]


@router.post("/opt-outs", status_code=201)
def create_opt_out(
    body: OptOutIn, request: Request, officer: User = Depends(require_staff_admin), db: Session = Depends(get_db)
):
    if body.reason_category not in EXCEPTION_REASONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid reason category")
    student = db.get(User, body.student_id)
    if student is None or student.role != "student":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Student not found")
    if db.get(FaceVerificationOptOut, student.id) is None:
        db.add(FaceVerificationOptOut(student_id=student.id, reason_category=body.reason_category,
                                      approved_by=officer.id))
        audit(db, "optout.create", officer.id, student.id, request=request)
        db.commit()
    return {"ok": True}


@router.delete("/opt-outs/{student_id}")
def delete_opt_out(
    student_id: uuid.UUID, request: Request, officer: User = Depends(require_staff_admin), db: Session = Depends(get_db)
):
    o = db.get(FaceVerificationOptOut, student_id)
    if o is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No opt-out for this student")
    db.delete(o)
    audit(db, "optout.delete", officer.id, student_id, request=request)
    db.commit()
    return {"ok": True}


# ---------------- reports ----------------
@router.get("/reports/exceptions")
def exception_report(days: int = Query(default=30, ge=1, le=365), _: User = Depends(require_admin),
                     db: Session = Depends(get_db)):
    """Exception rate per teacher/class; high rates are flagged for review (roadmap 9.5)."""
    since = utcnow() - timedelta(days=days)
    rows = db.execute(
        select(
            Class.code, Class.name, User.full_name,
            func.count(AttendanceRecord.id),
            func.count(AttendanceRecord.id).filter(AttendanceRecord.verification_method == "manual_exception"),
        )
        .join(AttendanceSession, AttendanceSession.class_id == Class.id)
        .join(AttendanceRecord, AttendanceRecord.session_id == AttendanceSession.id)
        .join(User, User.id == Class.teacher_id)
        .where(AttendanceSession.starts_at >= since)
        .group_by(Class.id, User.full_name)
        .order_by(Class.code)
    ).all()
    out = []
    for code, name, teacher, total, exc in rows:
        rate = exc / total if total else 0.0
        out.append({"class_code": code, "class_name": name, "teacher": teacher, "records": total,
                    "exceptions": exc, "exception_rate": round(rate, 3), "flagged": total >= 10 and rate > 0.15})
    return out


@router.get("/audit")
def audit_log(
    action: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=200, ge=1, le=1000),
    _: User = Depends(require_staff_admin),
    db: Session = Depends(get_db),
):
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    return [
        {"id": a.id, "actor_id": str(a.actor_id) if a.actor_id else None, "action": a.action,
         "target_id": str(a.target_id) if a.target_id else None, "ip": str(a.ip_address) if a.ip_address else None,
         "details": a.details, "created_at": a.created_at.isoformat()}
        for a in db.scalars(stmt)
    ]


@router.post("/retention/run")
def retention_run(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return run_retention(db, actor_id=admin.id)
