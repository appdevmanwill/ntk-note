# NTK NOTE v2.9 — STAGE 3A.3 VERSION-HISTORY SESSION-AUTHORITY P0 CLOSURE REPORT

**Timestamp:** 2026-09-11  
**Project:** NTK Note  
**Branch:** `final-novice-ux`  
**Starting HEAD:** `f71f3b8a085a2cfc31580cac43783d1a03a03a15`  
**Target Frozen Rollback (`v2.8.2`):** `43b6121698035d54978111fb17496b94f47156d4` (Verified)  
**Historical Secret Ancestry Check:** `git merge-base --is-ancestor 48799bd354f94f6bc873f68d4772866fbf1778ea HEAD` returned exit code 1 (NOT an ancestor).

---

## 1. Executive Summary & Audit Verdict

Following the completion of Stage 3A.2, an independent re-audit by Codex / GPT-5.6 Sol Ultra delivered the following authoritative findings:
* **S3-001 (Message / Draft Isolation):** **CLOSED**. No regressions allowed or introduced.
* **S3-002 (Version History Account / Session Isolation):** **CONDITIONAL — SMALL P0 CORRECTION REQUIRED**.

Codex identified three precise residual defects in Version History:
1. **Omitted UID ambient fallback:** Sensitive helpers could resolve identity from ambient state (`auth.currentUser` or `useStore.getState().uid`) when caller omitted UID.
2. **Explicit UID bypassed session coherence:** Supplying an explicit UID (e.g. `clearVersions(noteId, 'userA')`) executed against User A's storage even when Firebase Auth was `null` or belonged to User B.
3. **Ownerless and placeholder versions failed open at Restore:** Historical versions with missing (`undefined`, `null`, `""`) or placeholder (`guest`, `unknown`) `uid` passed the restore boundary and triggered `onRestore`.

**Stage 3A.3 Result:** All three residual defects have been mathematically and architecturally eliminated. The security invariant `Auth UID === Store UID === Expected Session UID === Version Owner UID` is now strictly enforced across all reads, writes, deletes, clears, and restores.

---

## 2. Root Cause Analysis & Security Remediation

### A. Defect 1: Omitted UID Ambient Fallback
* **Pre-remediation:** Calling `getVersions(noteId)` with omitted UID fell back to ambient store state, leaking User A's snapshots during an unconfirmed session where Auth was `null`.
* **Fix:** Removed all ambient fallbacks from `getVersions`, `saveVersion`, and `saveLocalNoteSnapshot`.
* **Behavior:** Missing, null, undefined, blank, or placeholder UIDs immediately fail closed (`[]` for reads, `null` for snapshot saves, no-op for persists).

### B. Defect 2: Explicit UID Bypassed Session Coherence
* **Pre-remediation:** `clearVersions(noteId, 'userA')` and `deleteVersion(noteId, versionId, 'userA')` permitted actions on User A's history if caller explicitly passed `'userA'`, even if active Firebase Auth was `null` or logged in as User B.
* **Fix:** Integrated strict session authority checking (`isAuthorizedSession`) into `clearVersions`, `deleteVersion`, `saveVersion`, and `saveLocalNoteSnapshot`. An explicit UID is treated strictly as an identity input, never sufficient authority.
* **Invariant:** Operations execute only when `currentAuthUid === currentStoreUid === targetUid`. Any mismatch (e.g., Auth `null` / Store `userA`, Auth `userB` / Store `userB` requesting `userA`) fails closed (`false` or `null`) with zero modifications to localStorage.

### C. Defect 3: Ownerless / Placeholder Versions at Restore Boundary
* **Pre-remediation:** `executeVersionRestore` checked only whether a version's UID mismatched the confirmed UID if present, allowing ownerless versions (`uid: undefined`) or pseudo-identities (`uid: 'guest'`) to invoke `onRestore`.
* **Fix:** `executeVersionRestore` now strictly mandates `getConfirmedVersionUid(version.uid)`.
* **Validation:** Rejects `undefined`, `null`, `""`, `"   "`, `"guest"`, `"unknown"`, `"default"`, `"anonymous"`.
* **Equivalence:** Enforces `versionOwner === confirmedUid`. If missing, invalid, or mismatched, returns `{ success: false, reason: 'INVALID_VERSION_OWNER' | 'AUTH_MISMATCH' }` and never calls `onRestore` or saves a pre-restore snapshot.

### D. Strict Confirmed-Session Semantics
* Implemented `isStrictConfirmedSession(authUid, storeUid, expectedSessionUid)`.
* Unlike generic session helpers that treat missing expected UID as "no assertion", `isStrictConfirmedSession` mandates `expectedSessionUid` and enforces `authUid === storeUid === expectedSessionUid`.

### E. Anonymous Firebase Account Support
* Real Firebase anonymous UIDs (e.g. `anon-firebase-real-123`) remain fully valid and isolated.
* Distinct anonymous UIDs maintain mutually inaccessible version histories and cannot restore, read, delete, or clear each other's versions.

---

## 3. Focused Test Suite: Stage 3A.3

A dedicated 16-test suite (`Stage 3A.3`) was implemented in `tests/logic.test.ts` covering all requirements and reproduction cases:

1. **Test A (Omitted UID read fails closed):** `getVersions('note')` returns `[]` when Auth is null and Store is `userA`.
2. **Test B (Omitted UID save fails closed):** `saveLocalNoteSnapshot` with omitted/null UID returns `null` and saves nothing.
3. **Test C (Auth null / Store A delete rejected):** `deleteVersion(..., 'userA')` fails closed (`false`) when Auth is null; history remains intact.
4. **Test D (Auth null / Store A clear rejected):** `clearVersions(..., 'userA')` fails closed (`false`) when Auth is null; history remains intact.
5. **Test E (Auth B / Store B / explicit A mutation rejected):** User B cannot delete, clear, or snapshot under `userA`.
6. **Test F (Auth A / Store A / explicit A operations succeed):** Snapshot save, delete, and clear succeed when fully confirmed.
7. **Test G (Ownerless version Restore rejected):** Version with `uid: undefined` fails closed; `onRestore` not called.
8. **Test H (Blank-owner Restore rejected):** Versions with `uid: null`, `""`, `"   "` fail closed.
9. **Test I (Placeholder-owner Restore rejected):** Versions with `uid: "guest"`, `"unknown"`, `"default"`, `"anonymous"` fail closed.
10. **Test J (Mismatched A-owned version under confirmed B rejected):** User B cannot restore User A's snapshot.
11. **Test K (Valid A-owned version under confirmed A succeeds):** Valid ownership restores cleanly.
12. **Test L (Genuine Firebase anonymous UID-owned version succeeds):** Unique anonymous UID restores cleanly when confirmed.
13. **Test M (Two genuine anonymous UIDs remain isolated):** Anon 1 and Anon 2 cannot read, clear, or restore each other's versions.
14. **Test N (Legacy unscoped history non-migration):** Obsolete `ntk-versions-${noteId}` keys are quarantined and cleaned up, never migrated into user accounts.
15. **Test O (Section 16 Reproduction Cases 1 through 8):** Exhaustive verification of Cases 1–8.
16. **Test P (Strict confirmed-session helper invariants):** Verifies `isStrictConfirmedSession` and `isAuthorizedSession`.

### Focused Execution Results
* `npx tsx --test --test-name-pattern="Stage 3A.3" tests/logic.test.ts`: **16/16 passed** (0 failures).
* `npx tsx --test --test-name-pattern="Stage 3A" tests/logic.test.ts`: **40/40 passed** (Stage 3A: 10/10, Stage 3A.2: 14/14, Stage 3A.3: 16/16).
* **S3-001 Regression Check:** All messaging isolation tests passed without modification.

---

## 4. Full Local Quality Gates

| Gate | Command | Result | Details |
|---|---|---|---|
| **Logic Tests** | `npm test` | **PASS** | 331 passed across 47 suites, 0 failures |
| **Rules Tests** | `npm run test:rules` | **PASS** | 24 passed against live Firestore emulator |
| **Frontend TypeScript** | `npx tsc --noEmit` | **PASS** | 0 errors |
| **Worker TypeScript** | `npm --prefix cloudflare/ntk-gateway run typecheck` | **PASS** | 0 errors |
| **Production Build** | `npm run build` | **PASS** | Single-file bundle: 2,768.57 kB (gzip: 776.40 kB), built in 45.53s |
| **Secret Scan** | `node scripts/audit_secrets.mjs` | **PASS** | 153 files scanned, 0 findings |

---

## 5. Infrastructure & Deployment Status

* **Infrastructure Invariance:** Zero modifications to Cloudflare Worker, KV, R2, B2, Firestore rules, or Firebase indexes.
* **Firebase Plan:** Spark (100% free tier / no-cost), 0 Cloud Functions, 0 App Hosting, 1 standard Firestore database.
* **Frontend Deployment:** Successfully deployed to Firebase Hosting via `npx firebase deploy --only hosting --project ntk-note`.
  * **Hosting URL:** `https://ntk-note.web.app`

---

## 6. Live Acceptance Status

* **Required BrowserOS Profile:** `FEAICCWS` (`feaiccws@gmail.com`).
* **Active BrowserOS Session Profile:** `appdevmanwill@gmail.com`.
* **Section 26 Compliance:** Per explicit instructions, since the required owner profile `feaiccws@gmail.com` was not active in BrowserOS, live acceptance was not fabricated:
  * **LIVE TEST SAFELY BLOCKED**
  * **FINAL LIVE A/B ACCEPTANCE = PENDING**

---

## 7. Next Steps & Stage 3 Posture

* **S3-001:** CLOSED.
* **S3-002:** REMEDIATED & READY FOR FINAL CODEX TARGETED RE-AUDIT.
* **DO NOT START STAGE 3B YET.** S3-003 through S3-014 remain deferred pending final S3-002 certification.
