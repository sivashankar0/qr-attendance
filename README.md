# College QR Attendance

QR-based class attendance with **server-side face-assisted verification**, built from
`QR_Attendance_APK_Roadmap (1).md`.

- **mobile/** – one Android/iOS app (React Native + Expo SDK 58) for students, teachers, admins and biometric officers.
- **backend/** – FastAPI + PostgreSQL 16 + OpenCV YuNet/SFace face verification.

> Status: feature-complete for a **controlled pilot**. Describe it as *face-assisted attendance verification*,
> not "secure" or "spoof-proof", until the manual tests in [docs/TEST_PLAN.md](docs/TEST_PLAN.md) are done.
> See [docs/ADR-001-face-verification.md](docs/ADR-001-face-verification.md) for liveness limits.

## What it does

| Role | In the app |
|---|---|
| Student | Log in · enrol face with explicit, versioned consent (or decline → teacher verification) · scan rotating QR · face check with random head-turn prompt · see result + reason · request teacher verification · attendance history and % per class · withdraw consent & delete face data |
| Teacher | My classes · start session (duration, face required, **restrict to classroom location** 50/100/200 m) · full-screen rotating QR (20 s) with countdown and live counts · live dashboard (present / exception / pending / rejected, requests, shared-phone flag) · manual verification with reason + identity confirmation · close session · export CSV |
| Admin | Users (create, CSV import, identity verification, password reset, deactivate) · classes & members · exception-rate report · retention job · audit log |
| Biometric officer | Enrollment review queue, template deletion, opt-outs (alternative method), audit log |

Security highlights: student identity only from the JWT · **classroom geofence** (teacher's GPS at session start + radius; mock locations rejected; student coordinates never stored) · signed rotating QR (no student data/secrets) · single-use,
student/session-bound nonces · server-only match + liveness decision (client flags rejected) · `UNIQUE(student_id,
session_id)` · server timestamps · 3 attempts + cooldown · rate limits + account lockout · refresh-token rotation
with reuse detection · AES-256-GCM templates in a separate `biometric` schema, no raw images stored · audit log ·
retention job · FLAG_SECURE on face screens · tokens in Keystore-backed SecureStore.

## Run it locally (Windows, ~10 min)

Prereqs: Docker Desktop, Python 3.10+, Node 20+, an Android phone with **Expo Go** (Play Store) on the same Wi-Fi.

```bash
# 1. Database (first time: create .env with POSTGRES_PASSWORD – see below)
docker compose up -d db

# 2. Backend
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python scripts\download_models.py        # YuNet + SFace (~39 MB, SHA-256 pinned)
copy .env.example .env                                  # then fill in secrets (see file)
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.seed demo --password "Demo@2026pass"   # TEST accounts only
.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers

# 3. Mobile
cd ..\mobile
npm install
copy .env.example .env          # set EXPO_PUBLIC_API_URL=http://<your PC LAN IP>:8000
npx expo start                  # scan the QR with Expo Go
```

Root `.env` (used by docker compose): `POSTGRES_DB=attendance`, `POSTGRES_USER=attendance`, `POSTGRES_PASSWORD=<random>`.
Allow port 8000 through Windows Firewall for private networks if the phone can't connect.

**Demo accounts** (password `Demo@2026pass`, college ID as username): `ADM001` admin · `BIO001` biometric officer ·
`T1001`, `T1002` teachers · `21CS001` … `21CS008` students (identity-verified). Classes CS201, CS305.

**Demo flow:** log in as `T1001` on one phone/tablet → CS201 → Start session. On a second phone log in as `21CS001` →
Face enrollment → accept consent → capture → back → Scan QR → follow the head-turn prompt.

API docs (non-production): `http://<host>:8000/api/docs`.

**Free public deployment for a college demo (Render + Neon): see [docs/DEPLOY_FREE.md](docs/DEPLOY_FREE.md).**

## Build the APK

Expo's cloud build (no Android Studio needed; needs a free Expo account):

```bash
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile pilot        # LAN http API (edit URL in eas.json)
npx eas-cli@latest build -p android --profile production   # https API – edit URL in eas.json first
```

The `pilot` profile allows cleartext HTTP only because its URL is `http://` (see `app.config.ts`). Production must use HTTPS.
Local build alternative: install Android Studio + JDK 17, then `npx expo run:android --variant release`.

## Tests

```bash
cd backend
.venv\Scripts\python -m pytest -q      # needs the db container running; creates/drops attendance_test
cd ..\mobile
npx tsc --noEmit && npx expo lint
```

## Production deployment checklist

1. Host the API behind a TLS reverse proxy (nginx/Caddy); `docker compose --profile prod up -d --build` runs
   Postgres + API (migrations run on start).
2. `ENVIRONMENT=production`, fresh secrets from a secret manager/KMS (never reuse dev `.env`), strong `POSTGRES_PASSWORD`.
3. Create the first admin: `python -m app.seed admin --college-id ADM001 --email admin@college.edu --name "Admin"`.
   Do **not** run `seed demo` in production (it refuses).
4. More than one API worker → `RATE_LIMIT_STORAGE=redis://...`.
5. Point `production` profile in `mobile/eas.json` at the HTTPS URL and build.
6. Before collecting real faces: legal/DPO review of `backend/app/consent.py` (DPDP Act 2023), DPIA,
   institutional approval, pilot FAR/FRR measurement and threshold tuning, spoof test campaign.
7. Encrypted backups that follow the same deletion window; access review for the DB owner role.

## Not yet implemented (by design for this release)

Play Integrity attestation · certified/passive liveness · Redis nonce store (Postgres is used) · multilingual UI
(English only; notice text is centralised for translation) · iOS build/testing · PDF export.

## Layout

```
backend/
  app/main.py              FastAPI app, error handling, security headers, retention loop
  app/routers/             auth, attendance (student), enrollment, sessions (teacher), admin
  app/services/attendance.py   validation order (roadmap 7.2)
  app/services/qr.py           rotating HMAC QR tokens
  app/services/face/           verifier (SFace / mock) + decisions + encrypted template store
  app/models.py, alembic/      schema (biometric schema separated)
  app/services/geo.py          classroom geofence check
  tests/                       48 tests
mobile/src/
  app/student|teacher|admin/   screens (expo-router)
  components/FaceCapture.tsx   guided capture with oval + prompts
  lib/api.ts                   bearer auth, refresh rotation, device id
docs/                          ADR, test plan
```
