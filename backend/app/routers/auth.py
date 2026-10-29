"""Auth for the mobile app: short-lived JWT access token + rotating opaque refresh token.

Tokens are returned in the response body; the app stores them in the Android Keystore-backed
SecureStore and sends `Authorization: Bearer <access>`.
"""

import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import (
    AttendanceRecord,
    AttendanceSession,
    Class,
    ClassMember,
    FaceChangeRequest,
    FaceTemplate,
    RefreshToken,
    User,
)
from app.services.face.logic import face_change_info
from app.ratelimit import limiter
from app.security import (
    create_access_token,
    hash_password,
    new_opaque_token,
    sha256_hex,
    utcnow,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15
GENERIC_LOGIN_ERROR = "Invalid credentials"


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=320, description="College ID or email")
    password: str = Field(min_length=1, max_length=256)
    # User type picked on the landing screen. "admin" also covers biometric officers.
    role: Literal["student", "teacher", "admin"] | None = None


class RegisterIn(BaseModel, extra="forbid"):
    role: Literal["student", "teacher"]  # admin accounts are never self-registered
    college_id: str = Field(min_length=2, max_length=64)
    full_name: str = Field(min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)


class ForgotIn(BaseModel, extra="forbid"):
    username: str = Field(min_length=1, max_length=320)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


def user_out(u: User) -> dict:
    return {
        "id": str(u.id),
        "role": u.role,
        "college_id": u.college_id,
        "full_name": u.full_name,
        "email": u.email,
        "identity_verified": u.identity_verified_at is not None,
    }


def _issue_refresh(db: Session, user: User, family_id: uuid.UUID | None = None) -> str:
    token = new_opaque_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=sha256_hex(token),
            family_id=family_id or uuid.uuid4(),
            expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days),
        )
    )
    return token


def _token_response(user: User, refresh_token: str) -> dict:
    return {
        "access_token": create_access_token(user.id, user.role),
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": get_settings().access_token_minutes * 60,
        "user": user_out(user),
    }


def _revoke_family(db: Session, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, body: LoginIn, db: Session = Depends(get_db)):
    username = body.username.strip()
    user = db.scalar(
        select(User).where(
            (User.college_id == username) | (User.college_id == username.upper()) | (User.email == username.lower())
        )
    )
    now = utcnow()

    if user is not None and user.locked_until and user.locked_until > now:
        verify_password(None, body.password)  # equalise timing
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)

    ok = verify_password(user.password_hash if user else None, body.password)
    if ok and user is not None and user.signup_status in ("pending", "rejected"):
        # Only revealed to someone who knows the password.
        msg = (
            "Your sign-up is waiting for admin approval."
            if user.signup_status == "pending"
            else "Your sign-up was not approved. Contact the college office."
        )
        raise HTTPException(status.HTTP_403_FORBIDDEN, msg)
    wrong_type = (
        ok and user is not None and body.role is not None
        and not (user.role == body.role or (body.role == "admin" and user.role == "biometric_officer"))
    )
    if wrong_type:
        # Same generic error: no tokens and no hint about which user type the account has.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)
    if not ok or user is None or not user.is_active:
        if user is not None:
            user.failed_logins += 1
            if user.failed_logins >= MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_logins = 0
                audit(db, "auth.lockout", user.id, user.id, request=request)
            db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)

    user.failed_logins = 0
    user.locked_until = None
    refresh_token = _issue_refresh(db, user)
    audit(db, "auth.login", user.id, user.id, request=request)
    db.commit()
    return _token_response(user, refresh_token)


@router.post("/register", status_code=201)
@limiter.limit("5/hour")
def register(request: Request, body: RegisterIn, db: Session = Depends(get_db)):
    """Self sign-up for students and teachers. The account stays locked until an admin approves it."""
    user = User(
        role=body.role,
        college_id=body.college_id.strip().upper(),
        full_name=body.full_name.strip(),
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        is_active=False,
        signup_status="pending",
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "An account with this college ID or email already exists. Sign in, or contact the college office.",
        )
    audit(db, "signup.request", user.id, user.id, role=body.role, request=request)
    db.commit()
    return {"ok": True, "message": "Sign-up submitted. You can sign in after an administrator approves it."}


@router.post("/forgot-password")
@limiter.limit("5/hour")
def forgot_password(request: Request, body: ForgotIn, db: Session = Depends(get_db)):
    """Flags the account for an admin password reset. Same response whether or not the account exists."""
    username = body.username.strip()
    user = db.scalar(select(User).where((User.college_id == username.upper()) | (User.email == username.lower())))
    if user is not None and user.is_active:
        user.password_reset_requested_at = utcnow()
        audit(db, "auth.reset_request", user.id, user.id, request=request)
        db.commit()
    return {"ok": True, "message": "If the account exists, the college office has been notified. "
                                   "An administrator will reset your password and give you a new one."}


@router.get("/profile")
def profile(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Role-specific profile of the signed-in user only."""
    out: dict = {"user": user_out(user), "member_since": user.created_at.isoformat()}
    if user.role == "student":
        classes = db.execute(
            select(Class, User.full_name)
            .join(ClassMember, (ClassMember.class_id == Class.id) & (ClassMember.student_id == user.id))
            .join(User, User.id == Class.teacher_id)
            .order_by(Class.code)
        ).all()
        tpl = db.scalar(select(FaceTemplate.status).where(FaceTemplate.student_id == user.id))
        pending = db.scalar(
            select(FaceChangeRequest.id).where(
                FaceChangeRequest.student_id == user.id, FaceChangeRequest.status == "pending"
            )
        )
        totals = db.execute(
            select(func.coalesce(func.sum(AttendanceSession.weight), 0), func.count(AttendanceSession.id))
            .join(ClassMember,
                  (ClassMember.class_id == AttendanceSession.class_id) & (ClassMember.student_id == user.id))
            .where(AttendanceSession.status != "cancelled")
        ).one()
        attended = db.execute(
            select(func.coalesce(func.sum(AttendanceSession.weight), 0), func.count(AttendanceRecord.id))
            .join(AttendanceRecord, AttendanceRecord.session_id == AttendanceSession.id)
            .where(AttendanceRecord.student_id == user.id, AttendanceSession.status != "cancelled")
        ).one()
        out["student"] = {
            "classes": [{"code": c.code, "name": c.name, "term": c.term, "teacher": t} for c, t in classes],
            "face": {"template_status": tpl or "not_enrolled", "change_request_pending": pending is not None,
                     **face_change_info(user)},
            "attendance": {
                "sessions": totals[1],
                "attended": attended[1],
                "weighted_percent": round(float(attended[0]) / float(totals[0]) * 100, 1) if totals[0] else None,
            },
        }
    elif user.role == "teacher":
        classes = db.scalars(select(Class).where(Class.teacher_id == user.id).order_by(Class.code)).all()
        sessions = db.scalar(
            select(func.count(AttendanceSession.id)).where(AttendanceSession.class_id.in_([c.id for c in classes]))
        ) if classes else 0
        out["teacher"] = {"classes": [{"code": c.code, "name": c.name, "term": c.term} for c in classes],
                          "sessions_run": sessions}
    else:
        out["staff"] = {
            "pending_signups": db.scalar(select(func.count(User.id)).where(User.signup_status == "pending")),
            "pending_face_changes": db.scalar(
                select(func.count(FaceChangeRequest.id)).where(FaceChangeRequest.status == "pending")
            ),
            "password_reset_requests": db.scalar(
                select(func.count(User.id)).where(User.password_reset_requested_at.is_not(None))
            ),
        }
    return out


@router.post("/refresh")
@limiter.limit("30/minute")
def refresh(request: Request, body: RefreshIn, db: Session = Depends(get_db)):
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256_hex(body.refresh_token)))
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if row.revoked_at is not None:
        # Reuse of an already-rotated token = likely theft. Revoke the whole family.
        _revoke_family(db, row.family_id)
        audit(db, "auth.refresh_reuse", row.user_id, row.user_id, request=request)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    user = db.get(User, row.user_id)
    if row.expires_at <= utcnow() or user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    row.revoked_at = utcnow()
    new_token = _issue_refresh(db, user, row.family_id)
    db.commit()
    return _token_response(user, new_token)


@router.post("/logout")
def logout(body: RefreshIn, db: Session = Depends(get_db)):
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256_hex(body.refresh_token)))
    if row is not None:
        _revoke_family(db, row.family_id)
        db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"user": user_out(user)}


@router.post("/change-password")
@limiter.limit("5/minute")
def change_password(
    request: Request, body: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    audit(db, "auth.password_change", user.id, user.id, request=request)
    db.commit()
    return {"ok": True}
