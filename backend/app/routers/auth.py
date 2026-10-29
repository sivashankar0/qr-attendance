"""Auth for the mobile app: short-lived JWT access token + rotating opaque refresh token.

Tokens are returned in the response body; the app stores them in the Android Keystore-backed
SecureStore and sends `Authorization: Bearer <access>`.
"""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import RefreshToken, User
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
    user = db.scalar(select(User).where((User.college_id == username) | (User.email == username.lower())))
    now = utcnow()

    if user is not None and user.locked_until and user.locked_until > now:
        verify_password(None, body.password)  # equalise timing
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)

    ok = verify_password(user.password_hash if user else None, body.password)
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
