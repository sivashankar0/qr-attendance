"""Class schedule and attendance weightage rules.

There was no weightage logic before this module, so the rule below is the single source of truth:

1. Duration: end_time - start_time on the same day; if end_time < start_time the class crosses
   midnight and 24 h is added. Equal times are invalid.
2. Recommended weightage: duration in hours, rounded to the nearest 0.25, minimum 0.25
   (a 60-minute class = 1.0, a 90-minute lab = 1.5, a 45-minute class = 0.75).
3. Teachers (own classes) or admins may override it with any value in [0.25, 5.0].
   effective = override if set, else recommendation if a schedule exists, else 1.0.
4. Each session stores the class's effective weightage at the moment it starts (snapshot), so
   changing the weightage later never rewrites past attendance.
5. Attendance % = sum(weight of sessions attended) / sum(weight of all non-cancelled sessions) * 100.
   "Attended" = present or present_exception. Within one class every session usually has the same
   weight, so the class % equals the plain count %; the weighting matters for a student's overall %
   across classes (a 2-hour lab counts twice as much as a 1-hour lecture).
"""

from datetime import time

from app.models import Class

MIN_WEIGHT = 0.25
MAX_WEIGHT = 5.0
DAYS = ("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")


def duration_minutes(start: time | None, end: time | None) -> int | None:
    if start is None or end is None:
        return None
    s = start.hour * 60 + start.minute
    e = end.hour * 60 + end.minute
    if s == e:
        return None
    return e - s if e > s else e + 24 * 60 - s


def recommended_weight(minutes: int | None) -> float | None:
    if not minutes:
        return None
    return max(MIN_WEIGHT, round(minutes / 60 * 4) / 4)


def effective_weight(c: Class) -> float:
    if c.weightage is not None:
        return c.weightage
    return recommended_weight(duration_minutes(c.start_time, c.end_time)) or 1.0


def parse_hhmm(value: str | None) -> time | None:
    if value is None or value == "":
        return None
    try:
        h, m = value.strip().split(":")
        return time(int(h), int(m))
    except (ValueError, TypeError):
        raise ValueError("Time must be HH:MM (24-hour), e.g. 09:30")


def normalise_days(value: str | None) -> str | None:
    if not value:
        return None
    days = [d.strip().upper()[:3] for d in value.split(",") if d.strip()]
    bad = [d for d in days if d not in DAYS]
    if bad:
        raise ValueError(f"Unknown day(s): {', '.join(bad)}. Use MON..SUN")
    return ",".join(sorted(set(days), key=DAYS.index))


def validate_weight(value: float | None) -> float | None:
    if value is None:
        return None
    if not (MIN_WEIGHT <= value <= MAX_WEIGHT):
        raise ValueError(f"Weightage must be between {MIN_WEIGHT} and {MAX_WEIGHT}")
    return round(value, 2)


def schedule_out(c: Class) -> dict:
    minutes = duration_minutes(c.start_time, c.end_time)
    return {
        "start_time": c.start_time.strftime("%H:%M") if c.start_time else None,
        "end_time": c.end_time.strftime("%H:%M") if c.end_time else None,
        "crosses_midnight": bool(c.start_time and c.end_time and c.end_time < c.start_time),
        "days_of_week": c.days_of_week,
        "duration_minutes": minutes,
        "weightage": c.weightage,
        "recommended_weightage": recommended_weight(minutes),
        "effective_weightage": effective_weight(c),
    }
