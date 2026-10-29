# Free deployment for the college demo (Render + Neon + Expo)

Result: a public **HTTPS** API (`https://qr-attendance-api-xxxx.onrender.com`) and an **APK** that any Android
phone can install, so the demo works on college Wi-Fi or mobile data.

| Part | Service | Free tier limits |
|---|---|---|
| Database | Neon Postgres | 0.5 GB storage; compute sleeps when idle (wakes in ~1 s) |
| Backend | Render web service (Docker) | 512 MB RAM (app uses ~275 MB); **sleeps after 15 min idle, first request then takes ~1 min** |
| APK | Expo EAS Build | Free builds, queued (~10–20 min) |

Time needed: ~45 minutes the first time.

---

## 1. Put the code on GitHub (private repo)

Render deploys from a Git repo. Make it **private** – it contains the app code (not secrets; `.env` files are gitignored).

```bash
cd "D:\learning\attendance project"
git init
git add .
git status            # check: NO .env, backend/.venv, models/*.onnx, node_modules
git commit -m "QR attendance app"
gh repo create qr-attendance --private --source . --push
```

## 2. Create the database (Neon)

1. Sign up at <https://neon.tech> (GitHub login is fine) → **New project** → name `qr-attendance`,
   region **AWS Asia Pacific (Singapore)** (closest to India), Postgres 16.
2. Dashboard → **Connect** → turn **Connection pooling OFF** → copy the connection string. It looks like
   `postgresql://neondb_owner:XXXX@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. Keep it secret (it is the database password).

## 3. Create tables and demo accounts in Neon (from your PC)

```bash
cd "D:\learning\attendance project\backend"
set DATABASE_URL=<paste the Neon connection string>
.venv\Scripts\alembic upgrade head
.venv\Scripts\python -m app.seed demo --password "<choose a NEW demo password>"
set DATABASE_URL=
```

Use a different password from the local one — this URL will be public. (For a real deployment create only an
admin: `python -m app.seed admin --college-id ADM001 --email ... --name ...`.)

## 4. Generate the face-template encryption key

```bash
python -c "import secrets,base64;print('v1:'+base64.b64encode(secrets.token_bytes(32)).decode())"
```

Copy the output (starts with `v1:`). **Save it in a password manager** — if it is lost, all enrolled faces must re-enrol.

## 5. Deploy the backend (Render)

1. Sign up at <https://render.com> with GitHub and allow access to the `qr-attendance` repo.
2. **New → Blueprint** → choose the repo. Render reads `render.yaml`.
3. It asks for the two secret values:
   - `DATABASE_URL` → the Neon string from step 2
   - `TEMPLATE_KEYS` → the `v1:...` value from step 4
   (JWT/QR/device keys are generated automatically.)
4. **Apply**. The first build takes ~8–10 minutes (it downloads the face models).
5. When it shows **Live**, open `https://<your-service>.onrender.com/api/health` → `{"ok":true,"face_verifier":"sface"}`.

## 6. Build the APK pointing at Render

1. Edit `mobile/eas.json` → `production.env.EXPO_PUBLIC_API_URL` = `https://<your-service>.onrender.com`
2. Build:

```bash
cd "D:\learning\attendance project\mobile"
npx eas-cli@latest login            # free account at expo.dev
npx eas-cli@latest build -p android --profile production
```

3. When finished, the terminal prints a link (also on expo.dev → project → Builds). Open it on each Android phone,
   download the `.apk`, allow "install unknown apps", install **QR Attendance**.

(Quick alternative without an APK: set `mobile/.env` `EXPO_PUBLIC_API_URL=https://<your-service>.onrender.com`,
run `npx expo start`, open in Expo Go.)

## 7. On demo day

- **5 minutes before**, open `https://<your-service>.onrender.com/api/health` in a browser to wake the server.
- Teacher phone: `T1001` → CS201 → keep **Restrict to classroom location** on (100 m) → Start session.
  Allow location access when asked; stand inside the room.
- Student phone: `21CS001` → Face enrollment → Scan QR (allow camera + location).
- Show a rejection: student phone with location off, or from another building → "You do not appear to be in the
  classroom" → **Request teacher verification** → teacher approves from the dashboard.
- After the demo: change the demo passwords (Admin → Users → Reset password) or deactivate the accounts.

## Troubleshooting

| Problem | Fix |
|---|---|
| App says "Cannot reach the server" | Server is waking up – wait 60 s and retry; check `/api/health` |
| Render build fails on models download | Redeploy (GitHub download hiccup); checksums are pinned |
| `LOCATION_INACCURATE` indoors | Turn on "high accuracy"/Google location accuracy, stand near a window, or use 200 m radius |
| Correct head turns fail "Live check" | Add env var `LIVENESS_YAW_SIGN=-1` in Render → redeploy |
| Out of memory on Render | Confirm `FACE_POOL_SIZE=1` |

## Honest limits of this demo setup

Free tiers are for demos, not production attendance: Render sleeps, there is no uptime guarantee, and data
is on third-party servers (do not enrol real students' faces without the consent/legal steps in the README).
Location can be faked by a determined user with a rooted phone or modified app; mock-location apps are detected.
