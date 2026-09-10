# NTK NOTE v2.6 — COMPLETE RECYCLE BIN, DATA INTEGRITY & LIVE RELEASE CLOSURE REPORT

**Project**: NTK Note (Online-First Production)  
**Release**: v2.6 Absolute Final Route-Level KV Read Closure  
**Release Date**: September 6, 2026  
**Frontend Deployment**: `https://ntk-note.web.app` (Firebase Hosting)  
**Gateway Deployment**: `https://ntk-note-gateway.ntk-note.workers.dev` (Cloudflare Worker Version ID: `345e9fd8-d46f-484c-861b-cbbfd070c81a`)  
**Service Worker**: Cache Name `ntk-note-offline-v9`  
**Firebase Plan**: Spark ($0/month, 0 billing accounts, 0 Cloud Functions, 0 App Hosting, exactly 1 Firestore database)  

---

## 1. System Overview & Final Data-Integrity Baseline

NTK Note v2.6 delivers complete lifecycle management for user notes, notebooks, and media assets. Authenticated users manage their Recycle Bin with complete autonomy. Remote services purge deleted data safely without risking active notes, shared documents, or unrelated files.

The final route-level KV read closure resolved the remaining queue persistence vulnerability:
- **Fail-Closed Route-Level Storage Deletion**: `DELETE /v1/storage/file/:purpose/:objectId` reads the canonical index through `checkStorageDeleteEligibility`. If reading KV throws or returns malformed non-array data, the handler halts with HTTP 503 `QUEUE_STATE_UNAVAILABLE` and user-facing message `"Cleanup will retry automatically."`. Zero physical storage calls occur. Zero quota delta updates execute. Zero file metadata records delete. Zero KV markers update.
- **Fail-Closed KV Read Failure Safety**: In `advanceServerMediaRetry`, any exception during KV GET for `pending-media-cleanup-index:{uid}` halts execution immediately and returns `{ markerUpdated: false, indexUpdated: false, atCapacity: false, retryStatePersisted: false, indexReadFailed: true }`. Zero index writes and zero marker writes occur. Transient read errors cannot overwrite existing index queues. Corrupted or non-array index structures also trigger fail-closed handling without replacing data.
- **Fail-Closed Cleanup Removal Safety**: In `removeUserPendingMediaCleanupMarker`, reading the canonical index occurs before any deletion. If the index read throws or encounters malformed data, the function halts with `{ markerDeleted: false, indexUpdated: false, wasPresent: false, indexReadFailed: true }`. The secondary marker remains intact and no false cleanup success is reported.
- **Truthful Worker Error Semantics**: Gateway endpoints return HTTP 503 `QUEUE_STATE_UNAVAILABLE` with user-facing message `"Cleanup will retry automatically."` on queue read failure, hiding internal KV details. If a physical R2 file is already deleted and post-delete queue reconciliation encounters KV read errors, the endpoint returns `{ ok: true, mediaCleanupPending: true }` without recreating deleted files. If physical deletion fails and server retry advancement cannot persist due to index read errors, the response reports `retryStatePersisted: false` so the client retains its bounded local item.
- **Absent Key Distinction**: Genuine absent keys returning `null` from KV represent valid empty queues (`currentIndex = []`) and proceed normally without error.
- **Media Queue Split-Brain Elimination**: `pending-media-cleanup-index:{uid}` serves as the canonical source of truth for retry state and backoff lookup. In `advanceServerMediaRetry`, the canonical index is written *first*; if index persistence fails, zero secondary markers are created. If marker write fails, the item remains discoverable in the index (`retryStatePersisted: false`).
- **Reminder DELETE Membership-First Zero-Read Protection**: `DELETE /v1/storage/reminder-cleanup-pending` loads the existing server queue and filters requested IDs against it before making any external calls. If zero requested IDs match the queue (`queuedIds.length === 0`), the route immediately returns `200 { ok: true, deleted: false, unchanged: true }` with ZERO Firestore REST calls and ZERO KV writes. For mixed payloads, Firestore validation executes only for actually queued IDs, preventing abuse that burns Spark reads.
- **Strict Raw Request Bounds & Typing**: In `validateReminderCleanupRequest`, raw arrays are bounded to `<= 25` items *before* trim, filter, or deduplication; raw 26-duplicate floods are rejected with `400 REQUEST_TOO_LARGE`. Non-string elements are rejected with `400 INVALID_REMINDER_ID`. Individual string IDs are bounded to 1-128 characters before Firestore work.
- **429 RETRY_NOT_READY Frontend Semantics**: `deleteStorageFileDetailed` parses `429 RETRY_NOT_READY` with `nextEligibleAttemptAt` and immediately terminates its retry loop (0 redundant immediate attempts). In `retryPendingMediaCleanups`, items encountering 429 keep their existing `retryCount` (never incremented), copy the server's `nextEligibleAttemptAt`, and emit zero redundant marker POSTs.
- **Truthful Speech Provider Labeling**: Cloudflare Worker functions as the gateway, while the synthesis engine is the Google Speech Fallback (`google-speech`). Response headers explicitly state `X-TTS-Gateway: ntk-note-gateway`, `X-TTS-Provider: google-speech`, and `X-TTS-Provider-Label: Google Speech Fallback`.
- **Orphan-Marker Prevention**: `advanceServerMediaRetry` verifies index capacity *before* writing any new marker. If the user index already has 50 entries and a 51st item fails, no marker is created, the index remains strictly 50, and the response signals `mediaCleanupPendingLocalOnly: true`. Zero orphan KV keys are created.
- **Reminder Queue All-or-Nothing Capacity**: `POST /v1/storage/reminder-cleanup-pending` performs same-request internal deduplication (`['rem_1', 'rem_1']` consumes 1 slot), bounds incoming requests to <= 25 IDs (1-128 chars), and enforces all-or-nothing capacity. If `existing.length + newIds.length > 100`, the request is rejected with `429 REMINDER_QUEUE_CAPACITY` with zero KV writes (never partial truncation). Duplicate submissions return `{ ok: true, unchanged: true }` with zero KV writes.
- **Reminder Real Orphan Authority Validation**: Server accepts reminder cleanup markers only after verifying via Firestore REST with the caller's bearer token that the reminder document exists, contains `noteId`, and the linked note is 404 absent. Standalone reminders (no `noteId`) are rejected with 400. Reminders linked to live notes are rejected with 409 `REMINDER_NOT_ORPHANED`.
- **Worker Deletion Backoff Enforcement**: `DELETE /v1/storage/file/:purpose/:objectId` checks `nextEligibleAttemptAt`. When called before the scheduled backoff time, the worker returns `429 RETRY_NOT_READY` without making storage calls or KV writes. On transient storage failures (500/503), the server increments retry count and sets server-computed backoff (30s, 60s, 300s, 900s, bounded to 3600s).
- **Bottom-Up Notebook Deletion by Depth**: Notebooks are grouped by hierarchy depth. Deletion processes strictly from deepest descendants to root parents. A parent notebook deletes only after all child notebooks succeed or reparent. Child failure blocks parent deletion, preventing orphaned notebook trees.
- **Atomic Shared-Record Pairing**: Owned shared notes pair atomically with private notes in a single Firestore batch (`LogicalNoteUnit`, <= 25 docs). Owned shared notebooks follow identical pairing.
- **Post-Deletion Media Recomputation**: Storage cleanup is never executed from pre-verification candidates. Storage objects `${purpose}:${objectId}` are recomputed against all surviving notes (active notes, younger trashed notes, stale-restored notes, failed-deletion notes). An asset is purged only if zero surviving notes reference it.

---

## 2. Canonical Deletion Engine (`src/utils/recycleBinService.ts`)

The deletion engine controls data validation, candidate harvesting, notebook hierarchy calculations, and remote execution.

### Post-Deletion Media Recomputation & Purpose-Safe Reuse
`extractMediaCandidates` parses attachments, inline images (`note.images`), mobile photos (`note.photos`), and voice notes (`note.voiceNotes`), constructing a unique key `${purpose}:${objectId}`.
After Firestore note deletion completes, `recomputeMediaToClean` takes the genuine `deletedNoteIds` and re-scans the remaining notes. For every media reference in a successfully deleted note, deletion is scheduled only if no surviving note (active, trashed, stale-restored, or failed-deletion) still references the `${purpose}:${objectId}`.

### Authoritative Multi-Device Stale Protection
Before purging notes or notebooks from Firestore, the service queries remote Firestore documents:
- `users/{uid}/notes/{id}`: If `trashed !== true`, note is added to `staleSkippedNoteIds`.
- `users/{uid}/notebooks/{id}`: If `trashed !== true`, notebook is added to `staleSkippedNotebookIds`.
Both collections remain safe against concurrent restores on other devices.

### Phased Notebook Tree Resolution
Notebook deletion occurs in Phase F after all notes in Phase C/D have been confirmed. Surviving child notes and notebooks are reparented before the parent notebook is evaluated. If any child note failed deletion or reparenting, the parent notebook is retained.

---

## 3. Gateway Storage Delete & Marker Security (`cloudflare/ntk-gateway/src/index.ts`)

### Storage Delete Transaction Order (`DELETE /v1/storage/file/:purpose/:objectId`)
1. **Ownership Authentication**: Verifies Firebase caller UID against `record.uid` / `record.uploaderUid`. Infrastructure owners possess zero administrative bypass.
2. **Canonical Queue & Backoff Eligibility Check**: Calls `checkStorageDeleteEligibility`. If canonical index read throws or encounters malformed data, halts immediately with HTTP 503 `QUEUE_STATE_UNAVAILABLE` and zero physical storage calls. If server `nextEligibleAttemptAt` is in the future, responds with `429 RETRY_NOT_READY` with zero storage calls and zero KV writes.
3. **Storage Connection Availability**: Resolves connection configuration. If storage service is unavailable, immediately responds with `503 Service Unavailable`, preserving KV metadata and storage quotas.
4. **Physical Storage Deletion**: Invokes `deleteObject` on physical Cloudflare R2 / Backblaze B2 storage.
   - Provider-confirmed missing (404) is handled idempotently as successful cleanup.
   - Transient failures (500/503) invoke `advanceServerMediaRetry`, incrementing server retry count and setting exponential backoff.
   - Terminal failure (400/403) invokes `removeUserPendingMediaCleanupMarker` server-side before returning error status.
5. **Metadata & Quota Purge**: Only after confirmed physical deletion does the gateway decrement `user-storage-delta:${record.uid}`, delete `user-file:${record.uid}:${record.purpose}:${record.id}`, delete `user-file-by-id:${record.purpose}:${record.id}`, and remove server pending cleanup markers.

### Pending Cleanup Marker Security (`POST /v1/storage/cleanup-pending`)
1. **Record Existence**: Resolves `user-file-by-id:${purpose}:${objectId}`. If missing, responds with 404.
2. **Ownership Enforcement**: Requires `record.uid === user.uid || record.uploaderUid === user.uid`. Infrastructure owners have zero bypass.
3. **Capacity Check Before Write**: Loads user cleanup index using `readPendingMediaIndexFailClosed`. If index read fails, halts with 503. If item is already present, returns idempotent success (200) with zero KV writes. If index count >= 50, rejects with 429 (`QUEUE_LIMIT_EXCEEDED`) without writing orphan KV keys.
4. **Server-Authoritative Schedule**: Ignores client timestamps and retry counts. Stores `queuedAt = now`, `retryCount = 0`, `lastAttemptAt = null`, and `nextEligibleAttemptAt = now`.

---

## 4. Live Production Acceptance & Provider Rotation Audit (BrowserOS Neo)

### BrowserOS Routing Compliance
- **FEAICCWS** (`feaiccws@gmail.com`): Primary live application acceptance, Recycle Bin lifecycle tests, multi-device sync, and Firestore verification.
- **Appdevmanwill** (`appdevmanwill@gmail.com`): Cloudflare Worker deployment, KV management, R2/B2 infrastructure checks, AI provider dashboards.

### Live Test Verifications
1. **Firebase Spark Plan Verification**:
   - Console URL: `https://console.firebase.google.com/project/ntk-note/usage?pli=1`
   - Plan: Spark ($0/month No-cost, 0 billing accounts)
   - Cloud Functions: 0
   - App Hosting: 0
   - Firestore DB: exactly 1 (`(default)`)
   - Firebase Storage for media: 0 bytes / unused
   - Result: **VERIFIED**.
2. **Live Note & Recycle Bin Deletion**:
   - Created disposable note on `https://ntk-note.web.app`.
   - Trashed note: Recycle Bin showed note card and updated counts.
   - Clicked "Delete permanently": executed phased deletion, purged note cleanly, Recycle Bin returned to empty state.
   - Result: **VERIFIED**.
3. **Live Gateway Storage & AI Health**:
   - `Main R2 Storage Cloudflare R2 · 6 uses READY`
   - `NTK Backup Backblaze B2 · 1 uses READY`
   - Live reminder queue verified via authenticated gateway: POST creates item, duplicate returns unchanged no-op with 0 KV writes, DELETE purges item.
   - Result: **VERIFIED**.

### Provider Key Rotation Audit
- **OpenRouter**:
  - Status: **VERIFIED — OWNER COMPLETED MANUAL ROTATION**
  - Replacement key: **VERIFIED ACTIVE**
  - Previous key: **VERIFIED REVOKED**
  - Live connection: **READY**
- **Groq**:
  - Status: **VERIFIED — OWNER COMPLETED MANUAL ROTATION**
  - Replacement key: **VERIFIED ACTIVE**
  - Previous key: **VERIFIED REVOKED**
  - Writing: **READY**
  - Transcription: **READY**

---

## 5. Test Suite and Verification Results

- **Automated Logic Suite (`npm test`)**: 164/164 passing (25 test suites, 0 failures).
- **Firestore Security Rules Emulator (`npm run test:rules`)**: 23/23 passing (1 test suite, 0 failures).
- **Frontend TypeScript (`npx tsc --noEmit`)**: 0 errors.
- **Worker TypeScript (`npm --prefix cloudflare/ntk-gateway run typecheck`)**: 0 errors.
- **Production Build (`npm run build`)**: Built clean single-file bundle `dist/index.html` (2,656.90 kB).
- **Secret Scanner**: 0 secret findings across tracked files.

---

## 6. Permanent Cost & Free-Zone Compliance

| Metric | Budget Target | Actual v2.6 Measurement | Compliance Status |
|---|---|---|---|
| Firebase Pricing Tier | Spark ($0/mo) | Spark ($0/mo) | Fully Compliant |
| Firebase Cloud Functions | 0 | 0 | Fully Compliant |
| Firebase App Hosting | 0 | 0 | Fully Compliant |
| Firestore Databases | 1 (Default) | 1 (Default) | Fully Compliant |
| Firestore Batch Size | <= 50 writes | 25 writes/batch | Fully Compliant |
| Primary Media Storage | Cloudflare R2 | Cloudflare R2 | Fully Compliant |
| Secondary Backup Storage | Backblaze B2 | Backblaze B2 | Fully Compliant |
| Media in Firebase Storage | 0 bytes | 0 bytes | Fully Compliant |

