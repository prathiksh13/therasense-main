# TheraSense Context (Compiled by Copilot)

Source documents read thoroughly:
- README_main.md
- PROJECT_BACKEND_SYSTEM_GUIDE.md
- PROJECT_FROM_SCRATCH_COMPLETE_GUIDE.md

Date compiled: 2026-04-23

## 1) Consolidated System Context

TheraSense is a role-based (patient/therapist) teleconsultation platform with:
- React/Vite frontend (`frontend-react`) for auth, session workflows, reports, journaling, and chat UI.
- Node/Express/Socket.IO backend (`server.js`) for signaling, email endpoints, cron reminders, chatbot endpoint(s), and static serving.
- Firebase Auth + Firestore as primary identity and data store.
- Browser-side emotion inference (face-api.js + model files under `/models`) on therapist side.
- Optional Flask service (`app.py`) for emotion graph image generation (not core to main runtime path).

Runtime channel split:
- Frontend <-> Firebase (direct SDK access)
- Frontend <-> Node REST/Socket endpoints
- WebRTC media is peer-to-peer (backend only does signaling)

## 2) Core Data Model (as documented)

Primary collections used consistently across docs:
- `users`
- `sessions`
- `reports`
- `therapistPatients`
- `journals`
- `sessionMetadata`

Additional collections referenced in the from-scratch guide/UI notes:
- `patientJournals`
- `sessionPreparations`
- `patientTherapistMessages`
- `therapistNotes`

## 3) API/Realtime Contract (documented)

REST:
- `POST /send-booking-email`
- `POST /send-reminder-email`
- `POST /send-emergency-email`
- `POST /chat`

Socket events:
- `join-session`
- `join-session-ack`
- `session-state`
- `signal`
- `emotion_update`

## 4) Existing Issues Found (Prioritized)

### Critical

1. Documentation body corruption in README_main
- In `README_main.md`, the "Known Issues" section transitions into what appears to be a second, appended guide block and includes malformed content flow.
- Example symptom: after section `3.8 Documentation Drift`, content abruptly continues with schema lines (`role: "patient" | "therapist"`) without clean section boundaries.
- Impact: high onboarding confusion, source-of-truth ambiguity, and likely accidental merge artifact.

2. AI provider contradictions across same file and across guides
- `README_main.md` says chat endpoints call Groq/LLaMA in architecture and API sections, but later sections describe Gemini-backed `/chat` as active path.
- Other two guides primarily describe Gemini.
- Impact: implementers can wire wrong provider/env vars and break chat.

3. Email env var naming mismatch across docs
- `README_main.md` uses `EMAIL_USER`/`EMAIL_PASS`.
- Other guides use `SMTP_USER`/`SMTP_PASS`.
- Impact: deployment/config errors and non-functional email features.

### High

4. Route/API naming inconsistency for chat
- `README_main.md` references both `/api/chat` and `/chat` for active usage with mixed component mapping.
- Other docs focus on `/chat`.
- Impact: frontend/backend integration confusion and potential 404s when wiring chat widgets.

5. README file identity inconsistency
- `README_main.md` refers to `README.md` as "this codebase audit" while workspace primary audit doc appears as `README_main.md`.
- Impact: maintainers may edit wrong file; doc drift accelerates.

6. Data-model scope drift across docs
- From-scratch guide introduces extra collections (`patientJournals`, `sessionPreparations`, etc.) not fully mirrored as first-class schema in the backend guide.
- Impact: rules and migration planning may miss collections actually used by UI.

### Medium

7. Mixed dashboard route wording
- Some sections describe dashboard rendering `PatientHome`/`TherapistHome`, while other sections indicate `Dashboard.jsx` role-adaptive behavior and legacy pages not routed.
- Impact: less severe, but confusing for navigation/routing maintenance.

8. Security warning sections are strong but not normalized into one canonical checklist
- Security risks are listed in README_main (e.g., wildcard CORS, unauthenticated email endpoints), but equivalent enforcement checklist is not consistently repeated in all guides.
- Impact: hardening actions can be missed during backend extraction/reuse.

## 5) Security/Operational Risks Explicitly Documented (Important)

The docs themselves flag these real project risks:
- Potential hardcoded frontend Firebase config and exposed-like key template.
- Email endpoints callable without strong authz middleware.
- Wildcard CORS (`origin: '*'`) in Socket.IO/storage contexts.
- Local journal uploads/public serving defaults.
- Cron reminder scanning entire `sessions` collection every minute (scaling risk).
- Placeholder and legacy/demo signaling code still present in project.

## 6) Recommended Documentation Cleanup Plan

1. Split `README_main.md` into clean sections only once
- Keep one architecture/audit narrative.
- Remove duplicated appended guide material.

2. Standardize one chatbot contract
- Decide active provider path (Gemini-only, Groq-only, or dual-provider strategy).
- Document exact endpoint(s) and fallback behavior.

3. Standardize env variable names
- Pick one SMTP naming convention (`SMTP_USER`/`SMTP_PASS` recommended).
- Keep aliases only if server supports both, and document precedence.

4. Define one source-of-truth table for:
- Active routes/pages
- API endpoints
- Firestore collections
- Socket events

5. Add a "Doc version + last validated commit" footer to each major guide.

## 7) Practical Notes for Future Work

If asked to implement fixes, prioritize in this order:
1. Secure API endpoints and CORS settings.
2. Resolve chatbot provider + endpoint inconsistencies.
3. Unify env var names and `.env.example` templates.
4. Clean duplicated/legacy docs and ensure one canonical README.
5. Align Firestore rules with all actively used collections.
