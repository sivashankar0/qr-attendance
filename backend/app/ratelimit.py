from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import get_settings
from app.security import sha256_hex


def user_or_ip(request: Request) -> str:
    """Rate-limit key: the bearer token identifies the user; fall back to IP."""
    auth = request.headers.get("authorization", "")
    return f"tok:{sha256_hex(auth)[:32]}" if auth else f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=get_remote_address, storage_uri=get_settings().rate_limit_storage)
