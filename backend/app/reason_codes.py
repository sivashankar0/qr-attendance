"""Rejection reason codes (roadmap Section 7.3). Messages never reveal scores or thresholds."""

from enum import Enum


class Reason(str, Enum):
    SESSION_EXPIRED = "SESSION_EXPIRED"
    SESSION_INVALID = "SESSION_INVALID"
    NOT_IN_CLASS = "NOT_IN_CLASS"
    ALREADY_MARKED = "ALREADY_MARKED"
    FACE_NOT_ENROLLED = "FACE_NOT_ENROLLED"
    FACE_NOT_DETECTED = "FACE_NOT_DETECTED"
    MULTIPLE_FACES = "MULTIPLE_FACES"
    LOW_QUALITY = "LOW_QUALITY"
    LIVENESS_FAILED = "LIVENESS_FAILED"
    FACE_MISMATCH = "FACE_MISMATCH"
    RETRY_LIMIT = "RETRY_LIMIT"
    COOLDOWN = "COOLDOWN"
    CHALLENGE_INVALID = "CHALLENGE_INVALID"
    DEVICE_UNTRUSTED = "DEVICE_UNTRUSTED"
    MANUAL_REQUIRED = "MANUAL_REQUIRED"
    LOCATION_REQUIRED = "LOCATION_REQUIRED"
    LOCATION_INACCURATE = "LOCATION_INACCURATE"
    LOCATION_OUT_OF_RANGE = "LOCATION_OUT_OF_RANGE"
    LOCATION_MOCKED = "LOCATION_MOCKED"
    SERVER_ERROR = "SERVER_ERROR"


MESSAGES: dict[Reason, str] = {
    Reason.SESSION_EXPIRED: "This attendance session has ended.",
    Reason.SESSION_INVALID: "This QR code is not valid. Ask your teacher to refresh it.",
    Reason.NOT_IN_CLASS: "You are not enrolled in this class.",
    Reason.ALREADY_MARKED: "Your attendance is already recorded.",
    Reason.FACE_NOT_ENROLLED: "Face enrollment is required. Open Enrollment to register.",
    Reason.FACE_NOT_DETECTED: "No face found. Centre your face in the frame.",
    Reason.MULTIPLE_FACES: "More than one face detected. Make sure only you are visible.",
    Reason.LOW_QUALITY: "Image too dark, blurry or angled. Improve lighting and retry.",
    Reason.LIVENESS_FAILED: "Live check not passed. Follow the on-screen prompts and retry.",
    Reason.FACE_MISMATCH: "Face did not match. Retry, or ask your teacher for manual verification.",
    Reason.RETRY_LIMIT: "Too many attempts. Ask your teacher for manual verification.",
    Reason.COOLDOWN: "Please wait a few seconds before trying again.",
    Reason.CHALLENGE_INVALID: "This verification step expired. Scan the QR code again.",
    Reason.DEVICE_UNTRUSTED: "This device could not be verified. Contact your teacher.",
    Reason.MANUAL_REQUIRED: "Your attendance needs teacher verification. Your request has been sent.",
    Reason.SERVER_ERROR: "Something went wrong. Try again.",
    Reason.LOCATION_REQUIRED: "This class requires your location. Turn on location and allow access, then scan again.",
    Reason.LOCATION_INACCURATE: "Your location is not precise enough. Turn on high-accuracy location, step away from "
    "thick walls, and scan again.",
    Reason.LOCATION_OUT_OF_RANGE: "You do not appear to be in the classroom. Move closer and scan again, or ask your "
    "teacher for manual verification.",
    Reason.LOCATION_MOCKED: "A fake (mock) location app was detected. Turn it off to mark attendance.",
}


class AttendanceError(Exception):
    def __init__(self, reason: Reason, status_code: int = 400, extra: dict | None = None):
        self.reason = reason
        self.status_code = status_code
        self.extra = extra or {}
        super().__init__(reason.value)

    def body(self) -> dict:
        # Keys starting with "_" are internal (e.g. for audit) and never sent to the client.
        public = {k: v for k, v in self.extra.items() if not k.startswith("_")}
        return {"ok": False, "reason": self.reason.value, "message": MESSAGES[self.reason], **public}
