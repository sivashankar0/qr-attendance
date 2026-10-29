"""Classroom geofence check (location restriction).

The allowed area is the teacher's phone position when the session starts, plus a radius.
Student coordinates are used only for this check and are NEVER stored; only the rounded
distance goes to the audit log.

Limits (be honest about them): phone GPS can be spoofed by mock-location apps or a modified app,
and indoor accuracy is often 20-50 m. This raises the cost of proxy attendance together with the
rotating QR and face check; it does not prove presence on its own.
"""

import math

from pydantic import BaseModel, Field

from app.config import get_settings
from app.models import AttendanceSession
from app.reason_codes import AttendanceError, Reason

EARTH_RADIUS_M = 6_371_000


class LocationIn(BaseModel, extra="forbid"):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy: float = Field(ge=0, le=100_000, description="Reported horizontal accuracy in metres")
    mocked: bool = False  # Android reports positions from mock-location providers


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def validate_teacher_location(loc: LocationIn) -> None:
    s = get_settings()
    if loc.mocked:
        raise AttendanceError(Reason.LOCATION_MOCKED)
    if loc.accuracy > s.geofence_max_teacher_accuracy_m:
        raise AttendanceError(Reason.LOCATION_INACCURATE)


def check_student_location(session: AttendanceSession, loc: LocationIn | None) -> float | None:
    """Raise if the student is not inside the session's geofence. Returns the distance (m)."""
    if session.geofence_radius_m is None:
        return None
    if loc is None:
        raise AttendanceError(Reason.LOCATION_REQUIRED, extra={"can_request_manual": True})
    s = get_settings()
    if loc.mocked:
        raise AttendanceError(Reason.LOCATION_MOCKED, status_code=403, extra={"can_request_manual": True})
    if loc.accuracy > s.geofence_max_student_accuracy_m:
        raise AttendanceError(Reason.LOCATION_INACCURATE, extra={"can_request_manual": True})
    d = distance_m(session.location_lat, session.location_lon, loc.latitude, loc.longitude)
    # Tolerance for the teacher's own GPS error, capped so a vague anchor can't widen the fence much.
    allowed = session.geofence_radius_m + min(session.location_accuracy_m or 0, s.geofence_anchor_tolerance_m)
    if d > allowed:
        raise AttendanceError(
            Reason.LOCATION_OUT_OF_RANGE, status_code=403, extra={"can_request_manual": True, "_distance": d}
        )
    return d
