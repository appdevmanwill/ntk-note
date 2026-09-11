# NTK NOTE v2.9 — STAGE 3A.1 FINAL P0 ACCOUNT-ISOLATION CLOSURE REPORT

**Date:** 2026-09-11  
**Target Release:** NTK Note v2.9  
**Branch:** `final-novice-ux`  
**Starting HEAD:** `6243a62e8f66920bb42b1d111f12d1113d734231`  
**Frozen Rollback Tag:** `v2.8.2` (`43b6121698035d54978111fb17496b94f47156d4`)  
**Historical Secret Commit:** `48799bd354f94f6bc873f68d4772866fbf1778ea` (Verified NOT an ancestor, exit code 1)  
**Environment:** Antigravity 2.0 IDE / Gemini 3.8 Flash (High Reasoning)  

---

## 1. Executive Summary & Verdict

Following the independent re-audit by Codex / GPT-5.6 Sol Ultra of Stage 3A, two original P0 findings (S3-001 and S3-002) were identified as only partially closed due to direct identity transition race conditions, ambiguous fallback authority, shared `guest` version storage, and test harness leakage.

This corrective patch (**Stage 3A.1**) resolves all five residual findings identified by Codex without touching out-of-scope defects (S3-003 through S3-014), without modifying the Cloudflare Worker or Firestore security rules, and without incurring Firebase costs.

**Verdict:** **PASS — P0 ACCOUNT ISOLATION FULLY CLOSED**  
Ready for targeted Codex P0 re-audit.

---

## 2. Authoritative Git & Working Tree Verification

- **Branch:** `final-novice-ux`
- **Starting HEAD:** `6243a62e8f66920bb42b1d111f12d1113d734231`
- **v2.8.2 Tag Dereference:** `43b6121698035d54978111fb17496b94f47156d4`
- **Secret Commit Ancestry Check:** `git merge-base --is-ancestor 48799bd354f94f6bc873f68d4772866fbf1778ea HEAD` returned exit code 1 (clean, not an ancestor).
- **Tracked Markdown Documentation:** All 19 tracked markdown reports were verified present and preserved in git from current HEAD before changes. No historical reports were deleted or modified. Specifically preserved:
  - `NTK_NOTE_V2_9_STAGE_3_FINAL_PRODUCT_ACCEPTANCE_REPORT.md`
  - `NTK_NOTE_V2_9_STAGE_3A_P0_ACCOUNT_ISOLATION_REMEDIATION_REPORT.md`

---

## 3. Codex Residual Findings & Exact Architectural Fixes

### Residual Finding A & B (S3-001): Direct Identity Replacement & Ambiguous UID Fallback
- **Problem:** When an identity transition from User A to User B occurred directly without a `clearAuth()` intermediate step, `MessagesView` retained `composerText` in component state until an asynchronous `useEffect` reloaded the draft, leaving a vulnerability window where User B could see or send User A's unsent draft. Furthermore, `auth.currentUser?.uid || storeUid` permitted stale fallbacks if store and auth were out of sync during transitions.
- **Remediation:**
  1. **Strict UID Authority Rule:** Implemented `resolveConfirmedUid(authUid, storeUid)` in `src/utils/chatService.ts`. Requires a valid, confirmed Firebase UID from `auth.currentUser` and verifies it matches `storeUid`. If either is missing, or if they mismatch during an in-flight identity transition, it fails closed to `null`.
  2. **Synchronous Transition Guard in `MessagesView.tsx`:** Replaced the asynchronous draft reloading effect with a synchronous render-phase state synchronization pattern using `composerState` and `reduceMessagesComposerState`. If `confirmedUid` or `activeChatId` changes, React immediately wipes `composerText` and clears in-memory chat messages before rendering or event handling can occur.
  3. **Fail-Closed Draft Storage:** `getChatDraftKey`, `getChatDraft`, `setChatDraft`, and `clearChatDraft` fail closed immediately when UID is unconfirmed, blank, or an invalid pseudo-identity (`guest`, `unknown`, `default`, `anonymous`).

### Residual Finding C & D (S3-002): Shared Version "guest" Fallback & selectedVersion Stale State
- **Problem:** Missing/blank/null UID fell back to `ntk:versions:guest:${noteId}`, creating a shared global sensitive bucket across unauthenticated or guest sessions. In addition, `selectedVersion` in `VersionHistory.tsx` survived an account transition, allowing the incoming user to preview and restore the previous account's snapshot.
- **Remediation:**
  1. **Eliminated Shared Guest Fallback:** Removed all `|| 'guest'` branches in `src/components/VersionHistory.tsx`. Implemented `getConfirmedVersionUid(uid)` which rejects null, undefined, blank strings, and pseudo-identities like `'guest'` or `'unknown'`.
  2. **Fail-Closed Version Operations:** `getVersionHistoryStorageKey`, `getVersions`, `saveVersion`, `saveLocalNoteSnapshot`, `deleteVersion`, and `clearVersions` return safe fallbacks (`''`, `[]`, `null`, or no-op) when UID is not confirmed. No storage keys with `guest` or `null` are ever created.
  3. **Synchronous selectedVersion Reset:** Implemented `uiState` and `reduceVersionHistoryUiState` in `VersionHistory.tsx`. The moment `confirmedUid` or `noteId` transitions, `selectedVersion` is synchronously reset to `null`, preventing cross-account snapshot exposure and unauthorized restoration.

### Residual Finding E: Stage 3A Test Isolation Failure
- **Problem:** Running `npx tsx --test --test-name-pattern="Stage 3A" tests/logic.test.ts` failed with 1 pass, 2 fail because the Node 22 test runner emitted `ExperimentalWarning: localStorage is not available because --localstorage-file was not provided` and earlier tests in `tests/logic.test.ts` that initialized `globalThis.localStorage` were skipped.
- **Remediation:**
  - Added self-contained `before`, `beforeEach`, and `after` hooks inside the Stage 3A test suite in `tests/logic.test.ts` that provision an independent `Map`-backed `MemoryStorage` mock for every individual test.
  - The suite is now 100% self-contained and runs with zero external dependencies.

---

## 4. Required Focused Test Suite Results

All 10 required focused tests were implemented using actual production imports and passed:

| Test ID | Description | Status | Details |
|---|---|---|---|
| **A** | S3-001 Valid A/B Scoped Draft | **PASS** | Drafts for User A and User B in deterministic chat are strictly isolated under `ntk:chat:draft:${uid}:${chatId}`. |
| **B** | S3-001 Direct Identity-Replacement Composer | **PASS** | `reduceMessagesComposerState` wipes `composerText` instantly on A -> B transition; `resolveConfirmedUid` fails closed to `null` on transition mismatch. |
| **C** | S3-001 Missing-UID Fail-Closed | **PASS** | Null, undefined, blank, and pseudo-identities (`guest`, `unknown`, `default`, `anonymous`) return `''`, write nothing, and create no keys. |
| **D** | S3-001 Anonymous Unique-UID | **PASS** | Two distinct Firebase anonymous UIDs (`anon-firebase-uid-abc-123`, `anon-firebase-uid-def-456`) receive strictly isolated draft keys. |
| **E** | S3-002 Valid A/B Shared-Note History | **PASS** | On a shared note, User A and User B local version histories are completely isolated under `ntk:versions:${uid}:${noteId}`. |
| **F** | S3-002 selectedVersion Identity-Reset | **PASS** | `reduceVersionHistoryUiState` immediately resets `selectedVersion` to `null` on account change; cannot be restored by incoming user. |
| **G** | S3-002 Missing-UID Fail-Closed | **PASS** | Missing/guest identities return `[]`, refuse snapshots, and create no `ntk:versions:guest:${noteId}` keys. |
| **H** | S3-002 Two Anonymous Unique-UID Isolation | **PASS** | Distinct anonymous UIDs produce completely independent version history namespaces. |
| **I** | Legacy Non-Migration | **PASS** | Obsolete unscoped `ntk:chat:draft:${chatId}` and `ntk-versions-${noteId}` keys are quarantined and never migrated to user accounts. |
| **J** | Auth Clearing State Reset | **PASS** | `clearAuth()` cleanly resets `activeChatId` and `aiNoteContext` in memory. |

---

## 5. Local Quality Gates & Verification

| Gate | Command | Result |
|---|---|---|
| **Targeted Stage 3A Test** | `npx tsx --test --test-name-pattern="Stage 3A" tests/logic.test.ts` | **PASS** (10 tests, 2 suites, 10 passed, 0 failed, 4.43s) |
| **Full Logic Tests** | `npm test` | **PASS** (301 tests, 45 suites, 301 passed, 0 failed, 9.33s) |
| **Firestore Security Rules** | `npm run test:rules` | **PASS** (24 tests, 1 suite, 24 passed, 0 failed, 19.88s) |
| **Frontend TypeScript** | `npx tsc --noEmit` | **PASS** (0 errors) |
| **Worker TypeScript** | `npm --prefix cloudflare/ntk-gateway run typecheck` | **PASS** (0 errors) |
| **Production Build** | `npm run build` | **PASS** (`dist/index.html` 2,766.06 kB │ gzip: 775.41 kB in 19.90s) |
| **Secret Scan** | `node scripts/audit_secrets.mjs` | **PASS** (150 files scanned, 0 findings) |

---

## 6. Frontend Deployment

- **Hosting Platform:** Firebase Hosting (`ntk-note`)
- **Deploy Command:** `npx firebase deploy --only hosting --project ntk-note`
- **Output:**
  ```
  === Deploying to 'ntk-note'...
  i  deploying hosting
  i  hosting[ntk-note]: beginning deploy...
  i  hosting[ntk-note]: found 9 files in dist
  i  hosting: upload complete
  +  hosting[ntk-note]: file upload complete
  i  hosting[ntk-note]: finalizing version...
  +  hosting[ntk-note]: version finalized
  i  hosting[ntk-note]: releasing new version...
  +  hosting[ntk-note]: release complete
  +  Deploy complete!
  Hosting URL: https://ntk-note.web.app
  ```
- **Status:** **LIVE ON PRODUCTION**

---

## 7. Live Owner Acceptance Routing & Invariant Audits

- **Required Release Owner Profile:** `FEAICCWS` (`feaiccws@gmail.com`)
- **BrowserOS Neo Session:** Active browser session (`eaace9fa-5b92-419a-bf21-d1370e7ebc0c`) contains user tab `appdevmanwill@gmail.com`.
- **Policy Adherence:** Per Section 27 and 29 of the specification:
  - "If FEAICCWS profile is unavailable: do not substitute another owner. Record: LIVE TEST SAFELY BLOCKED."
  - "Guest is NEVER acceptable for owner release acceptance."
  - "If account switching cannot safely be performed: do not fabricate PASS. Source + behavioral tests may become complete while: FINAL LIVE A/B ACCEPTANCE = PENDING."
- **Live Test Record:** **LIVE TEST SAFELY BLOCKED** / **FINAL LIVE A/B ACCEPTANCE = PENDING**

### Spark Plan Invariants
- **Plan:** Spark (100% Free Tier)
- **Billing:** Zero cost
- **Cloud Functions:** 0
- **App Hosting:** 0
- **Firestore Databases:** 1 (`(default)`)
- **Cloudflare Worker Changes:** 0 files modified
- **Firestore Rules Changes:** 0 files modified

---

## 8. Remaining Stage 3 Scope (Deferred to Stages 3B & 3C)

As strictly mandated by the specification, the following findings remain untouched and deferred:
- **P1 Findings:** S3-003 through S3-008
- **P2 Findings:** S3-009 through S3-014
- Release tagging (`v2.9.0`), git merge to `main`, and Stage 4 are not started.
