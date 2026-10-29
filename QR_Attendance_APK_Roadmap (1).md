# College QR Attendance APK — Project Roadmap
### QR-Based Attendance with Face-Authentication Verification

**Document version:** 1.0  **Date:** 29 October 2026
**Status:** Planning / design document

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Prototype vs Production-Grade (Read First)](#2-prototype-vs-production-grade-read-first)
3. [Roles and Core Workflows (incl. Student and Teacher Point of View)](#3-roles-and-core-workflows)
   - 3.1 Student Attendance Workflow
   - 3.2 Attendance State Machine
   - 3.3 Student Point of View
   - 3.4 Teacher Point of View
   - 3.5 Side-by-Side Comparison
   - 3.6 Information Boundaries Between Roles
4. [AI Coding Prompt](#4-ai-coding-prompt)
5. [System Architecture](#5-system-architecture)
6. [Database Schema](#6-database-schema)
7. [API Design](#7-api-design)
8. [Face Enrollment](#8-face-enrollment)
9. [Face Verification and Anti-Spoofing](#9-face-verification-and-anti-spoofing)
10. [Security Requirements](#10-security-requirements)
11. [Privacy, Consent and Data Retention Policy](#11-privacy-consent-and-data-retention-policy)
12. [UI Design](#12-ui-design)
13. [Development Roadmap](#13-development-roadmap)
14. [Testing Checklist](#14-testing-checklist)
15. [Risks and Open Decisions](#15-risks-and-open-decisions)
16. [Future Improvements](#16-future-improvements)
17. [Glossary](#17-glossary)

---

## 1. Project Overview

The **College QR Attendance APK** lets a teacher open an attendance session, display a session-specific QR code, and have students mark attendance by scanning it with the Android app. This update adds **face authentication** as an additional verification step, so that a student cannot mark attendance simply by receiving a forwarded QR image or by logging in on someone else's behalf.

### Goals

- Fast, low-friction attendance for classes of 30–200 students.
- Strong binding between **authenticated Student ID** and **Session ID**.
- An additional face-verification factor, with a fair fallback for students who cannot use it.
- Clear, auditable records for teachers and administrators.
- Responsible handling of biometric data (consent, minimisation, protection, deletion).

### Non-goals (for the first release)

- Replacing college ID or exam-hall identity checks.
- Continuous or covert face monitoring of any kind.
- Claiming spoof-proof security without testing (see Section 2).

---

## 2. Prototype vs Production-Grade (Read First)

Face authentication is easy to demo and hard to make secure. This document separates the two clearly.

| Aspect | Working Prototype | Production-Grade Biometric System |
|---|---|---|
| Face detection | On-device detection (e.g., ML Kit / MediaPipe) | Same, plus capture-quality gating |
| Face matching | Open-source embedding model on test data | Evaluated model with documented accuracy (FAR/FRR) on a representative population |
| Liveness | Simple challenge (blink / head turn) or none | Certified or independently tested presentation-attack-detection (PAD), or a vendor liveness service |
| Template storage | Encrypted DB column | Encrypted with managed keys (KMS/HSM), separated from identity data, access-logged |
| Trust in client | Client reports result (**not acceptable beyond demos**) | Server computes/validates the match; device integrity checked |
| Fallback | Teacher manual override | Audited exception workflow with reasons and review |
| Legal / privacy | Test data only | Consent records, privacy notice, retention policy, DPIA, institutional approval |
| Testing | Manual | Structured spoof testing, bias/fairness testing, load and penetration testing |

### Honest limitations

- **Face detection is not face recognition.** Detecting a face proves only that a face is in the frame.
- **Face recognition is not liveness.** A good match against a printed photo or replayed video is still a spoof.
- **On-device-only verification can be bypassed** on rooted or modified devices by feeding fake results to the backend.
- Accuracy varies with lighting, camera quality, age, skin tone, glasses, masks, and pose. Measured error rates must be reviewed before rollout.
- **Do not describe this system as "secure" or "spoof-proof" until the chosen implementation has been tested against the threats in Section 14.** Until then, describe it as "face-assisted attendance verification".

---

## 3. Roles and Core Workflows

### Roles

| Role | Capabilities |
|---|---|
| **Student** | Log in, enrol face (with consent), scan QR, complete face check, view own attendance, withdraw consent / request deletion |
| **Teacher** | Create sessions, display QR, view live attendance and verification status, approve manual exceptions for own classes |
| **Admin** | Manage users, classes, enrollment approvals, retention settings, audit logs; no routine access to raw biometric data |
| **Biometric Officer (optional)** | Reviews enrollment errors and deletion requests under policy |

### 3.1 Student Attendance Workflow

```
Teacher                    Student App                       Backend
  |                             |                               |
  |-- Create session ---------------------------------------->  |
  |<-- Session ID + signed, short-lived QR payload ------------  |
  |-- Display QR                |                               |
  |                             |-- Scan QR                     |
  |                             |-- (already logged in; JWT)    |
  |                             |-- POST /attendance/start ---> |
  |                             |   (session token, JWT)        | validate session, class
  |                             |                               | membership, expiry, duplicate
  |                             |<-- challenge + nonce -------- |
  |                             |-- Camera: capture live face   |
  |                             |   + liveness challenge        |
  |                             |-- POST /attendance/verify --> |
  |                             |   (nonce, capture/embedding)  | compare with enrolled template
  |                             |                               | check liveness, nonce, device
  |                             |                               | re-check session + duplicate
  |                             |                               | bind StudentID + SessionID
  |                             |<-- accepted / rejected + reason
```

Steps in words:

1. Teacher creates an attendance session and displays a session-specific QR code.
2. Student scans the QR with the app.
3. The app authenticates the student's account; the backend retrieves the registered Student ID **from the login token, never from the QR or request body**.
4. Student completes face verification with the phone camera.
5. The face is compared with the student's enrolled face template.
6. The backend validates: session, student identity, face-verification result, session expiry, class membership, and duplicate status.
7. If **every** check passes, the backend binds `Student ID + Session ID` and records attendance with a **server-generated timestamp**.
8. Otherwise attendance is rejected with a clear reason code (Section 7.3).

### 3.2 Attendance State Machine

```
 SCANNED ──> FACE_PENDING ──> VERIFIED ──> PRESENT
                 │   │
                 │   └─> RETRY (limited) ──> FACE_PENDING
                 └─> REJECTED (reason code)
                 └─> MANUAL_REVIEW ──> PRESENT_EXCEPTION | ABSENT
```

### 3.3 Student Point of View

#### A. One-Time Setup (first use)

1. Install the APK and log in with college credentials.
2. The home screen shows a banner: **"Face enrollment: not set up"**.
3. Open **Face Enrollment** and read the consent notice (what is collected, why, how it is stored and deleted, who can access it).
4. Choose **Accept** or **Decline and use the alternative method**. Declining never blocks attendance.
5. Complete the identity check (matched against college records, or staff-assisted).
6. Follow the guided capture (front, slight left, slight right) with live hints such as "Move closer" or "Find better lighting".
7. See the status change to **Active** (or **Pending review** if quality was marginal).

#### B. Marking Attendance (every class)

1. Open the app → tap **Scan QR** → point the camera at the teacher's screen.
2. The app confirms the class and session ("CS201 – Data Structures").
3. The **Face Verification** screen opens with an oval guide, a liveness prompt (e.g., "Turn your head slowly left") and an attempt counter ("Attempt 1 of 3").
4. Result screen:
   - **Success:** class name, server time and method ("QR + Face").
   - **Failure:** a plain reason (see Section 7.3) with **Try again** (until the limit) and **Request teacher verification**.
5. The attendance appears in **My Attendance** with a verification label.

#### C. When Something Goes Wrong

| Situation | What the student sees | What the student can do |
|---|---|---|
| Camera permission denied | Explanation and a button to open settings | Allow the camera, or request teacher verification |
| Poor lighting / blurry capture | Specific hint ("Too dark") | Retry within the limit |
| Face not matched | "Face did not match" (no score shown) | Retry, then request teacher verification |
| Retry limit reached | "Too many attempts" | Request teacher verification |
| Session expired | "This session has ended" | Contact the teacher |
| Already marked | "Your attendance is already recorded" | Nothing needed |
| Not enrolled for face | Prompt to enrol or use the alternative | Enrol, or ask for manual verification |
| Wants to leave the system | Consent withdrawal option | **Withdraw consent and delete** my face data from Enrollment Status |

#### D. What a Student Can and Cannot See or Do

| Can | Cannot |
|---|---|
| See own attendance history and verification method | See other students' attendance, faces, or results |
| See own enrollment status and consent history | See match scores, thresholds or liveness details |
| Re-enrol, withdraw consent, request deletion | Download or view their stored face template |
| Request manual verification | Approve their own exception |
| Use the alternative method without penalty | Mark attendance without a valid session and (where required) verification |

### 3.4 Teacher Point of View

#### A. Before Class

1. Log in and open **My Classes**.
2. Tap **Start Attendance** and set the class, start time, duration and whether face verification is required (default: required).
3. The session opens and a **large, rotating QR code** appears, with a countdown and a live count.

#### B. During Class

1. Display the QR on the projector or screen. It refreshes every 15–30 seconds, so a screenshot sent to an absent friend quickly becomes useless.
2. Watch the **Attendance Dashboard** update live:
   - **Present (face verified)**
   - **Present (exception)** – manual verification
   - **Pending** – not yet marked
   - **Rejected** – failed verification (reason category only)
3. Handle **verification requests**: when a student taps "Request teacher verification", the request appears in a queue.

#### C. Handling Exceptions (Manual Verification)

1. Open the request and **confirm the student's identity in person** (visual check, college ID).
2. Select a reason category: *Camera failure*, *Accessibility*, *False rejection*, *Not enrolled*, or *Other*.
3. Optionally add a short note and tap **Confirm**.
4. The system records the exception with the teacher ID and a server timestamp. It is flagged in reports and reviewed if exception rates are unusually high.

#### D. After Class

1. **Close the session** (or let it expire automatically). Late attempts are rejected.
2. Review the final list and export (CSV/PDF).
3. Late or disputed cases go through the exception workflow, never through direct editing of records without an audit trail.

#### E. What a Teacher Can and Cannot See or Do

| Can | Cannot |
|---|---|
| Create, run and close sessions for their own classes | Access other teachers' classes or sessions |
| See each student's status and verification method (face / exception) | View face images, templates, match scores or liveness data |
| Approve manual exceptions with a reason | Approve exceptions silently (all are logged and reviewable) |
| Export attendance for their classes | Enrol faces, delete templates, or change thresholds |
| See that a student uses an "alternative method" | See *why* a student opted out beyond a neutral label |

### 3.5 Side-by-Side Comparison

| Aspect | Student | Teacher |
|---|---|---|
| Main goal | Mark own attendance quickly and fairly | Run a session and get an accurate roll |
| Starts with | Scanning the QR | Creating a session and showing the QR |
| Uses the camera for | QR scan **and** face capture | Not required (the screen shows the QR) |
| Face data | Enrols and controls their own consent | Never sees it |
| Sees attendance of | Self only | Own classes only |
| Failure handling | Retry (limited) → request teacher verification | Review queue → confirm identity → record exception |
| Key screens | Home, QR Scanner, Face Enrollment & Consent, Face Verification, Success/Failure, Enrollment Status | Session/QR, Attendance Dashboard, Manual Verification |
| Accountability | Actions tied to their Student ID | Every exception tied to their Teacher ID |
| Privacy rights | View, correct, withdraw, delete | Not applicable to biometric data |

### 3.6 Information Boundaries Between Roles

```
                Student App                 Teacher App                 Admin / Officer
Face images        capture only (not stored)   never                       never (routine)
Face template      never sees                  never                       restricted, logged
Match scores       never                       never                       limited, retention-bound
Attendance status  own                         own classes                 all (reporting)
Exceptions         can request                 can approve                 can review / audit
Consent            can grant / withdraw        never                       can view status
```

Role checks are enforced on the **backend**, not only in the app UI. A student or teacher calling the API directly must still be refused anything outside the table above.

---

## 4. AI Coding Prompt

Copy the prompt below into your AI coding assistant. Adjust the stack if needed.

````text
You are a senior Android + backend engineer. Build the "College QR Attendance APK"
with face-authentication verification, in the stages below. Never claim the system
is secure against spoofing unless tests prove it; label prototype shortcuts clearly
in code comments and README.

STACK (change if I specify otherwise)
- Android app: Kotlin, Jetpack Compose, CameraX, ML Kit Barcode Scanning,
  ML Kit Face Detection (detection only), Retrofit/OkHttp, EncryptedSharedPreferences.
- Backend: Python FastAPI (or Node/NestJS), PostgreSQL, Redis (optional, for nonces),
  JWT auth with short-lived access tokens + refresh tokens.
- Face verification: pluggable interface `FaceVerifier` with implementations:
  (1) MockFaceVerifier for Stage A test data,
  (2) a real embedding-based verifier (server-side preferred),
  (3) optional vendor service adapter with liveness support.

FUNCTIONAL REQUIREMENTS
1. Teacher creates an attendance session (class, start, duration). Backend returns a
   signed, short-lived QR payload: {session_id, rotating_token, expires_at}. The QR must
   contain NO student data, NO biometric data, NO secrets. Token rotates every 15-30 s.
2. Student logs in (JWT). Student ID is taken ONLY from the authenticated token.
3. Student scans QR -> POST /attendance/start. Backend validates session status, expiry,
   class membership, duplicates; returns a single-use challenge nonce (and liveness
   challenge if used).
4. Student completes face capture (CameraX). App checks face present, single face,
   adequate size/lighting/blur, then submits to POST /attendance/verify.
5. Backend compares live face with the enrolled template, checks liveness result,
   nonce validity, and re-validates session and duplicate status. Only then it inserts
   an attendance row bound to (student_id, session_id) with a server timestamp.
6. Enrollment flow: authenticated + identity-verified student, explicit consent screen,
   plain-language explanation of storage/processing/protection/deletion, multi-sample
   capture with quality checks, template stored encrypted, consent record saved.
7. Fallback: teacher-authorised manual verification for camera failure, accessibility
   needs, or false rejection. Requires reason, teacher ID, timestamp; flagged in reports.
8. Students may withdraw consent and request deletion of their face template.

SECURITY RULES (non-negotiable)
- Never trust a "face_verified = true" flag from the client.
- Never put biometric templates, keys, or credentials in the QR code or APK.
- UNIQUE(student_id, session_id) in the database to prevent duplicates (race-safe).
- Rate-limit verification attempts; cap retries per session (e.g., 3).
- Encrypt templates at rest with keys held outside the DB (KMS/secret manager).
- Store templates in a separate table/schema with restricted access and access logging.
- Do not log raw images or templates. Do not store raw selfies after verification
  unless the retention policy explicitly allows it.
- Use TLS everywhere; consider certificate pinning and Play Integrity attestation.

UI SCREENS
Login; Student home; QR scanner; Face enrollment + consent; Face verification;
Verification success/failure (with reason and retry); Face enrollment status;
Teacher session screen with QR; Teacher dashboard (present, face-verified, exception,
pending); Manual verification / exception screen; Admin enrollment and deletion tools.

DELIVERABLES
- Android project, backend project, SQL migrations, OpenAPI spec, README with setup,
  threat-model notes, and a test plan matching the testing checklist.
- Clear separation of "prototype" vs "production" components with TODOs for the latter.

BUILD IN STAGES
A) Prototype with mock verifier and test data.
B) Real face-verification integration (evaluate licence, Android support, cost,
   privacy, liveness support; document the decision).
C) Secure backend validation, duplicate prevention, server timestamps.
D) Testing: lighting, camera quality, angles, false rejections, spoof attempts,
   privacy protections, fallback workflow.
````

---

## 5. System Architecture

### 5.1 High-Level Diagram

```
┌──────────────────────┐        HTTPS/TLS         ┌───────────────────────────────┐
│   Android App        │ ───────────────────────► │         API Gateway           │
│  - Login             │                          │  (auth, rate limit, WAF)      │
│  - QR scanner        │                          └──────────────┬────────────────┘
│  - Face capture      │                                         │
│  - Liveness UI       │                          ┌──────────────▼────────────────┐
│  - Local quality     │                          │      Application Backend      │
│    checks            │                          │  Auth • Sessions • Attendance │
└──────────────────────┘                          │  Enrollment • Exceptions      │
                                                  └───┬───────────┬───────────┬───┘
                                                      │           │           │
                                       ┌──────────────▼──┐  ┌─────▼──────┐  ┌─▼──────────────────┐
                                       │ Main Database   │  │ Biometric  │  │ Face Verification  │
                                       │ users, classes, │  │ Store      │  │ Service            │
                                       │ sessions,       │  │ (separate, │  │ (in-house model or │
                                       │ attendance      │  │ encrypted) │  │ vendor w/ liveness)│
                                       └─────────────────┘  └─────┬──────┘  └────────────────────┘
                                                                  │
                                                          ┌───────▼────────┐
                                                          │ KMS / Secrets  │
                                                          └────────────────┘
```

### 5.2 Components

| Component | Responsibility |
|---|---|
| Android app | UI, QR scan, camera capture, local quality checks, secure token storage |
| API gateway | TLS termination, rate limiting, request size limits |
| Application backend | Business rules, authentication, session and attendance validation |
| Face verification service | Embedding extraction, comparison, liveness evaluation |
| Biometric store | Encrypted templates, consent records, deletion tracking, access logs |
| KMS / secret manager | Encryption keys, signing keys, service credentials |
| Audit log | Immutable record of enrollments, verifications, exceptions, deletions, data access |

### 5.3 Where Should Face Matching Run?

| Option | Pros | Cons |
|---|---|---|
| **Server-side matching (recommended)** | Result can be trusted; model/threshold updates without app release; central audit | Face data (image or embedding) leaves the device; needs server compute and privacy controls |
| On-device matching | Less data transmitted; works with weak connectivity | Client can be tampered with; template must live on device or be downloaded; backend cannot verify honestly without attestation |
| Hybrid (on-device quality + liveness prompts, server match) | Good UX and a trustworthy final decision | More engineering work |

**Recommendation:** hybrid. Do capture-quality checks on the device, and do the **identity decision on the server**. If on-device matching is ever used, treat it as advisory unless device attestation (Play Integrity) and signed results are enforced, and still re-verify server-side where possible.

### 5.4 QR Design

- Payload: `{ session_id, token, expires_at }`, signed (HMAC or JWT) by the server.
- Token rotates every 15–30 seconds; backend accepts the current and previous token only.
- The QR contains **no** student identity, templates, keys, or secrets.
- A screenshot forwarded to a friend expires quickly, and face verification binds the attempt to the logged-in student anyway.

### 5.5 Suggested Tech Stack

| Layer | Suggestion |
|---|---|
| Android | Kotlin, Jetpack Compose, CameraX, ML Kit Barcode Scanning, ML Kit / MediaPipe face detection |
| Backend | FastAPI or NestJS |
| Database | PostgreSQL (row-level security for biometric tables) |
| Cache | Redis for nonces and rotating tokens |
| Hosting | Institution-approved cloud or on-premise; consider data-residency requirements |
| Secrets | Cloud KMS / Vault |
| Observability | Structured logs (no biometric payloads), metrics, alerting |

---

## 6. Database Schema

PostgreSQL-style. Adjust names to your conventions.

```sql
-- ===== Core =====
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role             TEXT NOT NULL CHECK (role IN ('student','teacher','admin','biometric_officer')),
  college_id       TEXT UNIQUE NOT NULL,          -- roll number / employee ID
  full_name        TEXT NOT NULL,
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  identity_verified_at TIMESTAMPTZ,               -- set after college identity check
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE classes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  teacher_id  UUID NOT NULL REFERENCES users(id),
  term        TEXT NOT NULL
);

CREATE TABLE class_members (
  class_id    UUID REFERENCES classes(id) ON DELETE CASCADE,
  student_id  UUID REFERENCES users(id)   ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE attendance_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id           UUID NOT NULL REFERENCES classes(id),
  created_by         UUID NOT NULL REFERENCES users(id),
  starts_at          TIMESTAMPTZ NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('scheduled','open','closed','cancelled')),
  face_required      BOOLEAN NOT NULL DEFAULT TRUE,
  qr_secret_ref      TEXT NOT NULL,               -- reference to key in secret manager, NOT the key
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Attendance =====
CREATE TABLE attendance_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID NOT NULL REFERENCES users(id),
  session_id         UUID NOT NULL REFERENCES attendance_sessions(id),
  status             TEXT NOT NULL CHECK (status IN ('present','present_exception','rejected')),
  verification_method TEXT NOT NULL CHECK (verification_method IN ('qr_only','qr_face','manual_exception')),
  face_verification_id UUID,                      -- FK added below
  marked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),   -- SERVER time
  device_id_hash     TEXT,
  UNIQUE (student_id, session_id)                 -- duplicate prevention (race-safe)
);

CREATE TABLE attendance_attempts (                -- every try, including rejections
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID NOT NULL REFERENCES users(id),
  session_id    UUID NOT NULL REFERENCES attendance_sessions(id),
  nonce_hash    TEXT NOT NULL,
  result        TEXT NOT NULL,                    -- accepted / rejected
  reason_code   TEXT,                             -- see Section 7.3
  attempt_no    INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Biometric (keep in a separate schema with restricted DB roles) =====
CREATE SCHEMA biometric;

CREATE TABLE biometric.face_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL UNIQUE REFERENCES public.users(id),
  template_ciphertext BYTEA NOT NULL,             -- encrypted embedding, NOT an image
  key_version      TEXT NOT NULL,                 -- which KMS key encrypted it
  model_name       TEXT NOT NULL,
  model_version    TEXT NOT NULL,
  enrolled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  enrolled_by      UUID REFERENCES public.users(id),
  status           TEXT NOT NULL CHECK (status IN ('active','pending_review','revoked','deleted')),
  delete_after     TIMESTAMPTZ                    -- retention deadline
);

CREATE TABLE biometric.consent_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES public.users(id),
  consent_version  TEXT NOT NULL,                 -- version of the notice shown
  granted_at       TIMESTAMPTZ NOT NULL,
  withdrawn_at     TIMESTAMPTZ,
  purpose          TEXT NOT NULL DEFAULT 'attendance_verification'
);

CREATE TABLE biometric.verification_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID NOT NULL REFERENCES public.users(id),
  session_id       UUID NOT NULL REFERENCES public.attendance_sessions(id),
  match_score      REAL,                          -- keep only if policy allows
  threshold_used   REAL,
  liveness_passed  BOOLEAN,
  liveness_method  TEXT,
  decision         TEXT NOT NULL CHECK (decision IN ('match','no_match','low_quality','spoof_suspected','error')),
  verified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  purge_after      TIMESTAMPTZ NOT NULL           -- short retention
);

ALTER TABLE attendance_records
  ADD CONSTRAINT fk_face_verif FOREIGN KEY (face_verification_id)
  REFERENCES biometric.verification_results(id);

-- ===== Exceptions & enrollment support =====
CREATE TABLE attendance_exceptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID NOT NULL REFERENCES users(id),
  session_id     UUID NOT NULL REFERENCES attendance_sessions(id),
  approved_by    UUID NOT NULL REFERENCES users(id),     -- teacher
  reason_category TEXT NOT NULL CHECK (reason_category IN
                  ('camera_failure','accessibility','false_rejection','not_enrolled','other')),
  reason_note    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by    UUID REFERENCES users(id),
  reviewed_at    TIMESTAMPTZ
);

CREATE TABLE face_verification_opt_outs (          -- students who cannot / will not use face verification
  student_id     UUID PRIMARY KEY REFERENCES users(id),
  reason_category TEXT NOT NULL,
  approved_by    UUID NOT NULL REFERENCES users(id),
  alternative_method TEXT NOT NULL DEFAULT 'teacher_verified',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID,
  action      TEXT NOT NULL,                      -- e.g. 'template.read','enrollment.create','exception.approve'
  target_id   UUID,
  ip_address  INET,
  details     JSONB,                              -- never include raw biometric data
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX idx_attendance_session ON attendance_records(session_id);
CREATE INDEX idx_attempts_student_session ON attendance_attempts(student_id, session_id);
```

### Schema Notes

- Store **embeddings/templates, not photos**. Do not keep raw selfies after verification unless the retention policy explicitly allows it.
- The `biometric` schema should use a dedicated DB role. The general application role should not be able to `SELECT` from `face_templates`.
- Prefer a single backend service (the face-verification module) as the only reader of templates.
- `UNIQUE (student_id, session_id)` is what actually prevents duplicates under concurrent requests; do not rely only on an application-level check.

---

## 7. API Design

### 7.1 Endpoints

| Method | Endpoint | Actor | Purpose |
|---|---|---|---|
| POST | `/auth/login` | All | Obtain access and refresh tokens |
| POST | `/sessions` | Teacher | Create attendance session |
| GET | `/sessions/{id}/qr` | Teacher | Get current rotating QR payload |
| POST | `/sessions/{id}/close` | Teacher | Close session |
| POST | `/attendance/start` | Student | Validate scanned QR, issue challenge nonce |
| POST | `/attendance/verify` | Student | Submit face capture/liveness data for decision |
| GET | `/attendance/me` | Student | Own attendance history |
| GET | `/sessions/{id}/attendance` | Teacher | Live dashboard data |
| POST | `/attendance/exceptions` | Teacher | Create manual verification exception |
| POST | `/face/enrollment/consent` | Student | Record consent |
| POST | `/face/enrollment` | Student | Submit enrollment samples |
| GET | `/face/enrollment/status` | Student | Enrollment status |
| DELETE | `/face/enrollment` | Student/Admin | Withdraw consent and delete template |
| POST | `/face/enrollment/{id}/review` | Biometric officer | Approve / reject / re-enrol |

### 7.2 Server-Side Validation Order (`/attendance/verify`)

1. Authenticate JWT → derive `student_id` (**never accept `student_id` from the request body**).
2. Validate the nonce: exists, unused, belongs to this student and session, not expired.
3. Re-validate session: exists, status `open`, `now() < expires_at`.
4. Check class membership.
5. Check duplicate: existing record for `(student_id, session_id)`.
6. Check retry limit for this student and session.
7. Evaluate capture: quality gate → liveness result → match against the student's template.
8. Evaluate device integrity signal (if enabled).
9. In one DB transaction: consume nonce, insert verification result, insert attendance record (relying on the `UNIQUE` constraint).
10. Return result with a reason code. Timestamps come from the server.

### 7.3 Rejection Reason Codes

| Code | User-facing message |
|---|---|
| `SESSION_EXPIRED` | This attendance session has ended. |
| `SESSION_INVALID` | This QR code is not valid. Ask your teacher to refresh it. |
| `NOT_IN_CLASS` | You are not enrolled in this class. |
| `ALREADY_MARKED` | Your attendance is already recorded. |
| `FACE_NOT_ENROLLED` | Face enrollment is required. Open Enrollment to register. |
| `FACE_NOT_DETECTED` | No face found. Centre your face in the frame. |
| `MULTIPLE_FACES` | More than one face detected. Make sure only you are visible. |
| `LOW_QUALITY` | Image too dark, blurry or angled. Improve lighting and retry. |
| `LIVENESS_FAILED` | Live check not passed. Follow the on-screen prompts and retry. |
| `FACE_MISMATCH` | Face did not match. Retry, or ask your teacher for manual verification. |
| `RETRY_LIMIT` | Too many attempts. Ask your teacher for manual verification. |
| `DEVICE_UNTRUSTED` | This device could not be verified. Contact your teacher. |
| `CAMERA_DENIED` | Camera permission is required for face verification. |
| `SERVER_ERROR` | Something went wrong. Try again. |

Avoid revealing too much to an attacker: messages should be helpful to honest users without disclosing thresholds or exact scores.

---

## 8. Face Enrollment

### 8.1 Preconditions

- Student has an authenticated account.
- Student identity has been verified by the college (e.g., enrollment against college ID records or in-person verification by an authorised staff member). **Enrollment must not accept a face from an unverified account**, otherwise an impostor could enrol their own face under another student's ID.
- Student has viewed and accepted the current consent notice.

### 8.2 Consent Screen Content (plain language)

The consent screen must explain, in the student's language (English plus local language such as Telugu or Hindi, as appropriate):

- **What is collected:** face images captured during enrollment; a mathematical face template derived from them.
- **Why:** only to verify identity when marking attendance.
- **How it is processed:** where matching occurs (server/device/vendor), and whether any third party is involved.
- **How it is stored and protected:** encrypted, separate from general records, access limited and logged.
- **How long it is kept:** until graduation/withdrawal plus a stated period (see Section 11), then deleted.
- **Who can access it:** named roles only.
- **Your choices:** you may refuse or withdraw consent at any time and use the alternative verification method without penalty; you can request correction or deletion.
- **Contact:** the responsible officer for questions and complaints.

Consent must be **explicit and recorded** (no pre-ticked boxes), with the notice version saved. For students under 18, follow applicable rules on guardian consent. Refusing consent must not block the student from attending or being marked present through the alternative method.

### 8.3 Enrollment Flow

1. Login → Face Enrollment screen → read consent → accept (or decline and use alternative).
2. Identity check (matches a college-verified record; may be staff-assisted).
3. Guided capture of several samples (front, slight left/right, neutral expression) with live quality feedback.
4. Liveness check during enrollment (so enrollment itself is not spoofed).
5. Client uploads samples over TLS; server extracts the template, **discards raw images**, and stores the encrypted template.
6. Enrollment status becomes `active` (or `pending_review` if quality was marginal).

### 8.4 Correcting Errors and Handling Exceptions

| Situation | Process |
|---|---|
| Wrong person enrolled / poor-quality template | Student or officer requests re-enrollment; old template is revoked and deleted; new identity check required |
| Appearance change (glasses, beard, injury, hijab/head covering, ageing) | Re-enrol on request; no penalty |
| Student cannot use face verification (disability, medical, religious, device, or personal objection) | Officer approves opt-out; student uses teacher-verified attendance; no stigma recorded in teacher-facing screens beyond "alternative method" |
| Repeated false rejections | Flag for review; re-enrol; adjust threshold only through a documented, tested change |
| Lost / changed phone | Re-bind device; template stays server-side so re-enrollment is usually unnecessary |
| Consent withdrawn | Template deleted within the policy period; future attendance uses alternative method |

### 8.5 Data Minimisation Rules

- Keep templates only; discard raw enrollment images after template creation (unless a documented review window is required, in which case keep them short-lived and encrypted).
- Do not reuse face data for any purpose beyond attendance verification.
- Do not share face data with third parties except a named, contracted processor under a data-processing agreement.

---

## 9. Face Verification and Anti-Spoofing

### 9.1 Capture Pipeline (Android)

1. Check and request camera permission; handle "denied" and "denied permanently" gracefully.
2. Open the front camera with CameraX preview and image analysis.
3. Per-frame checks: exactly one face, face size and centring, head pose within limits, eyes open (if required), brightness, blur, no heavy occlusion.
4. Run the liveness challenge (Section 9.3).
5. Package the capture (frames or embedding, depending on the chosen architecture) and submit with the nonce.
6. Display the server's decision.

> Face **detection** (e.g., ML Kit) only reports that a face exists and where. It must be used for quality gating and guidance, **never as proof of identity**, and never as the sole reason to accept attendance.

### 9.2 Matching

- Convert the live face to an embedding with a face-recognition model, then compare with the enrolled template using a similarity/distance metric and a threshold.
- Choose the threshold from measured **FAR** (false accept rate) and **FRR** (false reject rate) on a representative sample of your own students and devices, not from a vendor's marketing number.
- Record the model name and version with each template so a model upgrade triggers re-enrollment where required.
- Re-evaluate performance across demographic groups; large disparities are a reason not to deploy.

### 9.3 Liveness / Anti-Spoofing

Common attack types: printed photo, photo on another phone/tablet screen, replayed video, 3D mask, injected camera feed (virtual camera / modified app), and a different real person standing in.

| Technique | Helps against | Weakness |
|---|---|---|
| Active challenge (blink, turn head, random prompt) | Static photos, simple replays | Defeated by pre-recorded or deepfake video that follows prompts; usability cost |
| Passive liveness (texture, depth, reflection, moiré analysis) | Printed photos, screen replays | Needs a trained model; quality varies |
| Randomised challenge-response bound to server nonce | Pre-recorded video replays | Real-time deepfakes |
| Vendor liveness service (document it, test it) | Broad presentation attacks | Cost, privacy, vendor dependence, still needs your own testing |
| Device integrity (Play Integrity API) | Modified apps, emulators, injected camera feeds | Not perfect; some legitimate devices fail |
| Server-side nonce + short time window | Replay of old captures | Does not stop live attacks |
| Rate limiting and anomaly detection (same device, many students) | Bulk proxy attendance | Needs monitoring |

Practical guidance:

- Start with **active randomised challenges + server nonce + device integrity**, and treat them as *basic* protection, not certified liveness.
- For anything beyond a pilot, evaluate a liveness solution that has **independent presentation-attack-detection evaluation** (e.g., results against ISO/IEC 30107-3 testing) or run your own structured spoof-test campaign (Section 14).
- Remember the app can only see what the camera API gives it. Consider that an attacker may bypass the real camera on a compromised device.

### 9.4 Retry Policy

- Maximum **3 attempts** per student per session, with a short cooldown between attempts.
- After each failure, show the specific actionable cause (lighting, angle, look at camera).
- After the limit, offer "Request teacher verification" instead of unlimited retries.
- Log every attempt; alert on unusual patterns (many failures from one device, or one device verifying several students).

### 9.5 Teacher-Authorised Fallback

Used for camera failure, accessibility needs, and false rejections.

1. Student selects "Request manual verification" (or teacher initiates).
2. Teacher confirms the student's identity in person (visual check against class, college ID, etc.).
3. Teacher picks a reason category and optionally adds a note.
4. System records `present_exception` with `verification_method = manual_exception`, teacher ID, and server timestamp.
5. Exceptions are visible in the dashboard and in an admin report; unusually high exception rates per teacher or class are flagged for review.

### 9.6 Choosing a Face-Verification Solution (Stage B Evaluation)

Evaluate each candidate against this table before committing:

| Criterion | Questions to answer |
|---|---|
| Licence | Is the model/SDK licence compatible with educational/commercial use? Some open pretrained face models and datasets carry **non-commercial or research-only** terms; check both the code and the training-data terms. |
| Android compatibility | Min SDK, ABI support (arm64-v8a), model size, inference time on low-end phones |
| Accuracy | Published benchmarks plus **your own** evaluation on target students/devices |
| Liveness | Built in? Passive/active? Independent test evidence? |
| Cost | Per-verification pricing, free tier, volume at your class sizes (e.g., students × sessions per day) |
| Privacy | Where is data processed and stored? Is it retained or used for vendor training? Data-processing agreement? Regional hosting? |
| Operational | Latency, uptime, offline behaviour, support, SDK maintenance |
| Exit plan | Can you migrate templates if you change vendor? (Many templates are model-specific; re-enrollment may be needed.) |

Candidate categories (verify current terms, pricing and availability before choosing):

- **On-device models** (e.g., TensorFlow Lite embedding models) — lowest data transfer; accuracy and licence must be verified; liveness must be added separately.
- **Self-hosted server models** (open-source recognition frameworks) — full control; you own compute, security, and testing.
- **Cloud face verification/liveness services** from major cloud providers or specialist identity vendors — faster to reach acceptable liveness; ongoing cost and third-party data handling.

Document the decision, evidence, and rejected alternatives in the repository.

---

## 10. Security Requirements

### 10.1 Identity and Access

- Authenticated **Student ID is authoritative**, taken from the server-validated token only.
- Bind attendance to the unique pair **(Student ID, Session ID)**; enforce with a DB unique constraint.
- Role-based access control: students see only their own data; teachers only their classes; admins manage but do not routinely view biometrics.
- Short-lived access tokens, refresh token rotation, logout/revocation, optional MFA for staff accounts.

### 10.2 Backend Validation (mandatory)

- Session token validity, session status, expiry, class membership, duplicate status.
- Single-use, student-bound, session-bound nonces with short TTL.
- Server-generated timestamps only; ignore client time.
- **Never accept a client-sent "face verified" flag.** The decision comes from server-side comparison or a server-verified, signed result from a trusted verification service.

### 10.3 Data Protection

- TLS 1.2+ everywhere; consider certificate pinning in the app.
- Encrypt templates at rest with keys in KMS/Vault; support key rotation (`key_version`).
- Separate biometric schema, dedicated DB role, least-privilege access, access logging.
- Do not log images, templates, tokens, or secrets. Scrub crash reports.
- Backups containing biometric data are encrypted and follow the same retention/deletion rules.

### 10.4 Secrets and the QR Code / APK

- **Never** place biometric templates, private keys, service-account credentials, API secrets, or signing keys in the QR code or in the APK.
- Assume the APK can be decompiled; the app holds only public configuration and user-scoped tokens.
- QR contains only `session_id`, a rotating signed token, and expiry.
- Vendor API keys live on the backend, never in the app.

### 10.5 App Hardening

- Play Integrity API (or equivalent) verdict checked server-side.
- Detect rooted devices/emulators/debuggers and treat as higher risk (flag rather than silently reject, to avoid unfairly blocking students).
- R8/ProGuard obfuscation (helpful but not a security boundary).
- Store tokens in Android Keystore-backed storage; disable screenshots on enrollment/verification screens (`FLAG_SECURE`).

### 10.6 Abuse Controls

- Rate limiting per student, per device, per IP.
- Detect one device verifying multiple students or one student on many devices in one session.
- Alerting on spikes of `LIVENESS_FAILED`, `FACE_MISMATCH`, or `DEVICE_UNTRUSTED`.

### 10.7 Threat Model Summary

| Threat | Mitigation |
|---|---|
| Student forwards QR to absent friend | Rotating QR, login binding, face verification, optional geofence/Wi-Fi hint |
| Friend marks attendance using the student's login | Face verification against the account holder's template |
| Printed photo / screen replay | Liveness, challenge-response, nonce, quality checks |
| Modified APK sends fake "verified" result | Server-side decision, Play Integrity, signed requests |
| Template theft from DB | Encryption, key separation, access logging, minimal retention |
| Insider access to biometrics | Restricted roles, audit logs, periodic access review |
| Enrollment with someone else's face | Identity-verified, possibly staff-assisted enrollment |
| Duplicate / race-condition submissions | DB unique constraint, transactions, nonce consumption |
| Replay of old verification requests | Single-use nonce, short expiry |
| Mass false rejection / unfair outcomes | Fallback workflow, threshold review, fairness testing |

---

## 11. Privacy, Consent and Data Retention Policy

> This section is a **starting template**, not legal advice. Have the college's legal/compliance team review it against applicable law (for India, this includes the Digital Personal Data Protection Act, 2023 and its rules, plus any university or regulator guidance) before collecting any real facial data.

### 11.1 Principles

1. **Purpose limitation** — face data used only for attendance verification.
2. **Data minimisation** — templates, not photos; only what is needed.
3. **Consent and choice** — explicit, recorded, withdrawable; a non-biometric alternative always exists.
4. **Security** — encryption, access control, auditing.
5. **Transparency** — students can see their enrollment status and policy at any time.
6. **Accountability** — named responsible officer, periodic review, incident response plan.

### 11.2 Retention Schedule (example — set your own)

| Data | Retention |
|---|---|
| Raw enrollment images | Deleted immediately after template creation (or ≤ 24 h if a review window is needed) |
| Raw verification captures | Not stored; processed in memory and discarded |
| Face template | Until consent withdrawal, graduation, or leaving the college, then deleted within 30 days |
| Verification result records (decision, liveness, time) | 90 days, then purge or reduce to a non-biometric summary |
| Match scores | Keep only if needed for tuning; max 90 days |
| Consent records | Retained as proof for the period required by law/policy |
| Audit logs (no biometric content) | 1–3 years |
| Backups | Rotate out within the same deletion window |

### 11.3 Student Rights Supported by the System

- View enrollment status and the consent notice version accepted.
- Request correction (re-enrollment).
- Withdraw consent and request deletion (self-service button plus officer workflow).
- Use an alternative verification method without penalty.
- Lodge a complaint with the named officer.

### 11.4 Incident Response

Define steps for suspected breach: contain, assess, notify the responsible authority and affected students as required, rotate keys, review logs, and document lessons learned.

### 11.5 Governance Checklist

- [ ] Institutional approval for biometric use
- [ ] Data protection impact assessment (DPIA) completed
- [ ] Privacy notice and consent text approved
- [ ] Vendor data-processing agreement (if any)
- [ ] Retention and deletion jobs automated and tested
- [ ] Access review schedule defined
- [ ] Alternative method communicated to all students

---

## 12. UI Design

### 12.1 Screen List

| # | Screen | Actor | Key elements |
|---|---|---|---|
| 1 | Login | All | Student/teacher login, forgot password |
| 2 | Student Home | Student | Scan QR button, today's classes, enrollment status banner, attendance summary |
| 3 | QR Scanner | Student | Camera preview, scan frame, torch toggle, permission handling |
| 4 | **Face Enrollment and Consent** | Student | Consent text (versioned), checkboxes, "Decline and use alternative", identity-check step, guided capture with quality feedback |
| 5 | **Face Verification (during attendance)** | Student | Oval face guide, live quality hints (lighting, distance, angle), liveness prompts, attempt counter, cancel |
| 6 | **Verification Success / Failure** | Student | Success: class, time, method. Failure: clear reason code message, "Try again" (until limit), "Request teacher verification" |
| 7 | **Face Enrollment Status** | Student | Status (not enrolled / pending / active / revoked), enrolled date, policy link, re-enrol, withdraw consent and delete |
| 8 | Teacher Session Screen | Teacher | Create session, large rotating QR, countdown, live count, close session |
| 9 | **Teacher Attendance Dashboard** | Teacher | Student list with: Present (face verified), Present (exception), Pending, Rejected; filters; verification-completed indicator; export |
| 10 | **Manual Verification / Exception Handling** | Teacher | Student selector, reason category, optional note, confirm identity checkbox, submit; audit notice |
| 11 | Admin / Biometric Officer Console | Admin | Enrollment queue, deletion requests, opt-outs, audit log search, retention status |
| 12 | Settings & Privacy | All | Privacy notice, consent history, data deletion request |

### 12.2 Teacher Dashboard Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│ CS201 – Data Structures        Session: OPEN   08:58 left   │
├─────────────────────────────────────────────────────────────┤
│ Present: 48   Face-verified: 45   Exceptions: 3   Pending: 9│
├─────────────────────────────────────────────────────────────┤
│ Roll No.  Name           Status                Method       │
│ 21CS001   A. Kumar       ● Present             QR + Face    │
│ 21CS002   B. Reddy       ● Present             QR + Face    │
│ 21CS003   C. Sharma      ◐ Present (exception) Manual – cam │
│ 21CS004   D. Rao         ○ Pending             —            │
│ 21CS005   E. Khan        ✕ Rejected            Face mismatch│
├─────────────────────────────────────────────────────────────┤
│ [Verify manually]  [Export]  [Close session]                │
└─────────────────────────────────────────────────────────────┘
```

### 12.3 Verification Screen Behaviour

- Show the camera preview in a circular/oval guide.
- Real-time hints: "Move closer", "Find better lighting", "Look straight at the camera", "Remove mask/sunglasses if possible".
- Randomised liveness prompt (e.g., "Turn your head slowly left").
- Progress and attempt count (e.g., "Attempt 2 of 3").
- Never show match scores or thresholds to the student.

### 12.4 Accessibility and Inclusion

- Screen-reader labels, large touch targets, sufficient contrast.
- Voice/haptic cues for visually impaired students; always provide the teacher-verified alternative.
- Support multiple languages (English plus local languages).
- Do not require students with disabilities to prove the disability inside the app; let the teacher or officer record "accessibility" as a category.

---

## 13. Development Roadmap

### 13.1 Base QR Attendance (Phases 1–4)

| Phase | Duration (est.) | Deliverables |
|---|---|---|
| **Phase 1 – Foundations** | 1–2 weeks | Requirements, user roles, DB schema, project setup, authentication |
| **Phase 2 – Core QR attendance** | 2–3 weeks | Session creation, rotating signed QR, QR scanning, attendance recording, duplicate prevention |
| **Phase 3 – Dashboards & reports** | 1–2 weeks | Teacher dashboard, student history, CSV export |
| **Phase 4 – Hardening & pilot** | 1–2 weeks | Rate limiting, error handling, one-class pilot, feedback |

### 13.2 Face-Authentication Add-On (Stages A–D)

#### Stage A — Prototype (≈ 2–3 weeks)

**Goal:** demonstrate the whole flow end to end using test data, with a mock verifier.

- [ ] QR scanning and student authentication integrated
- [ ] Camera permission handling (grant, deny, permanently deny, settings deep-link)
- [ ] Face-verification UI with quality hints and mock liveness prompts
- [ ] `MockFaceVerifier` returning configurable match/no-match results
- [ ] Enrollment and consent screens (UI only, test data)
- [ ] Teacher dashboard shows verification column
- [ ] Manual exception screen (UI + basic endpoint)

**Exit criteria:** team can demo scan → face step → recorded attendance using **test accounts only**. Label clearly as *prototype — not secure*.

#### Stage B — Face Verification Integration (≈ 3–5 weeks)

**Goal:** choose and integrate a real verification approach.

- [ ] Run the evaluation in Section 9.6 (licence, Android compatibility, cost, privacy, liveness)
- [ ] Record the decision (ADR document)
- [ ] Implement `FaceVerifier` with the chosen model/service
- [ ] Implement enrollment pipeline (multi-sample, template extraction, encryption)
- [ ] Add liveness (active challenge baseline; vendor/passive if selected)
- [ ] Measure FAR/FRR on a small consented pilot group; select an initial threshold
- [ ] Start DPIA and consent-notice review in parallel

**Exit criteria:** real matching works on pilot devices with documented accuracy numbers; liveness approach and limits documented.

#### Stage C — Secure Attendance (≈ 2–4 weeks)

**Goal:** make the backend the source of truth.

- [ ] `/attendance/start` and `/attendance/verify` implemented per Section 7.2
- [ ] Single-use nonces, short TTL, student/session binding
- [ ] Server-side match decision; client flags ignored
- [ ] `UNIQUE(student_id, session_id)` and transactional insert
- [ ] Server-generated timestamps
- [ ] Retry limits, cooldowns, rate limiting
- [ ] Play Integrity verification (server-side)
- [ ] Encrypted template storage with KMS keys; biometric schema/role separation
- [ ] Audit logging and access control on biometric endpoints
- [ ] Retention/deletion jobs; self-service deletion

**Exit criteria:** all backend-bypass tests in Section 14 are rejected.

#### Stage D — Testing and Pilot (≈ 3–4 weeks)

**Goal:** test against real conditions and threats before any wider rollout.

- [ ] Lighting, camera quality, pose, accessories (glasses, mask, head covering), time-of-day tests
- [ ] False reject and false accept measurement across a representative group
- [ ] Spoof campaign: printed photo, screen replay, recorded video, other-person, injected feed
- [ ] Privacy tests: access control, deletion, log scrubbing
- [ ] Fallback workflow trial with teachers
- [ ] Load test for a large class marking attendance in a short window
- [ ] Security review / penetration test
- [ ] Pilot with 1–3 classes; gather feedback; fix issues
- [ ] Go / no-go review with college leadership and data-protection officer

**Exit criteria:** documented test report; residual risks accepted in writing; fallback and deletion processes proven.

### 13.3 Indicative Timeline

```
Month 1        Month 2         Month 3          Month 4          Month 5
|--Phases 1-2--|--Phases 3-4---|                |                |
               |---Stage A-----|                |                |
                               |-----Stage B-------|             |
                                        |-----Stage C-----|      |
                                                      |----Stage D + Pilot----|
```

Estimates assume a small team (1–2 Android devs, 1 backend dev, part-time QA/security). Reliable liveness detection and thorough spoof testing can extend this significantly or require paid services.

### 13.4 Milestones

| Milestone | Definition |
|---|---|
| M1 | QR attendance working in one class (no face) |
| M2 | Face prototype demo with mock verifier |
| M3 | Real face matching with documented accuracy on pilot data |
| M4 | Backend-enforced verification; bypass tests pass |
| M5 | Spoof/privacy/fallback testing complete and reviewed |
| M6 | Controlled pilot, then go/no-go decision |

---

## 14. Testing Checklist

Mark each item with date, tester, device, and result. Record failures as defects with severity.

### 14.1 Functional

- [ ] Correct student face + valid session → attendance recorded
- [ ] Wrong student's face (another enrolled student) → rejected (`FACE_MISMATCH`)
- [ ] Student not enrolled for face → guided to enrollment or fallback
- [ ] QR scan **without** successful face verification → no attendance recorded
- [ ] Duplicate attendance attempts (same device, second device, rapid double-tap, concurrent requests) → single record only
- [ ] Expired session QR → `SESSION_EXPIRED`
- [ ] Invalid / tampered / old rotated QR token → `SESSION_INVALID`
- [ ] Student not in the class → `NOT_IN_CLASS`
- [ ] Closed or cancelled session → rejected
- [ ] Server timestamp used (change phone clock; recorded time unaffected)

### 14.2 Face Quality and Accuracy

- [ ] Bright light, dim light, backlit, mixed lighting, classroom corridor
- [ ] Low-end vs high-end phone cameras, dirty/scratched lens
- [ ] Face angles (frontal, ±15°, ±30°), distance (near, far)
- [ ] Glasses, sunglasses, mask, cap, head covering, beard changes, makeup
- [ ] Different skin tones, genders, and age ranges in the pilot group (fairness check)
- [ ] Poor lighting and failed matching → clear message and retry guidance
- [ ] False reject rate (FRR) measured and within agreed target
- [ ] False accept rate (FAR) measured using impostor attempts and within agreed target
- [ ] Twins/siblings or look-alikes (if available) tested and documented
- [ ] Retry limit enforced; cooldown works; fallback offered afterwards

### 14.3 Spoofing / Presentation Attacks

- [ ] Printed photo (colour, black-and-white, high resolution)
- [ ] Photo displayed on a phone/tablet screen
- [ ] Pre-recorded video replay on a screen
- [ ] Video that follows randomised challenge prompts (if feasible)
- [ ] Cut-out / mask-style attacks (as feasible)
- [ ] Virtual camera / emulator / injected camera feed
- [ ] Replay of an old captured request (reused nonce)
- [ ] Record each attack's result honestly: blocked / detected / **passed** (and fix or document residual risk)

### 14.4 Permissions, Camera, and Fallback

- [ ] Camera permission denied → helpful screen with option to retry or request teacher verification
- [ ] Camera permission permanently denied → settings deep-link
- [ ] Camera hardware failure / camera in use by another app
- [ ] Teacher manual verification flow works, is logged, and appears in the dashboard
- [ ] Accessibility scenario (e.g., student who cannot perform face verification) completes without friction or disclosure
- [ ] Opt-out students marked present via alternative method correctly

### 14.5 Enrollment, Deletion, and Privacy

- [ ] Enrollment requires authenticated, identity-verified account
- [ ] Enrollment blocked without recorded consent; consent version stored
- [ ] Declining consent leaves attendance available through alternative method
- [ ] Poor-quality enrollment rejected with guidance
- [ ] Re-enrollment replaces and securely deletes the old template
- [ ] Withdraw consent / delete → template removed from primary store; backup expiry verified
- [ ] Retention jobs purge verification records per policy
- [ ] Raw images not retained after processing (verify in storage and logs)
- [ ] Logs, crash reports, and analytics contain no images/templates/tokens

### 14.6 Security and Bypass

- [ ] Unauthorized access to biometric data: student A cannot access student B's template or results; students cannot read any template
- [ ] Teacher cannot read templates; only the designated service/role can
- [ ] Direct DB role test: general app role cannot `SELECT` from biometric tables
- [ ] Backend rejects a client that sends `face_verified=true` without a valid server-side decision
- [ ] Backend rejects requests with modified `student_id` in the body (identity comes from token only)
- [ ] Backend rejects forged/expired/reused nonces
- [ ] Modified or repackaged APK rejected or flagged via integrity check
- [ ] API calls made directly (curl/Postman) without going through the app are rejected unless fully valid
- [ ] Rate limits and lockouts function; no user enumeration via error messages
- [ ] TLS configuration verified; no secrets found in APK (decompile and search)
- [ ] QR code content inspected: no biometric data, keys, or student identity
- [ ] Encryption at rest and key rotation tested
- [ ] Audit log records template access, enrollment, deletion, and exceptions

### 14.7 Performance and Reliability

- [ ] 100–200 students verifying within a few minutes: acceptable latency and no failures
- [ ] Poor network / network drop during verification → clean failure, safe retry, no duplicate record
- [ ] Verification service outage → clear message and teacher fallback
- [ ] Battery and device thermals acceptable during repeated camera use

### 14.8 Acceptance

- [ ] Test report completed and reviewed
- [ ] Residual risks documented and accepted by the responsible owner
- [ ] **Security claims in documentation match test evidence** (no unverified "secure" claims)

---

## 15. Risks and Open Decisions

| Risk / Decision | Notes | Owner |
|---|---|---|
| Liveness effectiveness | May need a paid or specialist service; open-source baseline is unlikely to be sufficient against determined attackers | Tech lead |
| Legal / consent compliance | Needs legal review; biometric data is sensitive | College admin / DPO |
| Model/licence restrictions | Verify code and training-data licences before shipping | Tech lead |
| Fairness and accuracy | Test across your student population; document results | QA |
| Cost at scale | Per-verification fees multiply by students × sessions | Project manager |
| Student trust and acceptance | Communicate purpose, alternatives, and deletion rights early | College admin |
| Compromised devices | Integrity checks help but are not absolute | Security lead |
| Threshold tuning | Changing thresholds alters FAR/FRR; require tested change process | Tech lead |
| Alternative-method abuse | Monitor exception rates; require reasons and review | Admin |
| Open decision: server vs on-device matching | Recommended: server-side final decision (Section 5.3) | Architecture review |
| Open decision: vendor vs self-hosted | Decide after Stage B evaluation | Steering group |

---

## 16. Future Improvements

- Certified passive liveness (independently tested presentation-attack detection).
- Multi-factor attendance signals: Bluetooth/Wi-Fi proximity or classroom beacons, optional geofencing (privacy-reviewed).
- Teacher-side "scan the room" mode as an alternative to student self-service, with explicit consent.
- Offline-tolerant mode with signed, deferred verification.
- Template protection techniques (e.g., cancelable biometrics, secure enclaves / confidential computing).
- Federated or on-device learning approaches to reduce central biometric storage.
- Adaptive thresholds by quality score, with fairness monitoring.
- Analytics: attendance trends, at-risk alerts (without using biometric data).
- Integration with LMS/ERP and timetable systems.
- iOS app and web admin portal.
- Automated bias and drift monitoring for the face model.
- Periodic re-enrollment prompts for long programmes (appearance changes).
- Independent security audit and pen-test cadence.
- Wearable / NFC ID-card alternative for students who prefer no biometrics.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| **Face detection** | Finding whether and where a face appears in an image; does not identify anyone |
| **Face verification (1:1)** | Checking whether a live face matches one claimed identity's enrolled template |
| **Face template / embedding** | Numeric representation of a face derived from images |
| **Liveness / PAD** | Checking that the face belongs to a live person present at capture, not a photo, replay, or mask |
| **Presentation attack** | Spoof attempt using a photo, video, or mask |
| **FAR / FRR** | False Accept Rate / False Reject Rate |
| **Nonce** | One-time value that prevents replay of old requests |
| **KMS** | Key Management Service for encryption keys |
| **Play Integrity** | Google API that provides signals on app and device integrity |
| **DPIA** | Data Protection Impact Assessment |
| **ADR** | Architecture Decision Record |

---

### Final Reminder

This document describes a **plan**. A working demo of face-assisted attendance is achievable relatively quickly, but a **production-grade biometric attendance system** needs extra development time, evaluated models or services (possibly paid), legal and privacy review, and structured testing against the threats above. **Do not claim the system is secure until the chosen implementation has passed that testing.**
