# NTK Note v2.9 — Stage 3A.5 Authority-Injection & Stored-Owner Closure Report

**Date:** September 11, 2026  
**Target Branch:** `final-novice-ux`  
**Starting HEAD:** `131bdb73daa1852c27a5d49d041152777f311ab0`  
**Frozen Rollback Target (v2.8.2):** `43b6121698035d54978111fb17496b94f47156d4`  
**Historical Secret-Bearing Commit:** `48799bd354f94f6bc873f68d4772866fbf1778ea` (Confirmed NOT an ancestor)  

---

## 1. Executive Summary & Verdict Assessment

The independent Codex / GPT-5.6 Sol Ultra audit issued the following baseline verdict:
- **S3-001:** CLOSED
- **S3-002:** OPEN
- **Overall Audit Finding:** C. FAIL — S3-002 P0 Exposure Remains

Codex identified two concrete defects:
1. **P0 Authority-Injection Seam:** Production Version History functions accepted a `SessionAuthorityOverrides` argument (`currentAuthUid`, `currentStoreUid`). Under an active session for User B, an unauthorized caller could pass `{ currentAuthUid: 'userA', currentStoreUid: 'userA' }` to read, write, or delete User A's history.
2. **P1 Stored-Owner Read-Integrity Gap:** `getVersions` read parsed entries from a confirmed user's namespace without validating each stored `version.uid`. Seeded foreign, ownerless, or placeholder records in a namespace leaked across boundaries.

Stage 3A.5 closes both defects. S3-001 remains closed. Work on non-P0 items (S3-003 through S3-014) remains untouched for subsequent stages.

---

## 2. Tracked Markdown Restoration

Before modifying source files, git status confirmed 23 tracked Markdown reports missing from the working tree. A git checkout restored all 23 files directly from HEAD:
1. `NTK_BASELINE_RECONCILIATION_REPORT.md`
2. `NTK_INFRASTRUCTURE_DUPLICATE_INVENTORY.md`
3. `NTK_LIVE_IDENTITY_AND_DUPLICATE_CLEANUP_REPORT.md`
4. `NTK_NOTE_FINAL_PRODUCTION_RUNBOOK.md`
5. `NTK_NOTE_PRE_UPGRADE_BASELINE_REPORT.md`
6. `NTK_NOTE_V2_4_FINAL_RELEASE_REPORT.md`
7. `NTK_NOTE_V2_5_PEOPLE_MESSAGING_AI_REPORT.md`
8. `NTK_NOTE_V2_5_SECURITY_AND_FREE_ZONE_CLOSURE_REPORT.md`
9. `NTK_NOTE_V2_6_RECYCLE_BIN_AND_DATA_LIFECYCLE_REPORT.md`
10. `NTK_NOTE_V2_7_AUDIO_AND_LISTEN_RELEASE_REPORT.md`
11. `NTK_NOTE_V2_8_1_FINAL_PRODUCTION_RELEASE_REPORT.md`
12. `NTK_NOTE_V2_8_2_FINAL_PRODUCTION_RELEASE_REPORT.md`
13. `NTK_NOTE_V2_8_RELIABILITY_SYNC_OFFLINE_PERFORMANCE_REPORT.md`
14. `NTK_NOTE_V2_9_STAGE_1_NAVIGATION_ACCOUNT_UX_REPORT.md`
15. `NTK_NOTE_V2_9_STAGE_2_NATIVE_MOBILE_AND_NOVICE_UX_REPORT.md`
16. `NTK_NOTE_V2_9_STAGE_3A_1_FINAL_P0_ISOLATION_CLOSURE_REPORT.md`
17. `NTK_NOTE_V2_9_STAGE_3A_2_PRODUCTION_AUTH_HANDOFF_P0_CLOSURE_REPORT.md`
18. `NTK_NOTE_V2_9_STAGE_3A_3_VERSION_HISTORY_SESSION_AUTHORITY_P0_CLOSURE_REPORT.md`
19. `NTK_NOTE_V2_9_STAGE_3A_4_VERSION_HISTORY_READ_WRITE_AUTHORITY_P0_CLOSURE_REPORT.md`
20. `NTK_NOTE_V2_9_STAGE_3A_P0_ACCOUNT_ISOLATION_REMEDIATION_REPORT.md`
21. `NTK_NOTE_V2_9_STAGE_3_FINAL_PRODUCT_ACCEPTANCE_REPORT.md`
22. `NTK_SOURCE_DUPLICATE_AUDIT.md`
23. `REPORT.md`

All 23 historical reports remain intact and unchanged.

---

## 3. Root Cause & Remediation Details

### A. Removal of Authority-Override Seam (P0)

- **Root Cause:** In Stage 3A.4, `sessionAuthority.ts` exported `SessionAuthorityOverrides` to permit test callers to supply `currentAuthUid` and `currentStoreUid`. Production helpers forwarded this object. This design allowed malicious application callers to bypass active authentication state.
- **Fix:** Removed the `SessionAuthorityOverrides` interface from `src/utils/sessionAuthority.ts` and `src/components/VersionHistory.tsx`. `isAuthorizedSession(requestedUid)` now queries `getAuthUid()` and `getStoreUid()` directly. Callers pass only the requested UID.
- **Production Boundary:** `getVersions`, `saveVersion`, `saveLocalNoteSnapshot`, `deleteVersion`, `clearVersions`, and `executeVersionRestore` no longer accept caller-supplied authority overrides. Extra arguments passed at runtime are ignored and fail closed.

### B. Stored Version Owner Validation on Read (P1)

- **Root Cause:** `getVersions` parsed JSON entries from `note_versions_<uid>_<noteId>` without checking each item's `uid` property.
- **Fix:** `getVersions` now filters every parsed version entry:
  ```ts
  const owner = getConfirmedVersionUid(item.uid);
  if (!owner || owner !== confirmed) {
    return false;
  }
  ```
  Entries with missing UIDs, invalid types, foreign owners, or placeholders (`guest`, `unknown`, `default`, `anonymous`) fail closed and disappear from returned history.

---

## 4. Test Suite Verification

### Stage 3A.5 Focused Test Suite (`Stage 3A.5 — Authority Injection Removal & Stored Owner Validation`)

All 18 tests pass:
- **A. Auth B/B requesting A `getVersions`:** Returns `[]`.
- **B. Extra runtime forged override argument:** Ignored, returns `[]`.
- **C. Auth B/B requested A `saveVersion`:** Returns `false`.
- **D. Runtime forged override argument on save:** Ignored, returns `false`, 0 writes.
- **E. Auth B/B requested A `clearVersions`:** Returns `false`, history untouched.
- **F. Runtime forged override argument on clear:** Ignored, returns `false`, history untouched.
- **G. `deleteVersion` authority behavior:** Returns `false` for cross-account and forged calls.
- **H. Restore authority bypass elimination:** Caller-supplied identities fail closed.
- **I. Confirmed A reads own valid version:** Returns stored record.
- **J. Confirmed A filters B-owned entry from A namespace:** Excludes foreign entry.
- **K. Confirmed A filters ownerless entries:** Excludes null/undefined UIDs.
- **L. Confirmed A filters placeholder owners:** Excludes `guest`, `unknown`, `default`, `anonymous`.
- **M. Anonymous isolation:** Confirmed `anon1` session excludes `anon2` records.
- **N. Omitted UID `saveVersion` regression:** Returns `false`.
- **O. Mismatched-owner save regression:** Returns `false`.
- **P. Valid same-session save:** Succeeds and returns `true`.
- **Q. Prior Restore tests:** All pass.
- **R. S3-001 stale Send regression:** Passes.

### Combined Security Suites

Running `npx tsx --test --test-name-pattern="Stage 3A"` passes 71 tests across 6 suites with 0 failures:
- Stage 3A: 10 passed
- Stage 3A.2: 14 passed
- Stage 3A.3: 16 passed
- Stage 3A.4: 13 passed
- Stage 3A.5: 18 passed

---

## 5. Full Quality Gates

1. **Unit & Integration Suite (`npm test`):**
   - 362 passed, 0 failed across 49 suites (duration: 10.1s)
2. **Firestore Security Rules (`npm run test:rules`):**
   - 24 passed, 0 failed against Firestore emulator (duration: 19.5s)
3. **Frontend TypeScript Check (`npx tsc --noEmit`):**
   - 0 errors
4. **Cloudflare Worker Type Check (`npm --prefix cloudflare/ntk-gateway run typecheck`):**
   - 0 errors
5. **Production Build (`npm run build`):**
   - Built singlefile bundle in 21.37s (`dist/index.html`: 2,768.73 kB, gzip: 776.44 kB)
6. **Secret Audit (`node scripts/audit_secrets.mjs`):**
   - 155 files scanned, 0 findings

---

## 6. Deployment & Infrastructure Invariants

- **Command:** `npx firebase deploy --only hosting --project ntk-note`
- **Result:** Deployment complete. Release URL: `https://ntk-note.web.app`
- **Infrastructure Changes:**
  - Cloudflare Worker modified: NO (0 changes)
  - Firestore rules modified: NO (0 changes)
  - Firebase indexes modified: NO (0 changes)
  - Cloudflare KV / R2 / Backblaze B2 modified: NO (0 changes)
  - Plan / Billing: Firebase Spark (free-tier only, no Cloud Functions, no App Hosting)

---

## 7. Live Owner Acceptance Status

Required BrowserOS Neo profile: `FEAICCWS` (`feaiccws@gmail.com`).
During inspection, BrowserOS Neo held active session for `appdevmanwill@gmail.com`. Profile `feaiccws@gmail.com` was not loaded. In accordance with Section 31:
- **LIVE TEST SAFELY BLOCKED**
- **FINAL LIVE A/B ACCEPTANCE = PENDING**

---

## 8. Stage 3 Residual Scope

Non-P0 audit items remain for subsequent stages:
- S3-003 through S3-014 (UX improvements, extended performance optimizations, secondary novice-first refinements).
- No work commenced on Stage 3B.
- No merge, tag, or final release push executed.
