"""Tests run against a real PostgreSQL test database (attendance_test) using the MockFaceVerifier.

The test DB is created next to the dev DB and migrated with Alembic, so migrations are tested too.
"""

import base64
import os
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent


def _dev_db_url() -> str:
    env = (BACKEND / ".env").read_text()
    return re.search(r"^DATABASE_URL=(.+)$", env, re.M).group(1).strip()


DEV_URL = _dev_db_url()
TEST_URL = DEV_URL.rsplit("/", 1)[0] + "/attendance_test"
os.environ.update(
    DATABASE_URL=TEST_URL,
    FACE_VERIFIER="mock",
    ENVIRONMENT="test",
    ATTEMPT_COOLDOWN_SECONDS="0",
)

import sqlalchemy as sa  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402


def _create_test_db():
    admin_engine = sa.create_engine(DEV_URL, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as c:
        c.execute(sa.text("DROP DATABASE IF EXISTS attendance_test WITH (FORCE)"))
        c.execute(sa.text("CREATE DATABASE attendance_test"))
    admin_engine.dispose()
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    command.upgrade(cfg, "head")


_create_test_db()

from fastapi.testclient import TestClient  # noqa: E402

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Class, ClassMember, User  # noqa: E402
from app.ratelimit import limiter  # noqa: E402
from app.security import hash_password, utcnow  # noqa: E402

PASSWORD = "correct-horse-battery"
_PW_HASH = hash_password(PASSWORD)


@pytest.fixture(autouse=True)
def clean_db():
    limiter.enabled = False
    with engine.begin() as c:
        tables = c.execute(
            sa.text(
                "SELECT schemaname||'.'||tablename FROM pg_tables "
                "WHERE schemaname IN ('public','biometric') AND tablename <> 'alembic_version'"
            )
        ).scalars().all()
        c.execute(sa.text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def frame(person: str, yaw: float = 0.0) -> str:
    return base64.b64encode(f"MOCK|{person}|{yaw}".encode()).decode()


def bad_frame(code: str) -> str:
    return base64.b64encode(f"MOCK|{code}".encode()).decode()


class World:
    """Two teachers, three students, one class (alice + bob enrolled in class; carol is not)."""

    def __init__(self, db, client: TestClient):
        self.client = client
        mk = lambda role, cid, verified=True: User(  # noqa: E731
            role=role, college_id=cid, full_name=cid, email=f"{cid.lower()}@t.edu", password_hash=_PW_HASH,
            identity_verified_at=utcnow() if verified else None,
        )
        self.admin = mk("admin", "ADM")
        self.officer = mk("biometric_officer", "BIO")
        self.teacher = mk("teacher", "T1")
        self.other_teacher = mk("teacher", "T2")
        self.alice = mk("student", "S1")
        self.bob = mk("student", "S2")
        self.carol = mk("student", "S3")
        self.unverified = mk("student", "S4", verified=False)
        db.add_all([self.admin, self.officer, self.teacher, self.other_teacher, self.alice, self.bob, self.carol,
                    self.unverified])
        db.flush()
        self.klass = Class(code="CS201", name="Data Structures", teacher_id=self.teacher.id, term="T")
        db.add(self.klass)
        db.flush()
        for s in (self.alice, self.bob, self.unverified):
            db.add(ClassMember(class_id=self.klass.id, student_id=s.id))
        db.commit()
        self._tokens: dict[str, str] = {}

    def h(self, user: User, device: str | None = None) -> dict:
        if user.college_id not in self._tokens:
            r = self.client.post("/api/auth/login", json={"username": user.college_id, "password": PASSWORD})
            assert r.status_code == 200, r.text
            self._tokens[user.college_id] = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {self._tokens[user.college_id]}"}
        if device:
            headers["X-Device-Id"] = device
        return headers

    def enrol(self, student: User, person: str):
        c = self.client
        v = c.get("/api/face/consent-notice").json()["version"]
        assert c.post("/api/face/enrollment/consent", json={"consent_version": v, "accepted": True},
                      headers=self.h(student)).status_code == 201
        r = c.post("/api/face/enrollment", headers=self.h(student),
                   json={"front": [frame(person)], "left": [frame(person, 0.3)], "right": [frame(person, -0.3)]})
        assert r.status_code == 201, r.text
        return r.json()

    def open_session(self, face_required: bool = True, location: dict | None = None, radius: int | None = None) -> str:
        body = {"class_id": str(self.klass.id), "duration_minutes": 30, "face_required": face_required}
        if location is not None:
            body["location"] = location
        if radius is not None:
            body["geofence_radius_m"] = radius
        r = self.client.post("/api/sessions", headers=self.h(self.teacher), json=body)
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def qr(self, session_id: str) -> str:
        return self.client.get(f"/api/sessions/{session_id}/qr", headers=self.h(self.teacher)).json()["qr"]


@pytest.fixture
def world(db, client):
    return World(db, client)
