"""Location restriction (geofence) tests."""

import sqlalchemy as sa

from app.models import AuditLog
from app.services.geo import distance_m

# A classroom anchor and points at known offsets (1e-4 deg latitude ~= 11.1 m).
CLASSROOM = {"latitude": 17.385000, "longitude": 78.486700, "accuracy": 10}


def at(dlat_deg: float, accuracy: float = 10, mocked: bool = False) -> dict:
    return {"latitude": CLASSROOM["latitude"] + dlat_deg, "longitude": CLASSROOM["longitude"],
            "accuracy": accuracy, "mocked": mocked}


def start(world, student, sid, location=None):
    body = {"qr": world.qr(sid)}
    if location is not None:
        body["location"] = location
    return world.client.post("/api/attendance/start", headers=world.h(student), json=body)


def test_haversine():
    assert abs(distance_m(17.385, 78.4867, 17.386, 78.4867) - 111.2) < 1


def test_inside_radius_accepted(world):
    sid = world.open_session(face_required=False, location=CLASSROOM, radius=50)
    r = start(world, world.bob, sid, at(0.0003))  # ~33 m
    assert r.status_code == 200 and r.json()["mode"] == "done"


def test_outside_radius_rejected_and_flagged(world, db):
    sid = world.open_session(face_required=False, location=CLASSROOM, radius=50)
    r = start(world, world.bob, sid, at(0.0020))  # ~222 m
    assert r.status_code == 403 and r.json()["reason"] == "LOCATION_OUT_OF_RANGE"
    assert r.json()["can_request_manual"] is True and "_distance" not in r.json()
    row = db.scalar(sa.select(AuditLog).where(AuditLog.action == "location.reject"))
    assert row.details["distance_m"] > 200
    assert "latitude" not in str(row.details)  # student coordinates never stored
    dash = world.client.get(f"/api/sessions/{sid}/attendance", headers=world.h(world.teacher)).json()
    bob = next(x for x in dash["students"] if x["college_id"] == "S2")
    assert bob["location_failed"] is True and bob["status"] == "pending"
    # teacher fallback still works
    assert world.client.post("/api/attendance/requests", headers=world.h(world.bob),
                             json={"session_id": sid}).status_code == 200


def test_missing_mocked_and_inaccurate_location_rejected(world):
    sid = world.open_session(face_required=False, location=CLASSROOM, radius=100)
    assert start(world, world.bob, sid).json()["reason"] == "LOCATION_REQUIRED"
    assert start(world, world.bob, sid, at(0, mocked=True)).json()["reason"] == "LOCATION_MOCKED"
    assert start(world, world.bob, sid, at(0, accuracy=500)).json()["reason"] == "LOCATION_INACCURATE"


def test_location_checked_before_face_step(world):
    world.enrol(world.alice, "alice")
    sid = world.open_session(location=CLASSROOM, radius=50)
    assert start(world, world.alice, sid, at(0.01)).json()["reason"] == "LOCATION_OUT_OF_RANGE"
    ok = start(world, world.alice, sid, at(0.0001))
    assert ok.json()["mode"] == "face" and ok.json()["nonce"]


def test_unrestricted_session_ignores_location(world):
    sid = world.open_session(face_required=False)
    assert start(world, world.bob, sid).json()["mode"] == "done"


def test_teacher_location_validation(world):
    c, h = world.client, world.h(world.teacher)
    base = {"class_id": str(world.klass.id), "duration_minutes": 10}
    assert c.post("/api/sessions", headers=h, json={**base, "location": {**CLASSROOM, "accuracy": 900}}).status_code == 400
    assert c.post("/api/sessions", headers=h, json={**base, "location": {**CLASSROOM, "mocked": True}}).status_code == 400
    assert c.post("/api/sessions", headers=h, json={**base, "location": CLASSROOM, "geofence_radius_m": 5}).status_code == 400
    assert c.post("/api/sessions", headers=h, json={**base, "geofence_radius_m": 100}).status_code == 400
    r = c.post("/api/sessions", headers=h, json={**base, "location": CLASSROOM})
    assert r.status_code == 201 and r.json()["location_restricted"] and r.json()["geofence_radius_m"] == 100
