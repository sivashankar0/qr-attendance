import numpy as np
import pytest
import sqlalchemy as sa
from cryptography.exceptions import InvalidTag

from app.models import AuditLog, ConsentRecord, FaceTemplate
from app.security import decrypt_template, encrypt_template
from tests.conftest import PASSWORD, frame


# ---------------- auth ----------------
def test_login_refresh_rotation_and_reuse_detection(world):
    c = world.client
    r = c.post("/api/auth/login", json={"username": "S1", "password": PASSWORD})
    assert r.status_code == 200
    rt1 = r.json()["refresh_token"]
    r2 = c.post("/api/auth/refresh", json={"refresh_token": rt1})
    assert r2.status_code == 200
    rt2 = r2.json()["refresh_token"]
    # replaying the rotated token revokes the whole family
    assert c.post("/api/auth/refresh", json={"refresh_token": rt1}).status_code == 401
    assert c.post("/api/auth/refresh", json={"refresh_token": rt2}).status_code == 401


def test_bad_login_generic_error_and_lockout(world):
    c = world.client
    unknown = c.post("/api/auth/login", json={"username": "nobody", "password": "x"})
    wrong = c.post("/api/auth/login", json={"username": "S1", "password": "wrong"})
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()  # no user enumeration
    for _ in range(4):
        c.post("/api/auth/login", json={"username": "S1", "password": "wrong"})
    # now locked even with the right password
    assert c.post("/api/auth/login", json={"username": "S1", "password": PASSWORD}).status_code == 401


def test_logout_revokes_refresh(world):
    c = world.client
    rt = c.post("/api/auth/login", json={"username": "S1", "password": PASSWORD}).json()["refresh_token"]
    c.post("/api/auth/logout", json={"refresh_token": rt})
    assert c.post("/api/auth/refresh", json={"refresh_token": rt}).status_code == 401


def test_login_rate_limited(world):
    from app.ratelimit import limiter

    limiter.enabled = True
    limiter.reset()
    codes = [world.client.post("/api/auth/login", json={"username": "x", "password": "y"}).status_code
             for _ in range(12)]
    assert 429 in codes


# ---------------- 14.5 enrollment, deletion, privacy ----------------
def test_enrollment_requires_identity_verification(world):
    c = world.client
    v = c.get("/api/face/consent-notice").json()["version"]
    c.post("/api/face/enrollment/consent", json={"consent_version": v, "accepted": True},
           headers=world.h(world.unverified))
    r = c.post("/api/face/enrollment", headers=world.h(world.unverified),
               json={"front": [frame("x")], "left": [frame("x", 0.3)], "right": [frame("x", -0.3)]})
    assert r.status_code == 403


def test_enrollment_requires_consent(world):
    r = world.client.post("/api/face/enrollment", headers=world.h(world.alice),
                          json={"front": [frame("a")], "left": [frame("a", 0.3)], "right": [frame("a", -0.3)]})
    assert r.status_code == 403


def test_consent_must_be_current_version_and_explicit(world):
    c = world.client
    assert c.post("/api/face/enrollment/consent", json={"consent_version": "old", "accepted": True},
                  headers=world.h(world.alice)).status_code == 409
    v = c.get("/api/face/consent-notice").json()["version"]
    assert c.post("/api/face/enrollment/consent", json={"consent_version": v, "accepted": False},
                  headers=world.h(world.alice)).status_code == 400


def test_enrollment_rejects_mixed_people_and_missing_turns(world):
    c = world.client
    v = c.get("/api/face/consent-notice").json()["version"]
    c.post("/api/face/enrollment/consent", json={"consent_version": v, "accepted": True}, headers=world.h(world.alice))
    no_turn = c.post("/api/face/enrollment", headers=world.h(world.alice),
                     json={"front": [frame("a")], "left": [frame("a")], "right": [frame("a")]})
    assert no_turn.status_code == 422 and no_turn.json()["detail"]["reason"] == "LIVENESS_FAILED"
    mixed = c.post("/api/face/enrollment", headers=world.h(world.alice),
                   json={"front": [frame("a")], "left": [frame("b", 0.3)], "right": [frame("c", -0.3)]})
    assert mixed.status_code == 422


def test_reenrollment_replaces_template(world, db):
    world.enrol(world.alice, "alice")
    first = db.scalar(sa.select(FaceTemplate.template_ciphertext))
    world.enrol(world.alice, "alice-new-look")
    rows = db.scalars(sa.select(FaceTemplate.template_ciphertext)).all()
    assert len(rows) == 1 and rows[0] != first


def test_withdraw_consent_deletes_template_and_audits(world, db):
    world.enrol(world.alice, "alice")
    r = world.client.delete("/api/face/enrollment", headers=world.h(world.alice))
    assert r.json()["template_deleted"] is True
    assert db.scalar(sa.select(sa.func.count()).select_from(FaceTemplate)) == 0
    assert db.scalar(sa.select(ConsentRecord.withdrawn_at)) is not None
    actions = set(db.scalars(sa.select(AuditLog.action)).all())
    assert {"template.delete", "consent.withdraw", "enrollment.create", "consent.grant"} <= actions
    status = world.client.get("/api/face/enrollment/status", headers=world.h(world.alice)).json()
    assert status["template_status"] == "not_enrolled" and status["consent_active"] is False


def test_audit_log_has_no_biometric_payloads(world, db):
    world.enrol(world.alice, "alice")
    for d in db.scalars(sa.select(AuditLog.details)).all():
        text = str(d or "")
        assert "MOCK" not in text and "embedding" not in text and "ciphertext" not in text


def test_template_ciphertext_bound_to_student():
    import uuid

    emb = np.ones(128, dtype=np.float32).tobytes()
    a, b = uuid.uuid4(), uuid.uuid4()
    ct, ver = encrypt_template(emb, aad=a.bytes)
    assert emb not in ct
    assert decrypt_template(ct, ver, aad=a.bytes) == emb
    with pytest.raises(InvalidTag):
        decrypt_template(ct, ver, aad=b.bytes)  # swapping ciphertext to another student fails


def test_reporting_role_cannot_read_biometric_schema(db):
    db.execute(sa.text("""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='attendance_reporting') THEN
          CREATE ROLE attendance_reporting NOLOGIN; END IF; END $$"""))
    db.execute(sa.text("SET ROLE attendance_reporting"))
    with pytest.raises(sa.exc.ProgrammingError, match="permission denied"):
        db.execute(sa.text("SELECT * FROM biometric.face_templates"))
    db.rollback()


def test_officer_review_and_admin_cannot_see_ciphertext(world, db):
    world.enrol(world.alice, "alice")
    r = world.client.get("/api/admin/enrollments", headers=world.h(world.officer))
    assert r.status_code == 200 and "ciphertext" not in r.text and r.json()[0]["college_id"] == "S1"


def test_opt_out_routes_to_teacher_verification(world):
    world.client.post("/api/admin/opt-outs", headers=world.h(world.officer),
                      json={"student_id": str(world.bob.id), "reason_category": "accessibility"})
    sid = world.open_session()
    r = world.client.post("/api/attendance/start", headers=world.h(world.bob), json={"qr": world.qr(sid)})
    assert r.json()["mode"] == "manual"
    dash = world.client.get(f"/api/sessions/{sid}/attendance", headers=world.h(world.teacher)).json()
    row = next(x for x in dash["students"] if x["college_id"] == "S2")
    assert row["alternative_method"] and row["verification_requested"]


def test_admin_user_import(world):
    csv_text = ("role,college_id,full_name,email,password\n"
                "student,21CS100,New One,new1@t.edu,longpassword1\n"
                "student,21CS100,Dup,dup@t.edu,longpassword1\n"
                "wizard,X1,Bad Role,bad@t.edu,longpassword1\n")
    r = world.client.post("/api/admin/users/import", headers=world.h(world.admin), json={"csv_text": csv_text})
    assert r.status_code == 200 and r.json()["created"] == 1 and len(r.json()["errors"]) == 2


def test_retention_purges_expired_verification_results(world, db):
    from app.models import VerificationResult

    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = world.client.post("/api/attendance/start", headers=world.h(world.alice), json={"qr": world.qr(sid)}).json()
    world.client.post("/api/attendance/verify", headers=world.h(world.alice), json={
        "nonce": body["nonce"], "front_frames": [frame("alice")],
        "challenge_frames": [frame("alice", 0.3 if body["challenge"] == "turn_left" else -0.3)]})
    db.execute(sa.update(VerificationResult).values(purge_after=sa.func.now() - sa.text("interval '1 day'")))
    db.commit()
    r = world.client.post("/api/admin/retention/run", headers=world.h(world.admin))
    assert r.json()["verification_results"] == 1
    hist = world.client.get("/api/attendance/me", headers=world.h(world.alice)).json()
    assert hist["history"][0]["status"] == "present"  # attendance survives, biometric link purged
