"""Functional + bypass tests mapped to roadmap Section 14."""

import time

import sqlalchemy as sa

from app.models import AttendanceRecord, AttendanceSession, FaceTemplate
from app.services import qr as qrsvc
from tests.conftest import bad_frame, frame


def turn(challenge: str) -> float:
    return 0.3 if challenge == "turn_left" else -0.3


def verify(world, student, start_body, person, live=True, device=None):
    yaw = turn(start_body["challenge"]) if live else -turn(start_body["challenge"])
    return world.client.post(
        "/api/attendance/verify",
        headers=world.h(student, device),
        json={"nonce": start_body["nonce"], "front_frames": [frame(person)], "challenge_frames": [frame(person, yaw)]},
    )


def start(world, student, qr_text, device=None):
    return world.client.post("/api/attendance/start", headers=world.h(student, device), json={"qr": qr_text})


# ---------------- 14.1 functional ----------------
def test_correct_face_marks_present_with_server_time(world, db):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    s = start(world, world.alice, world.qr(sid))
    assert s.status_code == 200 and s.json()["mode"] == "face"
    r = verify(world, world.alice, s.json(), "alice")
    assert r.status_code == 200 and r.json()["ok"] is True, r.text
    assert r.json()["method"] == "qr_face"

    dash = world.client.get(f"/api/sessions/{sid}/attendance", headers=world.h(world.teacher)).json()
    row = next(x for x in dash["students"] if x["college_id"] == "S1")
    assert row["status"] == "present" and row["method"] == "QR + Face"
    assert dash["counts"]["face_verified"] == 1
    # no scores / thresholds leak to the teacher
    assert "score" not in str(dash).lower()


def test_wrong_face_rejected_then_retry_limit_then_manual_exception(world):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    for attempt in (1, 2, 3):
        r = verify(world, world.alice, body, "mallory")
        assert r.status_code == 200 and r.json()["ok"] is False
        assert r.json()["detail_reason"] == "FACE_MISMATCH"
        assert "score" not in r.text.lower() and "threshold" not in r.text.lower()
        if attempt < 3:
            body = {**body, **r.json()["retry"]}
    assert r.json()["reason"] == "RETRY_LIMIT" and r.json()["retry"] is None
    # a fresh scan is also refused
    again = start(world, world.alice, world.qr(sid))
    assert again.status_code == 429 and again.json()["reason"] == "RETRY_LIMIT"

    assert world.client.post("/api/attendance/requests", headers=world.h(world.alice),
                             json={"session_id": sid}).status_code == 200
    dash = world.client.get(f"/api/sessions/{sid}/attendance", headers=world.h(world.teacher)).json()
    row = next(x for x in dash["students"] if x["college_id"] == "S1")
    assert row["status"] == "rejected" and row["verification_requested"] is True

    exc = world.client.post("/api/attendance/exceptions", headers=world.h(world.teacher), json={
        "session_id": sid, "student_id": str(world.alice.id), "reason_category": "false_rejection",
        "identity_confirmed": True})
    assert exc.status_code == 201, exc.text
    dash = world.client.get(f"/api/sessions/{sid}/attendance", headers=world.h(world.teacher)).json()
    row = next(x for x in dash["students"] if x["college_id"] == "S1")
    assert row["status"] == "present_exception" and not row["verification_requested"]
    # duplicate exception -> single record only
    dup = world.client.post("/api/attendance/exceptions", headers=world.h(world.teacher), json={
        "session_id": sid, "student_id": str(world.alice.id), "reason_category": "other", "identity_confirmed": True})
    assert dup.status_code == 409


def test_exception_requires_identity_confirmation(world):
    sid = world.open_session()
    r = world.client.post("/api/attendance/exceptions", headers=world.h(world.teacher), json={
        "session_id": sid, "student_id": str(world.bob.id), "reason_category": "camera_failure",
        "identity_confirmed": False})
    assert r.status_code == 400


def test_liveness_wrong_direction_rejected(world):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    r = verify(world, world.alice, body, "alice", live=False)
    assert r.json()["ok"] is False and r.json()["detail_reason"] == "LIVENESS_FAILED"


def test_quality_issues_reported(world):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    r = world.client.post("/api/attendance/verify", headers=world.h(world.alice), json={
        "nonce": body["nonce"], "front_frames": [bad_frame("MULTIPLE_FACES")], "challenge_frames": [frame("alice")]})
    assert r.json()["detail_reason"] == "MULTIPLE_FACES"


def test_not_enrolled_guided_to_enrollment_or_manual(world):
    sid = world.open_session()
    r = start(world, world.bob, world.qr(sid))
    assert r.status_code == 400 and r.json()["reason"] == "FACE_NOT_ENROLLED" and r.json()["can_request_manual"]


def test_qr_scan_without_face_verification_records_nothing(world, db):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    start(world, world.alice, world.qr(sid))
    assert db.scalar(sa.select(sa.func.count()).select_from(AttendanceRecord)) == 0


def test_duplicate_attempts_single_record(world, db):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    assert verify(world, world.alice, body, "alice").json()["ok"] is True
    again = start(world, world.alice, world.qr(sid))
    assert again.status_code == 409 and again.json()["reason"] == "ALREADY_MARKED"
    assert db.scalar(sa.select(sa.func.count()).select_from(AttendanceRecord)) == 1


def test_face_not_required_session_marks_qr_only(world):
    sid = world.open_session(face_required=False)
    r = start(world, world.bob, world.qr(sid))
    assert r.json()["mode"] == "done" and r.json()["method"] == "qr_only"


def test_expired_and_closed_sessions_rejected(world, db):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    qr_text = world.qr(sid)
    world.client.post(f"/api/sessions/{sid}/close", headers=world.h(world.teacher))
    assert start(world, world.alice, qr_text).json()["reason"] == "SESSION_EXPIRED"

    sid2 = world.open_session()
    qr2 = world.qr(sid2)
    db.execute(sa.update(AttendanceSession).where(AttendanceSession.id == sid2)
               .values(expires_at=sa.func.now() - sa.text("interval '1 minute'")))
    db.commit()
    assert start(world, world.alice, qr2).json()["reason"] == "SESSION_EXPIRED"


def test_tampered_and_old_qr_rejected(world, db):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    good = world.qr(sid)
    prefix, s_id, window, sig = good.split(".")
    tampered = f"{prefix}.{s_id}.{window}.{'A' * len(sig)}"
    assert start(world, world.alice, tampered).json()["reason"] == "SESSION_INVALID"
    assert start(world, world.alice, "garbage-not-a-qr").json()["reason"] == "SESSION_INVALID"
    salt = db.get(AttendanceSession, s_id).qr_secret_ref
    # 5 s rotation + 2 grace windows: a token older than ~15 s is rejected
    old, _ = qrsvc.build_qr(db.get(AttendanceSession, s_id).id, salt, now=time.time() - 20)
    assert start(world, world.alice, old).json()["reason"] == "SESSION_INVALID"
    # the previous window is still accepted (grace for scan + network latency)
    prev, _ = qrsvc.build_qr(db.get(AttendanceSession, s_id).id, salt, now=time.time() - 5)
    assert start(world, world.alice, prev).status_code == 200


def test_qr_contains_no_student_or_secret_data(world):
    sid = world.open_session()
    text = world.qr(sid)
    parts = text.split(".")
    assert parts[0] == "QRA1" and parts[1] == sid and len(parts) == 4
    assert "S1" not in text and "@" not in text


def test_student_not_in_class(world):
    world.enrol(world.carol, "carol")
    sid = world.open_session()
    r = start(world, world.carol, world.qr(sid))
    assert r.status_code == 403 and r.json()["reason"] == "NOT_IN_CLASS"


# ---------------- 14.6 security / bypass ----------------
def test_client_face_verified_flag_and_student_id_rejected(world):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    r = world.client.post("/api/attendance/verify", headers=world.h(world.alice), json={
        "nonce": body["nonce"], "front_frames": [frame("alice")], "challenge_frames": [frame("alice", 0.3)],
        "face_verified": True})
    assert r.status_code == 422
    r = world.client.post("/api/attendance/start", headers=world.h(world.bob),
                          json={"qr": world.qr(sid), "student_id": str(world.alice.id)})
    assert r.status_code == 422


def test_nonce_reuse_and_cross_student_nonce_rejected(world):
    world.enrol(world.alice, "alice")
    world.enrol(world.bob, "bob")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    # bob tries alice's nonce with his own face
    r = verify(world, world.bob, body, "bob")
    assert r.json()["reason"] == "CHALLENGE_INVALID"
    assert verify(world, world.alice, body, "alice").json()["ok"] is True
    # replay of the consumed nonce
    assert verify(world, world.alice, body, "alice").json()["reason"] in ("CHALLENGE_INVALID", "ALREADY_MARKED")
    forged = {**body, "nonce": "forged-nonce-value-123"}
    assert verify(world, world.bob, forged, "bob").json()["reason"] == "CHALLENGE_INVALID"


def test_friend_using_students_login_rejected(world):
    """Bob logs in as Alice (has her password) but his face does not match her template."""
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    assert verify(world, world.alice, body, "bob").json()["detail_reason"] == "FACE_MISMATCH"


def test_role_boundaries(world):
    c = world.client
    sid = world.open_session()
    assert c.get(f"/api/sessions/{sid}/attendance", headers=world.h(world.other_teacher)).status_code == 404
    assert c.get(f"/api/sessions/{sid}/qr", headers=world.h(world.alice)).status_code == 403
    assert c.get("/api/admin/users", headers=world.h(world.teacher)).status_code == 403
    assert c.get("/api/admin/enrollments", headers=world.h(world.alice)).status_code == 403
    assert c.post("/api/attendance/start", headers=world.h(world.teacher), json={"qr": world.qr(sid)}).status_code == 403
    assert c.get("/api/attendance/me").status_code == 401


def test_shared_device_flagged(world):
    world.enrol(world.alice, "alice")
    world.enrol(world.bob, "bob")
    sid = world.open_session()
    for who, person in ((world.alice, "alice"), (world.bob, "bob")):
        body = start(world, who, world.qr(sid), device="same-phone").json()
        assert verify(world, who, body, person, device="same-phone").json()["ok"]
    dash = world.client.get(f"/api/sessions/{sid}/attendance", headers=world.h(world.teacher)).json()
    assert all(r["shared_device"] for r in dash["students"] if r["status"] == "present")


def test_cooldown_enforced(world):
    from app.config import get_settings

    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    r = verify(world, world.alice, body, "mallory").json()
    get_settings().attempt_cooldown_seconds = 30
    try:
        r2 = verify(world, world.alice, {**body, **r["retry"]}, "alice")
        assert r2.status_code == 429 and r2.json()["reason"] == "COOLDOWN"
    finally:
        get_settings().attempt_cooldown_seconds = 0


def test_csv_export_escapes_formulas(world, db):
    from app.models import User

    db.execute(sa.update(User).where(User.id == world.bob.id).values(full_name="=HYPERLINK(evil)"))
    db.commit()
    sid = world.open_session()
    r = world.client.get(f"/api/sessions/{sid}/export.csv", headers=world.h(world.teacher))
    assert r.status_code == 200 and "'=HYPERLINK" in r.text


def test_student_history_only_own(world):
    world.enrol(world.alice, "alice")
    sid = world.open_session()
    body = start(world, world.alice, world.qr(sid)).json()
    verify(world, world.alice, body, "alice")
    mine = world.client.get("/api/attendance/me", headers=world.h(world.alice)).json()
    bobs = world.client.get("/api/attendance/me", headers=world.h(world.bob)).json()
    assert mine["history"][0]["status"] == "present"
    assert bobs["history"][0]["status"] == "open"


def test_template_row_is_encrypted(world, db):
    world.enrol(world.alice, "alice")
    tpl = db.scalar(sa.select(FaceTemplate))
    assert tpl.key_version == "v1" and len(tpl.template_ciphertext) == 12 + 128 * 4 + 16
