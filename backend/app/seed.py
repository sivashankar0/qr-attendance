"""Create the first admin account, and optionally demo data for a pilot / demo.

  python -m app.seed admin --college-id ADM001 --email admin@college.edu --name "Admin"   (prompts for password)
  python -m app.seed demo  --password <demo-password>    (TEST ACCOUNTS ONLY - never in production)
"""

import argparse
import getpass
import sys

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Class, ClassMember, User
from app.security import hash_password, utcnow


def _get_or_create(db, role, college_id, name, email, password, verified=False) -> User:
    u = db.scalar(select(User).where(User.college_id == college_id))
    if u is None:
        u = User(role=role, college_id=college_id, full_name=name, email=email.lower(),
                 password_hash=hash_password(password), identity_verified_at=utcnow() if verified else None)
        db.add(u)
        db.flush()
    return u


def create_admin(college_id: str, email: str, name: str) -> None:
    pw = getpass.getpass("Admin password (min 10 chars): ")
    if len(pw) < 10 or pw != getpass.getpass("Repeat: "):
        sys.exit("Passwords must match and be at least 10 characters")
    with SessionLocal() as db:
        _get_or_create(db, "admin", college_id, name, email, pw, verified=True)
        db.commit()
    print(f"Admin {college_id} ready.")


def create_demo(password: str) -> None:
    if get_settings().is_production:
        sys.exit("Refusing to create demo accounts in production")
    if len(password) < 10:
        sys.exit("Demo password must be at least 10 characters")
    with SessionLocal() as db:
        _get_or_create(db, "admin", "ADM001", "Demo Admin", "admin@demo.college", password, True)
        _get_or_create(db, "biometric_officer", "BIO001", "Demo Biometric Officer", "officer@demo.college", password, True)
        t1 = _get_or_create(db, "teacher", "T1001", "Dr. Lakshmi Rao", "t1001@demo.college", password, True)
        t2 = _get_or_create(db, "teacher", "T1002", "Prof. Arjun Mehta", "t1002@demo.college", password, True)
        names = ["A. Kumar", "B. Reddy", "C. Sharma", "D. Rao", "E. Khan", "F. Iyer", "G. Naidu", "H. Das"]
        students = [
            _get_or_create(db, "student", f"21CS{i + 1:03d}", n, f"21cs{i + 1:03d}@demo.college", password,
                           verified=True)
            for i, n in enumerate(names)
        ]
        for code, name, teacher, members in (
            ("CS201", "Data Structures", t1, students),
            ("CS305", "Operating Systems", t2, students[:5]),
        ):
            c = db.scalar(select(Class).where(Class.code == code, Class.term == "2026-ODD"))
            if c is None:
                c = Class(code=code, name=name, teacher_id=teacher.id, term="2026-ODD")
                db.add(c)
                db.flush()
            for s in members:
                if db.get(ClassMember, (c.id, s.id)) is None:
                    db.add(ClassMember(class_id=c.id, student_id=s.id))
        db.commit()
    print("Demo data ready (TEST ACCOUNTS ONLY). Log in with college ID, e.g. ADM001, BIO001, T1001, 21CS001.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("admin")
    a.add_argument("--college-id", required=True)
    a.add_argument("--email", required=True)
    a.add_argument("--name", required=True)
    d = sub.add_parser("demo")
    d.add_argument("--password", required=True)
    args = p.parse_args()
    if args.cmd == "admin":
        create_admin(args.college_id, args.email, args.name)
    else:
        create_demo(args.password)
