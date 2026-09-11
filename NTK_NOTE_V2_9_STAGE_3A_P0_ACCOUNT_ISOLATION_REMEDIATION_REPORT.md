# NTK Note v2.9 — Stage 3A P0 Account Isolation Remediation Report

**Date:** 2026-09-11  
**Branch:** `final-novice-ux`  
**Starting HEAD:** `a288023c3b3d98b07490d229d7990f74ce42733c`  
**Rollback baseline:** `v2.8.2` (`43b6121698035d54978111fb17496b94f47156d4`)  
**Scope:** Remediate ONLY P0 defects S3-001 and S3-002; restore 17 unintended tracked documentation deletions; preserve Stage 3 audit report.

---

## 1. Executive Summary

This Stage 3A corrective cycle resolves the two critical same-browser cross-account exposure defects identified in the Stage 3 Product Acceptance Report:

1. **S3-001 (P0): Private Message Draft Isolation:** Eliminated symmetric unscoped chat draft keys (`ntk:chat:draft:${chatId}`). All drafts are now strictly namespaced by authenticated Firebase UID and chat ID (`ntk:chat:draft:${uid}:${chatId}`). Legacy unscoped draft text is quarantined and never automatically migrated across accounts.
2. **S3-002 (P0): Local Note Version History Isolation:** Eliminated unscoped version history keys (`ntk-versions-${noteId}`). All version history operations (read, append, trim, delete, clear, restore) are now strictly namespaced by authenticated Firebase UID and note ID (`ntk:versions:${uid}:${noteId}`). Shared note collaborators in the same browser profile can no longer see each other's local historical content. Legacy unscoped version history is quarantined and never migrated across accounts.
3. **Restoration of 17 Documentation Files:** The 17 tracked documentation and historical release reports that were missing in the working tree were restored from HEAD.
4. **Preservation of Stage 3 Report:** `NTK_NOTE_V2_9_STAGE_3_FINAL_PRODUCT_ACCEPTANCE_REPORT.md` is preserved intact without alteration.

---

## 2. Baseline Verification

```text
Branch: final-novice-ux
Starting HEAD: a288023c3b3d98b07490d229d7990f74ce42733c
v2.8.2 tag target: 43b6121698035d54978111fb17496b94f47156d4
Historical secret commit (48799bd354f94f6bc873f68d4772866fbf1778ea) is-ancestor: NO (exit code 1)
```

### 17 Restored Tracked Documentation Files:
- `ANTIGRAVITY_CONTINUATION_STATE.md`
- `NTK_BASELINE_RECONCILIATION_REPORT.md`
- `NTK_INFRASTRUCTURE_DUPLICATE_INVENTORY.md`
- `NTK_LIVE_IDENTITY_AND_DUPLICATE_CLEANUP_REPORT.md`
- `NTK_NOTE_FINAL_PRODUCTION_RUNBOOK.md`
- `NTK_NOTE_PRE_UPGRADE_BASELINE_REPORT.md`
- `NTK_NOTE_V2_4_FINAL_RELEASE_REPORT.md`
- `NTK_NOTE_V2_5_PEOPLE_MESSAGING_AI_REPORT.md`
- `NTK_NOTE_V2_5_SECURITY_AND_FREE_ZONE_CLOSURE_REPORT.md`
- `NTK_NOTE_V2_6_RECYCLE_BIN_AND_DATA_LIFECYCLE_REPORT.md`
- `NTK_NOTE_V2_7_AUDIO_AND_LISTEN_RELEASE_REPORT.md`
- `NTK_NOTE_V2_8_1_FINAL_PRODUCTION_RELEASE_REPORT.md`
- `NTK_NOTE_V2_8_2_FINAL_PRODUCTION_RELEASE_REPORT.md`
- `NTK_NOTE_V2_8_RELIABILITY_SYNC_OFFLINE_PERFORMANCE_REPORT.md`
- `NTK_NOTE_V2_9_STAGE_1_NAVIGATION_ACCOUNT_UX_REPORT.md`
- `NTK_NOTE_V2_9_STAGE_2_NATIVE_MOBILE_AND_NOVICE_UX_REPORT.md`
- `NTK_SOURCE_DUPLICATE_AUDIT.md`

---

## 3. S3-001 Remediation: Message Draft UID Isolation

### Root Cause
In `src/components/MessagesView.tsx`, message drafts were read, written, and deleted from `localStorage` using keys of the form:
```ts
`ntk:chat:draft:${activeChatId}`
```
Because `getDeterministicChatId(uidA, uidB)` computes a symmetric chat ID (sorting both UIDs), User A and User B chatting with each other share the exact same `activeChatId`. If User A typed an unsent draft and signed out, User B opening the same browser profile would load and read User A's unsent private draft. Furthermore, `clearAuth()` cleared in-memory chat cache but did not clear or namespace local storage draft keys.

### Architecture & Fix
In `src/utils/chatService.ts`:
- Added `getChatDraftKey(uid: string, chatId: string): string` generating canonical key `ntk:chat:draft:${safeUid}:${safeChatId}`.
- Added `getChatDraft(uid: string, chatId: string): string` strictly reading the UID-scoped key.
- Added `setChatDraft(uid: string, chatId: string, text: string): void` persisting only under the authenticated UID.
- Added `clearChatDraft(uid: string, chatId: string): void` removing only the authenticated user's draft.
- Added `cleanupLegacyChatDraft(chatId: string): void` removing legacy unscoped keys without migration.

In `src/components/MessagesView.tsx`:
- Connected draft restoration and persistence to `myUid` (`currentUser?.uid || storeUid`).
- In `useEffect([activeChatId, myUid])`, cleans up legacy unscoped keys and restores only the current authenticated user's draft.
- In `handleComposerChange`, persists drafts strictly under `myUid`.
- In `handleSendMessage`, clears draft under `myUid` upon successful transmission.

In `src/store/index.ts`:
- Updated `clearAuth()` to explicitly reset `activeChatId: null` and `aiNoteContext: null` to prevent in-memory chat leak on logout.

### Legacy Draft Policy
Unscoped chat drafts cannot be safely attributed to whichever user next signs in. Automatically migrating legacy text into a new UID-scoped draft risks exposing User A's draft to User B. Legacy unscoped keys are quarantined, never read, and cleanly removed via `cleanupLegacyChatDraft()`.

---

## 4. S3-002 Remediation: Version History UID Isolation

### Root Cause
In `src/components/VersionHistory.tsx`, version history was persisted in `localStorage` using:
```ts
`ntk-versions-${noteId}`
```
For shared notes, multiple users have access to the same `noteId`. If User A and User B share a note and use the same computer/browser, User B opening Version History would load User A's local draft snapshots, exposing historical title and content.

### Architecture & Fix
In `src/components/VersionHistory.tsx`:
- Added `getVersionHistoryStorageKey(uid: string | null | undefined, noteId: string): string` generating canonical key `ntk:versions:${safeUid}:${safeNoteId}`.
- Added `cleanupLegacyVersionHistory(noteId: string): void` safely removing `ntk-versions-${noteId}`.
- Updated `getVersions(noteId: string, uid?: string | null): NoteVersion[]` to read strictly from the authenticated UID namespace.
- Updated `saveVersion(version: NoteVersion, uid?: string | null): void` to scope versions by UID and record `version.uid`.
- Updated `saveLocalNoteSnapshot(noteId, title, content, source, uid)` to quarantine legacy keys and persist snapshots strictly under the caller's UID.
- Added `clearVersions(noteId: string, uid?: string | null): void` and `deleteVersion(noteId, versionId, uid)` operating strictly on the scoped key.
- Updated `useVersionHistory(noteId, title, content, uid)` to bind automatic debounced snapshots to the current user UID.
- Updated `VersionHistory` component to load versions scoped to `useStore().uid`.
- Updated `src/components/NoteEditor.tsx` and `src/components/CommandPalette.tsx` to pass `uid` to `useVersionHistory` and `saveLocalNoteSnapshot`.

### Legacy Version History Policy
Legacy unscoped version history keys (`ntk-versions-${noteId}`) are quarantined and never automatically merged into a user's scoped history. When snapshots or version views are accessed, `cleanupLegacyVersionHistory` removes the legacy key to prevent stale exposure.

---

## 5. Global Local-Storage Privacy Audit

A comprehensive grep across `localStorage`, `sessionStorage`, `IndexedDB`, and `CacheStorage` evaluated all persistence keys:

| Storage Surface | Key Pattern | Classification | Assessment |
|---|---|---|---|
| User Notes & Workspaces | `ntk:user:{uid}:notes`, `notebooks`, etc. | UID scoped | Verified secure |
| Guest Workspace | `ntk:guest:*` | Device-global / Guest | Isolated to unauthenticated guest |
| Crash Journal | `ntk:journal:{uid}:{noteId}` | UID scoped | Verified secure |
| Offline Durable Outbox | `ntk:durable:{uid}:*` (IndexedDB) | UID scoped | Verified secure |
| Offline Media Queue | `ntk_media_sync_v1` (IndexedDB) | UID scoped | Verified secure |
| Pending Media Cleanups | `${PENDING_MEDIA_KEY}_${uid}` | UID scoped | Verified secure |
| Pending Reminder Cleanups | `${PENDING_REMINDERS_KEY}_${uid}` | UID scoped | Verified secure |
| Delivered Reminders | `ntk_delivered_reminders_${uid}` | UID scoped | Verified secure |
| **Chat Drafts (S3-001)** | `ntk:chat:draft:${uid}:${chatId}` | **UID scoped (remediated)** | **Verified secure** |
| **Note Versions (S3-002)** | `ntk:versions:${uid}:${noteId}` | **UID scoped (remediated)** | **Verified secure** |
| Notebook Folder Expansion | `ntk_expanded_notebooks` | Device-global non-sensitive | UI fold/unfold state only; zero content |
| Note Export Options | `ntk-export-options`, `ntk-last-export-format` | Device-global non-sensitive | Export preference dropdown values only |
| Gateway Dev Override | `ntk_gateway_override` | Device-global non-sensitive | Local development URL override |
| Service Worker Cache | `ntk-note-offline-v12` | Device-global non-sensitive | PWA static assets only |

**Finding:** No additional user-content-bearing privacy defects were found. All user data in local storage is strictly UID-scoped.

---

## 6. Behavioral Regression Tests

A new dedicated test suite `Stage 3A — Critical Cross-Account Isolation Remediation (S3-001 & S3-002)` was added to `tests/logic.test.ts`:

1. **S3-001 P0 Behavioral Test:**
   - Evaluates `getChatDraftKey` distinctness for `userA` and `userB` on symmetric `chatId`.
   - `userA` stores draft -> `userB` switches in same profile -> loads `EMPTY`.
   - `userB` stores draft -> `userA` switches back -> loads only `userA` draft.
   - Verifies legacy unscoped draft is never read, never migrated, and safely removed.
   - Verifies clearing `userA` draft leaves `userB` draft intact.
2. **S3-002 P0 Behavioral Test:**
   - Evaluates `getVersionHistoryStorageKey` distinctness for `userA` and `userB` on shared note `shared-note-1`.
   - `userA` stores private version -> `userB` loads `shared-note-1` in same profile -> returns `EMPTY`.
   - `userB` stores separate revision -> switching back and forth delivers only each user's respective history.
   - Verifies legacy unscoped history is never migrated and safely evicted.
   - Verifies `clearVersions` for `userA` does not delete `userB` versions.
3. **Auth Reset Test:**
   - Verifies `clearAuth()` in `src/store/index.ts` resets `activeChatId: null` and `aiNoteContext: null`.

---

## 7. Required Full Local Gates

All six required local gates passed with fresh measurements:

### 1. `npm test`
```text
ℹ tests 294
ℹ suites 45
ℹ pass 294
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10229.401
```

### 2. `npm run test:rules`
```text
✔ Firestore Security Rules Unit Tests
ℹ tests 24
ℹ suites 1
ℹ pass 24
ℹ fail 0
ℹ duration_ms 16659.2493
Firestore rules test suite finished with exit code 0
```

### 3. `npx tsc --noEmit`
```text
exit code 0 (no diagnostics)
```

### 4. `npm --prefix cloudflare/ntk-gateway run typecheck`
```text
> ntk-note-gateway@0.2.0 typecheck
> tsc --noEmit
exit code 0
```

### 5. `npm run build`
```text
dist/.assetsignore      0.02 kB
dist/wrangler.json      1.09 kB │ gzip:   0.56 kB
dist/index.html     2,764.92 kB │ gzip: 774.85 kB
✓ built in 26.93s
Exact measurement:
dist/index.html bytes=2764920 gzip_bytes=774850 sha256=b7a8da1eab3bad3da136de5ab570d061719e84ed0898c89a7433eb629dce01ed
```

### 6. `node scripts/audit_secrets.mjs`
```text
Scanning 149 repository files for generic secret shapes...
Scan complete. Total files scanned: 149. Findings: 0
```

---

## 8. Deployment

- **Target:** Firebase Hosting (`ntk-note`)
- **Command:** `npx firebase deploy --only hosting --project ntk-note`
- **Result:**
  ```text
  === Deploying to 'ntk-note'...
  i  deploying hosting
  i  hosting[ntk-note]: beginning deploy...
  +  hosting[ntk-note]: file upload complete
  +  hosting[ntk-note]: version finalized
  +  hosting[ntk-note]: release complete
  +  Deploy complete!
  Hosting URL: https://ntk-note.web.app
  ```
- **Scope check:** No Cloudflare Worker, Firestore rules, indexes, R2, or KV deployed.

---

## 9. Live Acceptance & BrowserOS Neo Status

- **BrowserOS Neo Status:** Connected (`5792705f-dd03-4a06-9dc5-d2eb421e4f82`).
- **Active Profile Inspection:** BrowserOS session was signed in as Google user `appdevmanwill@gmail.com`. The required owner release account `feaiccws@gmail.com` profile was disconnected earlier during Stage 3.
- **Rule Enforcement (Sections 20, 22, 23):** Per instructions, the agent must NOT use another unintended Google account for live owner release acceptance, and must never invent live pass or risk touching unrelated production data.
- **Classification:** **LIVE TEST SAFELY BLOCKED** for live cross-account switching pending FEAICCWS profile reconnection.
- **Verification Guarantee:** Full behavioral regressions with actual production functions cover both User A / User B isolation scenarios in `tests/logic.test.ts`.

---

## 10. Firebase Plan & Cloud State

- **Plan:** Spark (No-cost $0/month)
- **Functions:** 0
- **App Hosting:** 0
- **Firestore Databases:** 1 (`(default)`)
- **Worker / Rules changed:** None

---

## 11. Remaining Stage 3 Blockers (For Stages 3B and 3C)

- **P1 High (6):** S3-003 (backup replace-restore safety), S3-004 (manual sync truth / unknown media state), S3-005 (activity feed rules / cross-user activity injection), S3-006 (comment rules schema / body types), S3-007 (mobile safe areas / notch insets), S3-008 (AI history keyboard accessibility).
- **P2 Normal (4):** S3-009 (directory enumeration rules), S3-010 (sync concurrency promise lock), S3-011 (backup UTF-8 chunk sizing & validation), S3-012 (touch targets >= 44px & reduced motion).
- **P3 Minor (2):** S3-013 (theme prepaint key), S3-014 (duplicate chat subscriptions).
