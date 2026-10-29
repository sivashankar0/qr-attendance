# Test plan and status (roadmap Section 14)

Legend: **Auto** = covered by `backend/tests` (run `pytest`), **Manual** = must be done on real phones /
people before rollout, **Open** = not implemented.

Automated suite: **48 tests, all passing** (PostgreSQL test DB, mock verifier + real SFace smoke tests).

## 14.1 Functional
| Check | Status | Test |
|---|---|---|
| Correct face + valid session → recorded, server time | Auto | `test_correct_face_marks_present_with_server_time` |
| Wrong student's face → `FACE_MISMATCH` | Auto | `test_wrong_face_rejected_...`, `test_friend_using_students_login_rejected` |
| Not enrolled → guided to enrollment / fallback | Auto | `test_not_enrolled_guided_to_enrollment_or_manual` |
| QR scan without face verification → no record | Auto | `test_qr_scan_without_face_verification_records_nothing` |
| Duplicates (repeat scan, duplicate exception) → single record | Auto | `test_duplicate_attempts_single_record`; DB `UNIQUE(student_id, session_id)` |
| Expired / closed session → `SESSION_EXPIRED` | Auto | `test_expired_and_closed_sessions_rejected` |
| Tampered / old rotated QR → `SESSION_INVALID` | Auto | `test_tampered_and_old_qr_rejected` |
| Not in class → `NOT_IN_CLASS` | Auto | `test_student_not_in_class` |
| Phone clock change does not affect time | By design | timestamps are DB `now()`; client time is never sent |

## Location restriction (geofence)
| Check | Status |
|---|---|
| Inside radius accepted; outside → `LOCATION_OUT_OF_RANGE`, teacher sees flag, fallback works | Auto (`tests/test_geofence.py`) |
| Missing / mocked / inaccurate (>100 m) location rejected | Auto |
| Teacher anchor validation (accuracy, mock, radius 30–500 m) | Auto |
| Student coordinates not stored (only rounded distance in audit) | Auto |
| Real indoor GPS accuracy in your classrooms; choose radius | **Manual** |
| GPS spoofing with rooted phone / modified app | **Manual** – expected to pass; residual risk |

## 14.2 Face quality and accuracy
| Check | Status |
|---|---|
| Lighting, cameras, angles, glasses/mask/head covering, skin tones, ages | **Manual** – pilot group |
| FRR / FAR measured, threshold chosen | **Manual** – required before rollout |
| Retry limit (3), cooldown (5 s), fallback offered | Auto (`test_wrong_face_...`, `test_cooldown_enforced`) |
| Quality messages (no face / multiple faces / too dark) | Auto (`test_quality_issues_reported`, SFace smoke tests) |

## 14.3 Spoofing
| Attack | Status |
|---|---|
| Wrong-direction / static frame liveness | Auto (`test_liveness_wrong_direction_rejected`) |
| Printed photo, screen photo, video replay, prompt-following video, mask, injected feed | **Manual** – record blocked / detected / **passed** honestly |
| Reused / forged / other student's nonce | Auto (`test_nonce_reuse_and_cross_student_nonce_rejected`) |

## 14.4 Permissions, camera, fallback
| Check | Status |
|---|---|
| Camera denied / permanently denied → explanation + settings link | Implemented (`FaceCapture`, `scan.tsx`) – **Manual** verify |
| Camera unavailable → message + teacher verification | Implemented – **Manual** verify |
| Teacher manual verification logged, shown on dashboard | Auto |
| Opt-out students routed to teacher verification | Auto (`test_opt_out_routes_to_teacher_verification`) |

## 14.5 Enrollment, deletion, privacy
| Check | Status |
|---|---|
| Requires identity-verified account | Auto |
| Requires current, explicit consent; version stored | Auto |
| Missing head turns / mixed people rejected | Auto |
| Re-enrollment replaces old template | Auto |
| Withdraw consent deletes template, audited | Auto |
| Retention purges verification results | Auto |
| No images/templates in audit log | Auto (`test_audit_log_has_no_biometric_payloads`); app logs only type+path on errors |
| Backups follow deletion window | **Open** – ops procedure |

## 14.6 Security and bypass
| Check | Status |
|---|---|
| Client `face_verified` / `student_id` fields rejected (422) | Auto |
| Role boundaries (student/teacher/admin, other teacher's class) | Auto (`test_role_boundaries`) |
| Reporting DB role cannot read `biometric` schema | Auto (`test_reporting_role_cannot_read_biometric_schema`) |
| Template ciphertext encrypted + bound to student | Auto |
| Login rate limit, lockout, no user enumeration | Auto |
| Refresh-token rotation + reuse detection | Auto |
| CSV formula injection | Auto |
| Play Integrity / repackaged APK detection | **Open** |
| TLS config, no secrets in APK | **Manual** – deploy behind HTTPS; APK contains only `EXPO_PUBLIC_API_URL` |
| Pen test | **Manual** |

## 14.7 Performance
| Check | Status |
|---|---|
| 100–200 students in a few minutes | **Manual** load test (SFace ≈ tens of ms per frame on CPU; 5 frames per attempt) |
| Network drop mid-verify → clean failure, no duplicate | By design (nonce consumed atomically; UNIQUE constraint) – **Manual** verify |
