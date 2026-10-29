import ipaddress
import uuid

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog


def client_ip(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    try:
        return str(ipaddress.ip_address(request.client.host))
    except ValueError:
        return None


def audit(
    db: Session,
    action: str,
    actor_id: uuid.UUID | None,
    target_id: uuid.UUID | None = None,
    request: Request | None = None,
    **details,
) -> None:
    """Add an audit row to the current transaction. Never pass biometric payloads in details."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_id=target_id,
            ip_address=client_ip(request),
            details=details or None,
        )
    )
