import uuid
from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Class, User
from app.security import decode_access_token


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else None
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account inactive")
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed for your role")
        return user

    return checker


require_student = require_roles("student")
require_teacher = require_roles("teacher")
require_admin = require_roles("admin")
require_staff_admin = require_roles("admin", "biometric_officer")


def get_owned_class(db: Session, class_id: uuid.UUID, teacher: User) -> Class:
    """Teachers may only touch their own classes. 404 (not 403) to avoid leaking existence."""
    klass = db.get(Class, class_id)
    if klass is None or klass.teacher_id != teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Class not found")
    return klass
