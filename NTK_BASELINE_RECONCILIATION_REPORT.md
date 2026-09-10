# NTK Baseline Reconciliation Report: Local Source vs. Live Production

**Date**: 2026-09-04  
**Project**: NTK Note (`ntk-note`)  
**Frontend URL**: `https://ntk-note.web.app`  
**Worker URL**: `https://ntk-note-gateway.ntk-note.workers.dev`  
**Firebase Project**: `ntk-note`  

---

## 1. Overall Reconciliation Classification

### **Result: Reconciled & Synchronized — Local Source Reflects Authoritative Live Production**

Following the live identity purge, Backblaze B2 consolidation, and duplicate-resource cleanup, the local repository and live production environment are in complete agreement:
1. **Durable IndexedDB Offline Media Persistence & Queue** (`src/utils/offlineMediaQueue.ts`): Verified UID-scoped IndexedDB offline storage for photos, audio recordings, and file attachments, with automatic reconnect synchronization and local Blob URL resolution.
2. **Storage Guard Safety Ceiling Architecture** (`cloudflare/ntk-gateway/src/index.ts` & `src/utils/storageGuard.ts`): Server-side enforcement of 95% critical threshold (7.6 GB) against an 8 GB safety target, with automatic friendly rejection (`HTTP 507 STORAGE_GUARD_PAUSED`).
3. **Comprehensive Automated Test Coverage** (`tests/storageGuard.test.ts`, `tests/offlineMediaQueue.test.ts`, `tests/logic.test.ts`): 48 unit/integration tests and 6 Firestore security rules tests against emulator pass 100%.

---

## 2. Detailed Component Reconciliation Matrix

| Component / File Area | Local Source State | Live Production State | Classification | Evidence & Notes |
|---|---|---|---|---|
| **Firestore Security Rules** (`firestore.rules`) | 6 tests passing, strict user/workspace isolation, collaborator checks, legacy data quarantine | Active in Firebase project `ntk-note` | **IDENTICAL / COMPATIBLE** | All 6 security rules tests pass against local Firestore emulator. Live app enforces read/write isolation. |
| **Cloudflare Worker Gateway** (`cloudflare/ntk-gateway/src/index.ts`) | Contains Storage Guard 95% ceiling (7.6 GB), quota calculations, owner route handling | Active Version `3d6505b4`, 0 errors, bindings to `NTK_CONFIG` & `NTK_FILES` | **SYNCHRONIZED** | Live worker is active and functional. Worker secret `OWNER_EMAILS` server-enforces 3 authorized owners. |
| **Offline Media Queue & Storage** (`src/utils/offlineMediaQueue.ts`) | IndexedDB store `ntk_offline_media_db`, UID isolation, retry loop, Blob URL resolver | Active in production singlefile bundle | **SYNCHRONIZED** | Provides durable IndexedDB persistence for large binary blobs without localStorage quota exhaustion. |
| **Storage Guard UI & Logic** (`src/utils/storageGuard.ts`, `src/components/SettingsModal.tsx`) | 8GB safety target, 95% guard, fail-safe calculations, friendly novice notifications | Storage Guard active in Settings with 8GB target and 95% threshold | **IDENTICAL** | Live owner settings show Storage Guard enabled with matching 8GB / 95% configuration. |
| **Reminders & Deduplication** (`src/utils/reminderEngine.ts`) | 100% test coverage for dedup, scheduling, snoozing, categories | Operational in live web app | **IDENTICAL** | Tests pass; verified live in Reminder Center. |
| **User Directory Privacy** (`src/utils/collaboratorLookup.ts`) | Requires minimum 3-character prefix to prevent user enumeration | Operational in live web app | **IDENTICAL** | Verified by unit tests and live sharing modal behavior. |
| **Templates 2.0** (`src/data/templates.ts`) | Novice-friendly editable content, no markdown raw syntax leakage | Operational in live web app | **IDENTICAL** | CV, To-Do, Meeting, and Project templates render rich usable content. |
| **Cloudflare Bindings** | Defined in `wrangler.toml` (`NTK_CONFIG`, `NTK_FILES`) | Bound in Cloudflare Dashboard to `ntk-note-gateway-NTK_CONFIG` & `ntk-note-files` | **IDENTICAL** | Inspected directly on Cloudflare Dashboard via BrowserOS Neo. |
| **Backblaze B2 Bucket** | Configured to target canonical backup bucket `ntk-note-backups` | `ntk-note-backups` active, private, SSE-B2 encrypted (ID `c882bb3fc5135446a0020210`) | **IDENTICAL** | Inspected directly on Backblaze B2 console. Obsolete empty buckets permanently deleted. |
| **Storage Connections** | Supports `Main R2 Storage` & `NTK Backup` | Live settings show `Main R2 Storage` (Ready) & `NTK Backup` (Ready) | **IDENTICAL** | Exactly 2 connections exist. Duplicate R2 connection permanently deleted. |
| **Owner Authorization** | Exactly 3 authorized owners | Server-enforced via Worker secret `OWNER_EMAILS` (3 owners) | **IDENTICAL** | Former removed account: verified absent from Authentication, Firestore application records and active source/configuration. |

---

## 3. What is Local-Only vs. Live-Only

### Local-Only
- Local test suites and emulator verification runners (`tests/logic.test.ts`, `tests/storageGuard.test.ts`, `tests/offlineMediaQueue.test.ts`, `scripts/run_firestore_rules_tests.mjs`).
- Local backup rollback checkpoint archives.
- Singlefile production build output (`dist/index.html`).

### Live-Only
- Historical Worker deployment versions on Cloudflare Workers (retained strictly as release/rollback history).
- Encrypted live Worker runtime secrets (`CONFIG_ENCRYPTION_KEY`, `OWNER_EMAILS`) securely stored in Cloudflare Dashboard.

### Identical / Synchronized
- Core application components, notes state machine, React router/navigation, singlefile Vite build configuration.
- Firebase project configuration (`FIREBASE_PROJECT_ID = ntk-note`).
- Cloudflare KV binding (`NTK_CONFIG = c3df08383eb744bbbd30be1ee4f3cf4c`).
- Cloudflare R2 bucket binding (`NTK_FILES = ntk-note-files`).
- Backblaze B2 canonical backup store (`ntk-note-backups`).
- Authorized owner identity count (3 owners).

---

## 4. Deployment Readiness Verdict

The local state is fully reconciled with the verified online canonical infrastructure. All automated test gates pass 100%. No production redeployment is required for documentation-only reconciliation.
