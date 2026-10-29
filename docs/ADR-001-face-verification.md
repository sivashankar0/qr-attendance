# ADR-001: Face verification approach

**Status:** Accepted for pilot · **Date:** 2026-10-29

## Context
The roadmap (Sections 5.3, 9.6) requires the identity decision to be made on the server, never trusted
from the client, with a pluggable `FaceVerifier`, and an honest description of liveness limits.

## Decision
- **Server-side matching** with OpenCV Zoo models, run inside the FastAPI backend:
  - Detector: **YuNet** `face_detection_yunet_2023mar.onnx` (MIT licence).
  - Recogniser: **SFace** `face_recognition_sface_2021dec.onnx` (Apache-2.0 licence), 128-d embeddings,
    cosine similarity, default threshold **0.363** (the model authors' published value).
  - Model files are SHA-256 pinned in `backend/scripts/download_models.py`.
- The mobile app (Expo) only captures frames (`expo-camera`), resizes them in memory and uploads them once.
- **Templates**: mean of frontal embeddings, AES-256-GCM encrypted, key version stored, ciphertext bound to the
  student id (AAD), stored in the separate `biometric` schema. Raw images are never written to disk.
- **Liveness (basic)**: server picks a random head-turn direction per attempt, bound to a single-use nonce
  (TTL 120 s). The turn frame must show the requested yaw and be the same person as the matched frontal frame.
  Enrollment also requires left and right turns.
- `MockFaceVerifier` exists for automated tests only and refuses to load when `ENVIRONMENT=production`.

## Alternatives considered
| Option | Why not (for now) |
|---|---|
| On-device matching (TFLite) | Client can be tampered with; result can't be trusted without attestation. |
| InsightFace / ArcFace pretrained models | Common pretrained weights are research / non-commercial licensed. |
| Cloud vendor face + liveness | Best liveness, but cost, third-party data processing, DPA and procurement needed. Re-evaluate after pilot. |
| dlib `face_recognition` | Hard to build on Windows; older accuracy. |

## Consequences / known limits (do not over-claim)
- Active head-turn liveness stops printed photos and naive replays. It does **not** stop a video that follows
  prompts, a deepfake, a 3D mask, or an injected camera feed on a compromised phone.
- No device attestation yet (Play Integrity requires a Google Cloud project + server verification). The app
  sends a random per-install id; the server stores only an HMAC and flags one device marking several students.
- The 0.363 threshold and yaw thresholds (`FACE_FRONTAL_MAX_YAW=0.12`, `LIVENESS_MIN_YAW=0.15`) are starting
  values. **They must be re-tuned from measured FAR/FRR on your own consented pilot group and phones**
  (roadmap 9.2, 14.2) before any rollout.
- Templates are model-specific: changing the model forces re-enrollment (`model_name/model_version` checked).
- Describe the system as **"face-assisted attendance verification"**, not "secure" or "spoof-proof".
