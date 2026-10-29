import asyncio
import contextlib
import logging

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal, engine
from app.jobs.retention import run_retention
from app.ratelimit import limiter
from app.reason_codes import AttendanceError
from app.routers import admin, attendance, auth, enrollment, sessions
from app.services.face.verifier import get_verifier

log = logging.getLogger("attendance")
MAX_BODY_BYTES = 8 * 1024 * 1024
RETENTION_INTERVAL_SECONDS = 6 * 3600


async def _retention_loop():
    while True:
        await asyncio.sleep(RETENTION_INTERVAL_SECONDS)
        try:
            with SessionLocal() as db:
                await asyncio.to_thread(run_retention, db)
        except Exception:  # never crash the app because of the job
            log.exception("retention job failed")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    get_verifier()  # fail fast if face models are missing
    task = asyncio.create_task(_retention_loop())
    yield
    task.cancel()


settings = get_settings()
app = FastAPI(
    title="College QR Attendance API",
    version="1.0.0",
    description="QR attendance with server-side face-assisted verification.",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/api/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/api/openapi.json",
)
app.state.limiter = limiter


@app.exception_handler(AttendanceError)
async def attendance_error_handler(_: Request, exc: AttendanceError):
    return JSONResponse(status_code=exc.status_code, content=exc.body())


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(_: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"ok": False, "reason": "RATE_LIMITED", "message": "Too many requests. Please wait and try again.",
                 "detail": "Too many requests"},
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    # Log type + path only: request bodies may contain face images.
    log.error("unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
    return JSONResponse(
        status_code=500, content={"ok": False, "reason": "SERVER_ERROR", "message": "Something went wrong. Try again."}
    )


@app.middleware("http")
async def limits_and_headers(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "Request too large"})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


api = APIRouter(prefix="/api")
for r in (auth.router, attendance.router, enrollment.router, sessions.router, admin.router):
    api.include_router(r)


@api.get("/health", tags=["ops"])
def health():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"ok": True, "face_verifier": settings.face_verifier}


app.include_router(api)
