# NTK NOTE v2.9 — STAGE 3A.2 PRODUCTION AUTH-HANDOFF P0 CLOSURE REPORT

**Date:** September 11, 2026  
**Branch:** `final-novice-ux`  
**Starting HEAD:** `5fe05e4f35e08c3d84006ff3f93b7318e6dc7fc4`  
**Target Frozen v2.8.2 Commit:** `43b6121698035d54978111fb17496b94f47156d4` (verified)  
**Historical Secret-Bearing Commit:** `48799bd354f94f6bc873f68d4772866fbf1778ea` (verified NOT an ancestor of HEAD)  
**Tracked Documentation Hygiene:** 19 tracked markdown reports restored from current HEAD prior to code modifications; all historical reports preserved intact.  

---

## 1. Executive Summary & Audit Context

Following Stage 3A.1, an independent re-audit by Codex / GPT-5.6 Sol Ultra identified that while underlying storage helpers correctly scoped local data to user UIDs, residual P0 cross-account exposure remained at **real production auth transition and event-handler boundaries**:

1. **S3-001 (Send Message Race):**
   - In direct Firebase Auth replacement (User A $\to$ User B), Firebase Auth immediately becomes User B while Zustand/store hydration and React re-renders are asynchronous.
   - A previously rendered `MessagesView` event handler holding User A's unsent composer text could be invoked during this window.
   - Because `sendMessage()` previously read `auth.currentUser.uid` dynamically, it constructed `senderUid = User B` and sent User A's private draft to Firestore as User B.
   - `MessagesView` also retained User A's chat list metadata and previews until passive subscription effects caught up.

2. **S3-002 (Version History Precedence & Restore Race):**
   - `VersionHistory` derived active UID using unsafe winner-takes-first precedence: `storeUid || authUid`. During Auth B / Store A, it treated User A as active.
   - Omitted-UID version helpers fell back to ambient identity without requiring agreement between auth and store.
   - User A's `selectedVersion` remained visible and actionable, allowing incoming User B to restore User A's private historical snapshot into User B's current note.

**Stage 3A.2 Mandate:** Close these residual P0 flaws at the exact production event boundaries without relying on React render timing, enforce a canonical confirmed-session invariant, eliminate unsafe UID fallback precedence, verify through tests reproducing the async hydration window, pass all local gates, and deploy frontend hosting.

---

## 2. Root Cause Analysis

- **Asynchronous Hydration Gap:** When Firebase authentication transitions (via login, switch, or token exchange), `auth.currentUser` updates synchronously in the Firebase SDK, but workspace data hydration (`initFirestore`, fetching user profile, notebook tree, Zustand store update) and React component tree reconciliation occur asynchronously.
- **Stale Closures at Event Execution:** React event handlers close over state and props from their render pass. If an action occurs after `auth.currentUser` changes but before the component re-renders, the event handler executes with stale component state but fresh ambient auth state.
- **Winner-Takes-First Fallbacks:** Expressions like `storeUid || authUid` or helper fallbacks that consult ambient state independently allow mismatched identities to proceed under whichever identity appears first in the expression.

---

## 3. Architecture & Implementation Remediation

### 3.1 Central Confirmed-Session Authority (`src/utils/sessionAuthority.ts`)
A dedicated, pure authority module enforces the canonical session coherence invariant:
> **Session Coherence Invariant:** An account-bound action may execute if and only if:
> $\text{Firebase Auth UID exists} \land \text{Store Workspace UID exists} \land \text{Firebase Auth UID} === \text{Store Workspace UID} \land \text{Expected Action Session UID} === \text{Confirmed UID}$.

- `resolveConfirmedUid(authUid, storeUid)`: Returns the confirmed UID only when `authUid === storeUid` and neither is empty or a placeholder identity (`guest`, `unknown`, `default`, `anonymous`). Returns `null` (FAIL CLOSED) on any mismatch or invalid identity. Genuine Firebase anonymous UIDs remain fully supported.
- `isConfirmedSession(currentAuthUid, currentStoreUid, expectedSessionUid)`: Returns `true` only when `currentAuthUid === currentStoreUid === expectedSessionUid`.
- Decoupled store UID getter registry (`setStoreUidGetter`, `getStoreUid`) avoids circular dependencies between `store/index.ts` and utility modules.

### 3.2 Synchronous Auth Transition Invalidation (`src/App.tsx` & `src/store/index.ts`)
- In `App.tsx`'s `onAuthStateChanged`, before launching asynchronous `initFirestore(user.uid)`, an immediate synchronous check invalidates state:
  ```ts
  if (state.uid && state.uid !== nextUid) {
    state.clearAuth();
  }
  ```
- In `store/index.ts`, `clearAuth()` synchronously resets `activeChatId = null`, `aiNoteContext = null`, and increments `authEpoch: number`.

### 3.3 S3-001 Event-Time Defense in Messaging (`src/utils/chatService.ts` & `src/components/MessagesView.tsx`)
- **Transport / Service Layer (`sendMessage`):**
  - Accepts `expectedSenderUid` and optional execution overrides (`currentAuthUid`, `currentStoreUid`).
  - Evaluates `resolveConfirmedUid(authUid, storeUid)`. If `null`, throws `AUTH_TRANSITION_ABORT: No confirmed session active`.
  - Verifies `expectedSenderUid === confirmedUid`. If mismatched, throws `AUTH_TRANSITION_ABORT: Stale sender session`.
  - Guarantees **ZERO Firestore writes** (no message document, no chat summary update, no `lastMessagePreview`, no read timestamp) on mismatch.
  - Exported `executeSendMessage(params)` controller returning `{ success: boolean, error?: string }`.
- **Component Layer (`MessagesView.tsx`):**
  - Synchronous render guard immediately clears `chats: []`, `messages: []`, `composerState.text = ''`, and `actionError = ''` when `confirmedUid` transitions or becomes `null`.
  - `handleComposerChange` checks `isConfirmedSession(auth.currentUser?.uid, storeUid, myUid)` at keystroke time before persisting drafts to storage.
  - `handleSendMessage` checks `isConfirmedSession` at click/Enter time, passes `expectedSenderUid: sendingUid`, and handles abort cleanly without leaking errors.

### 3.4 S3-002 Elimination of Unsafe Precedence & Event-Time Restore Defense (`src/components/VersionHistory.tsx`)
- **Eliminated Unsafe Precedence:** Removed all instances of `storeUid || auth.currentUser?.uid` and `authUid || storeUid`.
- Component resolves identity strictly via `resolveConfirmedUid(auth.currentUser?.uid, storeUid)`. During Auth B / Store A mismatch, `confirmedUid` is `null` and the view immediately fails closed.
- **Removed Ambient Fallback:** Version helpers (`getVersions`, `saveVersion`, `saveLocalNoteSnapshot`, `clearVersions`, `deleteVersion`, `useVersionHistory`) strictly evaluate confirmed UIDs. If UID is missing or unconfirmed, they immediately return `[]` or no-op.
- **Event-Time Restore Defense (`executeVersionRestore`):**
  - Validates at event execution time:
    1. Current Firebase Auth UID exists and is confirmed.
    2. Current store UID exists and is confirmed.
    3. Auth UID === Store UID.
    4. Expected session UID === Confirmed UID.
    5. Version owner UID === Confirmed UID.
    6. Target `noteId` === Version `noteId`.
  - If any condition fails, the restore is REJECTED and `onRestore` is NEVER invoked.

---

## 4. Test Verification at Production Event Boundaries

### 4.1 Stage 3A.2 Focused Test Matrix (`tests/logic.test.ts`)
A dedicated suite `describe('Stage 3A.2 — Final Production Auth-Handoff P0 Closure')` was added to test the exact production controllers (`executeSendMessage`, `executeVersionRestore`) and authorities:

| Test Case | Description | Result |
|---|---|---|
| **A** | Auth A / Store A confirmed session authority | **PASS** |
| **B** | Auth B / Store A fails closed without confirmed session | **PASS** |
| **C** | Auth B / Store B confirmed session authority | **PASS** |
| **D** | S3-001 stale Send action rejected during Auth B / Store A transition window (0 writes) | **PASS** |
| **E** | S3-001 stale composer cannot persist draft after Auth becomes B | **PASS** |
| **F** | S3-001 chat list and message preview cleared during transition | **PASS** |
| **G** | S3-001 new B session confirmed and recognized by session authority | **PASS** |
| **H** | S3-002 selectedVersion becomes unusable during Auth B / Store A mismatch | **PASS** |
| **I** | S3-002 Restore action rejected during Auth B / Store A transition window | **PASS** |
| **J** | S3-002 History delete/clear cannot cross account boundary | **PASS** |
| **K** | S3-002 User B cannot read User A local history | **PASS** |
| **L** | S3-001 & S3-002 Firebase anonymous UID 1 and UID 2 remain independent | **PASS** |
| **M** | S3-001 & S3-002 Missing UID and pseudo-identities fail closed across all authorities | **PASS** |
| **N** | S3-001 & S3-002 Legacy unscoped chat and version data remains non-migrated | **PASS** |

### 4.2 Independent & Full Test Suite Execution
- `npx tsx --test --test-name-pattern="Stage 3A.2" tests/logic.test.ts`: **14/14 PASS** (independent)
- `npx tsx --test --test-name-pattern="Stage 3A" tests/logic.test.ts`: **24/24 PASS** (Stage 3A + 3A.2)
- `npm test`: **315/315 PASS** across 46 test suites (0 failures, 0 skipped)
- `npm run test:rules`: **24/24 PASS** (Firestore security rules unit tests against emulator)
- `npx tsc --noEmit`: **0 errors** (Frontend TypeScript clean)
- `npm --prefix cloudflare/ntk-gateway run typecheck`: **0 errors** (Worker TypeScript clean)
- `npm run build`: **Built in 19.57s** (`dist/index.html` 2,768.23 kB, gzip: 776.26 kB)
- `node scripts/audit_secrets.mjs`: **152 files scanned, 0 findings**

---

## 5. Deployment & Live Acceptance Status

- **Frontend Deployment:** Deployed to Firebase Hosting (`https://ntk-note.web.app`) via `npx firebase deploy --only hosting --project ntk-note`.
- **Infrastructure Discipline:** No changes made to Cloudflare Worker, Firestore rules, R2, B2, KV, or database configurations. Firebase project remains on the Spark (free) plan with 0 Cloud Functions and 0 App Hosting backends.
- **Live Acceptance Status:**
  - BrowserOS Neo was inspected; the active session contains `appdevmanwill@gmail.com`, but the required owner account `feaiccws@gmail.com` (profile `FEAICCWS`) is not available.
  - Per Sections 31 & 33, `appdevmanwill@gmail.com` and Guest accounts are strictly forbidden from substituting for owner acceptance.
  - **Verdict:** `FINAL LIVE A/B ACCEPTANCE = PENDING` | `LIVE TEST SAFELY BLOCKED`.

---

## 6. Authoritative State Table

| Attribute | State |
|---|---|
| **Branch** | `final-novice-ux` |
| **Starting HEAD** | `5fe05e4f35e08c3d84006ff3f93b7318e6dc7fc4` |
| **Ending HEAD** | (Recorded upon commit) |
| **v2.8.2 Target** | `43b6121698035d54978111fb17496b94f47156d4` (verified) |
| **Historical Secret Ancestor** | Not an ancestor (`48799bd3...`, exit code 1) |
| **Markdown Deletions Restored** | 19 tracked markdown reports restored from HEAD |
| **Historical Reports Preserved** | Stage 3, Stage 3A, and Stage 3A.1 reports intact |
| **Central Confirmed-Session Authority** | `sessionAuthority.ts` (`resolveConfirmedUid`, `isConfirmedSession`) |
| **Auth B / Store A Behavior** | Fails closed to `null` / unconfirmed |
| **S3-001 Stale Send Rejected** | Rejected with `AUTH_TRANSITION_ABORT`, 0 Firestore writes |
| **S3-001 Stale Draft Persist Rejected** | Blocked at event time via `isConfirmedSession` |
| **S3-001 Chat List Invalidation** | Synchronously cleared on transition / incoherence |
| **S3-001 B Confirmed Behavior** | Full normal messaging after B confirms |
| **S3-001 Anonymous Behavior** | Distinct anonymous UIDs isolated |
| **S3-001 Legacy Policy** | Quarantined and non-migrated |
| **S3-002 Unsafe OR Fallback Removed** | All `storeUid \|\| authUid` precedence removed |
| **S3-002 Omitted UID Ambiguity Removed** | Helpers fail closed on missing/invalid UID |
| **S3-002 selectedVersion Transition** | Immediately cleared to `null` on UID change |
| **S3-002 Stale Restore Rejected** | Rejected at event time via `executeVersionRestore` |
| **S3-002 Destructive Actions Guarded** | `deleteVersion` and `clearVersions` strictly scoped |
| **S3-002 Anonymous Behavior** | Distinct anonymous UIDs isolated |
| **S3-002 Legacy Policy** | Quarantined and non-migrated |
| **Stage 3A.2 Focused Tests** | 14/14 PASS |
| **Original Stage 3A Tests** | 10/10 PASS (Total 24/24 PASS) |
| **Full Logic Tests** | 315/315 PASS (46 suites) |
| **Rules Tests** | 24/24 PASS |
| **Frontend TypeScript** | Clean (0 errors) |
| **Worker TypeScript** | Clean (0 errors) |
| **Production Build** | 2,768.23 kB (gzip: 776.26 kB) |
| **Secret Scan** | 152 files, 0 findings |
| **Frontend Deployment** | Deployed (`https://ntk-note.web.app`) |
| **Worker Changed** | No |
| **Rules Changed** | No |
| **BrowserOS Owner Account** | `feaiccws@gmail.com` (unavailable in session) |
| **Live A/B Result** | FINAL LIVE A/B ACCEPTANCE = PENDING (LIVE TEST SAFELY BLOCKED) |
| **Firebase Spark / Billing** | Spark plan, no billing, 0 Functions, 0 App Hosting, 1 Firestore DB |
| **Working Tree** | Clean upon commit |
