"""Tests for sign-up, role-aware login, forgot password, profile, face-change limit,
class schedule / weightage, teacher sessions & reports, and 5-second QR rotation."""

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import time as dtime

import sqlalchemy as sa

from app.config import get_settings
from app.models import AttendanceSession, FaceChangeRequest, User
from app.services import qr as qrsvc
from app.services import schedule as sched
from tests.conftest import PASSWORD, frame


# ---------------------------------------------------------------- sign-up / login
def _register(c, **kw):
    body = {"role": "student", "college_id": "26cs900", "full_name": "New Student",
            "email": "new900@t.edu", "password": "a-long-password-1", **kw}
    return c.post("/api/auth/register", json=body)


def test_signup_pending_until_admin_approves(world, db):
    c = world.client
    r = _register(c)
    assert r.status_code == 201
    u = db.scalar(sa.select(User).where(User.college_id == "26CS900"))  # stored upper-case
    assert u.signup_status == "pending" and u.is_active is False
    pending = c.post("/api/auth/login", json={"username": "26cs900", "password": "a-long-password-1"})
    assert pending.status_code == 403 and "approval" in pending.json()["detail"]
    # wrong password does NOT reveal the pending state
    assert c.post("/api/auth/login", json={"username": "26CS900", "password": "wrong"}).status_code == 401

    queue = c.get("/api/admin/users?status=pending_signup", headers=world.h(world.admin)).json()
    assert [x["college_id"] for x in queue] == ["26CS900"]
    assert c.post(f"/api/admin/users/{u.id}/signup", headers=world.h(world.teacher),
                  json={"decision": "approve"}).status_code == 403  # admins only
    assert c.post(f"/api/admin/users/{u.id}/signup", headers=world.h(world.admin),
                  json={"decision": "approve"}).status_code == 200
    ok = c.post("/api/auth/login", json={"username": "26cs900", "password": "a-long-password-1", "role": "student"})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "student"


def test_signup_rejected_cannot_login_and_no_admin_signup(world, db):
    c = world.client
    _register(c, college_id="26CS901", email="x901@t.edu")
    u = db.scalar(sa.select(User).where(User.college_id == "26CS901"))
    c.post(f"/api/admin/users/{u.id}/signup", headers=world.h(world.admin), json={"decision": "reject"})
    r = c.post("/api/auth/login", json={"username": "26CS901", "password": "a-long-password-1"})
    assert r.status_code == 403 and "not approved" in r.json()["detail"]
    assert _register(c, role="admin", college_id="26CS902", email="x902@t.edu").status_code == 422
    assert _register(c, college_id="S1", email="dup@t.edu").status_code == 409  # duplicate college id


def test_login_enforces_selected_user_type(world):
    c = world.client
    wrong = c.post("/api/auth/login", json={"username": "S1", "password": PASSWORD, "role": "teacher"})
    bad_pw = c.post("/api/auth/login", json={"username": "S1", "password": "nope", "role": "teacher"})
    assert wrong.status_code == bad_pw.status_code == 401 and wrong.json() == bad_pw.json()
    assert "access_token" not in wrong.text
    assert c.post("/api/auth/login", json={"username": "BIO", "password": PASSWORD, "role": "admin"}).status_code == 200
    assert c.post("/api/auth/login", json={"username": "T1", "password": PASSWORD, "role": "teacher"}).status_code == 200


def test_forgot_password_generic_and_flags_admin(world, db):
    c = world.client
    a = c.post("/api/auth/forgot-password", json={"username": "S1"})
    b = c.post("/api/auth/forgot-password", json={"username": "nobody-here"})
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    flagged = c.get("/api/admin/users?status=reset_requested", headers=world.h(world.admin)).json()
    assert [u["college_id"] for u in flagged] == ["S1"] and flagged[0]["password_reset_requested"]
    c.patch(f"/api/admin/users/{world.alice.id}", headers=world.h(world.admin), json={"new_password": "brand-new-pass-1"})
    assert c.get("/api/admin/users?status=reset_requested", headers=world.h(world.admin)).json() == []


def test_profile_is_role_specific_and_own_data_only(world):
    world.enrol(world.alice, "alice")
    p = world.client.get("/api/auth/profile", headers=world.h(world.alice)).json()
    assert p["user"]["college_id"] == "S1"
    assert [x["code"] for x in p["student"]["classes"]] == ["CS201"]
    assert p["student"]["face"]["changes_remaining"] == 2 and p["student"]["face"]["template_status"] == "active"
    assert "staff" not in p and "teacher" not in p
    t = world.client.get("/api/auth/profile", headers=world.h(world.teacher)).json()
    assert [x["code"] for x in t["teacher"]["classes"]] == ["CS201"] and "student" not in t
    s = world.client.get("/api/auth/profile", headers=world.h(world.admin)).json()
    assert set(s["staff"]) == {"pending_signups", "pending_face_changes", "password_reset_requests"}
    assert world.client.get("/api/auth/profile").status_code == 401


# ---------------------------------------------------------------- face change limit
def _enrol_again(world, student, person):
    return world.client.post("/api/face/enrollment", headers=world.h(student), json={
        "front": [frame(person)], "left": [frame(person, 0.3)], "right": [frame(person, -0.3)]})


def test_face_change_limit_two_then_admin_approval(world, db):
    c = world.client
    world.enrol(world.alice, "alice")                      # initial: free
    st = c.get("/api/face/enrollment/status", headers=world.h(world.alice)).json()["face_changes"]
    assert st == {"enrolled_once": True, "changes_used": 0, "changes_allowed": 2, "changes_remaining": 2,
                  "limit_reached": False}
    assert _enrol_again(world, world.alice, "alice").json()["face_changes"]["changes_remaining"] == 1
    # withdraw + re-enrol still counts (no reset by deleting)
    c.delete("/api/face/enrollment", headers=world.h(world.alice))
    v = c.get("/api/face/consent-notice").json()["version"]
    c.post("/api/face/enrollment/consent", json={"consent_version": v, "accepted": True}, headers=world.h(world.alice))
    assert _enrol_again(world, world.alice, "alice").json()["face_changes"]["changes_remaining"] == 0
    blocked = _enrol_again(world, world.alice, "alice")
    assert blocked.status_code == 403 and blocked.json()["detail"]["reason"] == "FACE_CHANGE_LIMIT"

    # request approval; only one pending at a time
    assert c.post("/api/face/change-requests", headers=world.h(world.alice), json={"reason": "new glasses"}).status_code == 201
    assert c.post("/api/face/change-requests", headers=world.h(world.alice), json={"reason": "again pls"}).status_code == 409
    assert c.get("/api/admin/face-change-requests", headers=world.h(world.alice)).status_code == 403
    queue = c.get("/api/admin/face-change-requests", headers=world.h(world.admin)).json()
    assert len(queue) == 1 and queue[0]["college_id"] == "S1"
    rid = queue[0]["id"]
    assert c.post(f"/api/admin/face-change-requests/{rid}/decide", headers=world.h(world.admin),
                  json={"decision": "approve", "note": "verified in person"}).json()["status"] == "approved"
    # double approval does not grant a second change
    assert c.post(f"/api/admin/face-change-requests/{rid}/decide", headers=world.h(world.admin),
                  json={"decision": "approve"}).status_code == 404
    r = db.scalar(sa.select(FaceChangeRequest))
    db.refresh(r)
    assert r.decided_by == world.admin.id and r.decided_at is not None
    assert _enrol_again(world, world.alice, "alice").status_code == 201      # the one approved change
    assert _enrol_again(world, world.alice, "alice").status_code == 403      # limit again


def test_change_request_not_allowed_while_changes_remain(world):
    world.enrol(world.alice, "alice")
    r = world.client.post("/api/face/change-requests", headers=world.h(world.alice), json={"reason": "just because"})
    assert r.status_code == 400


def test_concurrent_enrollments_cannot_exceed_limit(world, db):
    world.enrol(world.alice, "alice")
    _enrol_again(world, world.alice, "alice")             # 1 change left
    headers = world.h(world.alice)
    body = {"front": [frame("alice")], "left": [frame("alice", 0.3)], "right": [frame("alice", -0.3)]}
    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(pool.map(lambda _: world.client.post("/api/face/enrollment", headers=headers, json=body).status_code,
                              range(4)))
    assert codes.count(201) == 1 and codes.count(403) == 3
    u = db.get(User, world.alice.id)
    db.refresh(u)
    assert u.face_changes_used == 2


# ---------------------------------------------------------------- schedule & weightage
def test_schedule_rules():
    assert sched.duration_minutes(dtime(9, 0), dtime(10, 30)) == 90
    assert sched.duration_minutes(dtime(23, 0), dtime(1, 0)) == 120      # crosses midnight
    assert sched.duration_minutes(dtime(9, 0), dtime(9, 0)) is None
    assert sched.recommended_weight(60) == 1.0 and sched.recommended_weight(90) == 1.5
    assert sched.recommended_weight(45) == 0.75 and sched.recommended_weight(5) == 0.25
    assert sched.normalise_days("fri, mon,Wed") == "MON,WED,FRI"


def test_teacher_sets_schedule_and_weightage_own_class_only(world):
    c, h = world.client, world.h(world.teacher)
    url = f"/api/teacher/classes/{world.klass.id}"
    r = c.patch(url, headers=h, json={"start_time": "14:00", "end_time": "16:00", "days_of_week": "tue,thu"})
    assert r.status_code == 200
    j = r.json()
    assert j["duration_minutes"] == 120 and j["recommended_weightage"] == 2.0 and j["effective_weightage"] == 2.0
    assert j["days_of_week"] == "TUE,THU"
    assert c.patch(url, headers=h, json={"weightage": 1.25}).json()["effective_weightage"] == 1.25
    assert c.patch(url, headers=h, json={"weightage": 9}).status_code == 400
    assert c.patch(url, headers=h, json={"start_time": "25:00"}).status_code == 400
    assert c.patch(url, headers=h, json={"start_time": "16:00", "end_time": "16:00"}).status_code == 400
    assert c.patch(url, headers=world.h(world.other_teacher), json={"weightage": 2}).status_code == 404
    assert c.patch(url, headers=world.h(world.alice), json={"weightage": 2}).status_code == 403
    assert c.patch(url, headers=h, json={"clear_weightage": True}).json()["effective_weightage"] == 2.0


def test_weighted_attendance_and_snapshot(world, db):
    c, h = world.client, world.h(world.teacher)
    c.patch(f"/api/teacher/classes/{world.klass.id}", headers=h, json={"start_time": "09:00", "end_time": "11:00"})
    s1 = world.open_session(face_required=False)                         # weight 2.0
    assert db.get(AttendanceSession, s1).weight == 2.0
    c.post("/api/attendance/start", headers=world.h(world.bob), json={"qr": world.qr(s1)})
    c.post(f"/api/sessions/{s1}/close", headers=h)
    c.patch(f"/api/teacher/classes/{world.klass.id}", headers=h, json={"weightage": 1.0})
    s2 = world.open_session(face_required=False)                         # weight 1.0; bob absent
    assert db.get(AttendanceSession, s2).weight == 1.0
    assert db.get(AttendanceSession, s1).weight == 2.0                   # history unchanged
    c.post(f"/api/sessions/{s2}/close", headers=h)

    rep = c.get(f"/api/teacher/classes/{world.klass.id}/report", headers=h).json()
    bob = next(r for r in rep["students"] if r["college_id"] == "S2")
    assert bob["attended"] == 1 and bob["sessions"] == 2 and bob["percent"] == round(2 / 3 * 100, 1)
    me = c.get("/api/attendance/me", headers=world.h(world.bob)).json()
    assert me["overall_weighted_percent"] == round(2 / 3 * 100, 1)
    assert c.get(f"/api/teacher/classes/{world.klass.id}/report", headers=world.h(world.other_teacher)).status_code == 404


def test_teacher_sessions_table_data(world):
    c, h = world.client, world.h(world.teacher)
    sid = world.open_session(face_required=False)
    c.post("/api/attendance/start", headers=world.h(world.bob), json={"qr": world.qr(sid)})
    rows = c.get("/api/teacher/sessions", headers=h).json()
    assert len(rows) == 1 and rows[0]["present_count"] == 1 and rows[0]["total_students"] == 3
    assert rows[0]["attendance_percent"] == 33.3 and rows[0]["status"] == "open"
    assert c.get("/api/teacher/sessions", headers=world.h(world.other_teacher)).json() == []
    classes = c.get("/api/teacher/classes", headers=h).json()
    assert classes[0]["latest_session"]["status"] == "open"


def test_admin_class_schedule_and_summary(world):
    c, h = world.client, world.h(world.admin)
    r = c.post("/api/admin/classes", headers=h, json={"code": "cs999", "name": "Night Lab", "term": "T",
                                                      "teacher_id": str(world.teacher.id),
                                                      "start_time": "22:30", "end_time": "00:30"})
    assert r.status_code == 201 and r.json()["crosses_midnight"] and r.json()["duration_minutes"] == 120
    assert c.post("/api/admin/classes", headers=h, json={"code": "cs998", "name": "x", "term": "T",
                                                         "teacher_id": str(world.teacher.id),
                                                         "start_time": "10:00"}).status_code == 400
    s = c.get("/api/admin/summary", headers=h).json()
    assert s["users"]["student"] == 4 and s["classes"] == 2
    assert c.get("/api/admin/summary", headers=world.h(world.teacher)).status_code == 403


# ---------------------------------------------------------------- QR every 5 s
def test_qr_rotates_every_5_seconds_and_closed_session_stops_qr(world, db):
    assert get_settings().qr_rotation_seconds == 5
    sid = world.open_session(face_required=False)
    r = world.client.get(f"/api/sessions/{sid}/qr", headers=world.h(world.teacher)).json()
    assert r["rotation_seconds"] == 5 and 0 <= r["rotates_in"] <= 5
    s = db.get(AttendanceSession, sid)
    now = time.time()
    a, _ = qrsvc.build_qr(s.id, s.qr_secret_ref, now=now)
    b, _ = qrsvc.build_qr(s.id, s.qr_secret_ref, now=now + 5)
    assert a != b                                                         # new token every window
    assert qrsvc.verify_qr(a, s.qr_secret_ref, now=now + 10)              # within grace
    assert not qrsvc.verify_qr(a, s.qr_secret_ref, now=now + 16)          # expired
    world.client.post(f"/api/sessions/{sid}/close", headers=world.h(world.teacher))
    assert world.client.get(f"/api/sessions/{sid}/qr", headers=world.h(world.teacher)).status_code == 409
    late = world.client.post("/api/attendance/start", headers=world.h(world.bob), json={"qr": a})
    assert late.json()["reason"] in ("SESSION_EXPIRED", "SESSION_INVALID")
