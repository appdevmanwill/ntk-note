# NTK Note v2.9 — Stage 3A.4 Version-History Read/Write Authority P0 Closure Report

**Date:** September 11, 2026  
**Target Branch:** `final-novice-ux`  
**Starting HEAD:** `e7d63ccd3e759e76fe62d352455d5334fff59841`  
**Frozen Rollback Target (v2.8.2):** `43b6121698035d54978111fb17496b94f47156d4`  
**Historical Secret-Bearing Commit:** `48799bd354f94f6bc873f68d4772866fbf1778ea` (Confirmed NOT an ancestor)  

---

## 1. Executive Summary & Verdict Assessment

The independent Codex / GPT-5.6 Sol Ultra audit issued the following baseline verdict:
- **S3-001:** CLOSED
- **S3-002:** OPEN
- **Overall Audit Finding:** C. FAIL — S3-002 P0 Exposure Remains

The audit reproduced three specific implementation defects in `src/components/VersionHistory.tsx`:
1. **Explicit UID Cross-Account Read Bypass (`getVersions`):** An active session confirmed as User B (`Auth UID = userB`, `Store UID = userB`) calling `getVersions(noteId, 'userA')` retrieved User A's private history. `getVersions` validated string syntax but did not prove caller session authority.
2. **Omitted-UID `saveVersion` Write via `version.uid`:** Calling `saveVersion(version)` without the explicit `confirmedUid` argument fell back to `version.uid` and persisted data to `ntk:versions:userA:...`. Omitted caller authorization must not derive from payload data.
3. **Mismatched `version.uid` Ownership Rewrite:** Calling `saveVersion(version, 'userA')` with `version.uid = 'userB'` rewrote the payload owner to `'userA'` and persisted it instead of rejecting the mismatch.

Stage 3A.4 addresses these three residuals directly. S3-001 remains closed. Work on non-P0 items (S3-003 through S3-014) remains untouched for subsequent stages.

---

## 2. Tracked Markdown Restoration

The latest Codex audit flagged 20 tracked Markdown reports deleted in the working tree. Before applying code changes, a checkout restored all 20 files directly from HEAD:
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
18. `NTK_NOTE_V2_9_STAGE_3A_P0_ACCOUNT_ISOLATION_REMEDIATION_REPORT.md`
19. `NTK_NOTE_V2_9_STAGE_3_FINAL_PRODUCT_ACCEPTANCE_REPORT.md`
20. `NTK_SOURCE_DUPLICATE_AUDIT.md`

`NTK_NOTE_V2_9_STAGE_3A_3_VERSION_HISTORY_SESSION_AUTHORITY_P0_CLOSURE_REPORT.md` remained intact and tracked. Exactly 20 files were restored.

---

## 3. Root Cause Analysis

### Residual A: Explicit UID Read Bypass
`getVersions(noteId, confirmedUid)` invoked `getConfirmedVersionUid(confirmedUid)`. When a caller provided `'userA'`, the helper verified the string format. It failed to check `isAuthorizedSession(confirmed, overrides)`. Consequently, any active session could pass another user's valid UID and read their scoped storage key directly.

### Residual B: Omitted UID saveVersion Fallback
`saveVersion` accepted `confirmedUid?: string | null` and resolved target identity with:
```typescript
const confirmed = getConfirmedVersionUid(confirmedUid || version?.uid);
```
When a caller omitted the second argument, the function used `version.uid`. The payload metadata acted as ambient authorization, bypassing the caller boundary.

### Residual C: Ownership Rewrite on Mismatched Input
`saveVersion` constructed:
```typescript
const versionWithUid: NoteVersion = { ...version, uid: confirmed };
```
If caller authorization passed as `'userA'` but the payload carried `version.uid = 'userB'`, the function overwrote `uid` to `'userA'`. Rewriting ownership silently normalized invalid input rather than rejecting an integrity violation.

---

## 4. Remediation Architecture

### Security Invariant
Every sensitive Version History read and write enforces:
`CURRENT FIREBASE AUTH UID === CURRENT STORE UID === REQUESTED UID === VERSION OWNER UID`.
If any component is missing, placeholder, or mismatched, the operation fails closed.

### Authorized Read Implementation (`getVersions`)
```typescript
export const getVersions = (
  noteId: string,
  confirmedUid?: string | null,
  overrides?: SessionAuthorityOverrides
): NoteVersion[] => {
  if (typeof localStorage === 'undefined') return [];
  if (!noteId) return [];
  const confirmed = getConfirmedVersionUid(confirmedUid);
  if (!confirmed) return [];
  if (!isAuthorizedSession(confirmed, overrides)) return [];
  try {
    const key = getVersionHistoryStorageKey(confirmed, noteId);
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};
```
If an active User B session requests User A's history, `isAuthorizedSession('userA')` evaluates to false. The function returns `[]`.

### Authorized Write Implementation (`saveVersion`)
```typescript
export const saveVersion = (
  version: NoteVersion,
  confirmedUid: string,
  overrides?: SessionAuthorityOverrides
): boolean => {
  if (typeof localStorage === 'undefined') return false;
  if (!version?.noteId) return false;

  const target = getConfirmedVersionUid(confirmedUid);
  if (!target) return false;

  if (!isAuthorizedSession(target, overrides)) return false;

  const versionOwner = getConfirmedVersionUid(version?.uid);
  if (!versionOwner || versionOwner !== target) {
    return false;
  }

  const versions = getVersions(version.noteId, target, overrides);
  const newVersions = [version, ...versions.filter(v => v.id !== version.id)].slice(0, 50);
  try {
    const key = getVersionHistoryStorageKey(target, version.noteId);
    localStorage.setItem(key, JSON.stringify(newVersions));
    return true;
  } catch (err) {
    console.warn('[VersionHistory] Failed to persist scoped version:', err);
    return false;
  }
};
```
`saveVersion` mandates `confirmedUid: string`. Omitted parameters return `false` with zero writes. When `version.uid !== target`, the save aborts immediately without mutating `version.uid`.

### Creation Flow Integration
`saveLocalNoteSnapshot` validates session authority first. It constructs the new version with `uid: confirmed`, then invokes `saveVersion(version, confirmed, overrides)`.

---

## 5. Test Suite Verification

### Standalone Stage 3A.4 Suite
Command: `npx tsx --test --test-name-pattern="Stage 3A.4" tests/logic.test.ts`
- **Result:** 13 passed, 0 failed (duration: 5.4s)
- **Coverage:**
  - Test A: Auth B / Store B / explicit A `getVersions` returns `[]`
  - Test B: Auth A / Store A / explicit A `getVersions` returns own history
  - Test C: Anonymous user 2 cannot explicitly read anonymous user 1
  - Test D: Omitted UID `saveVersion` fails closed with no write
  - Test E: Explicit A save while Auth B / Store B rejected
  - Test F: Requested A + version owner B rejected, no ownership rewrite
  - Test G: Requested A + version owner A under A/A succeeds
  - Test H: Ownerless direct save rejected
  - Test I: Placeholder-owner direct save rejected
  - Test J: Genuine anonymous direct save under matching session succeeds
  - Test K: Existing clear/delete session authority remains intact
  - Test L: Existing Restore authority remains intact
  - Test M: S3-001 stale Send regression remains green

### All Stage 3A Suites
Command: `npx tsx --test --test-name-pattern="Stage 3A" tests/logic.test.ts`
- **Result:** 53 passed, 0 failed across 5 suites (duration: 4.8s)
  - Stage 3A: 10 passed
  - Stage 3A.2: 14 passed
  - Stage 3A.3: 16 passed
  - Stage 3A.4: 13 passed

---

## 6. Full Quality Gates

1. **Unit & Integration Tests (`npm test`):**
   - 344 passed, 0 failed across 48 suites (duration: 11.1s)
2. **Firestore Security Rules Tests (`npm run test:rules`):**
   - 24 passed, 0 failed (duration: 21.2s)
3. **Frontend TypeScript Check (`npx tsc --noEmit`):**
   - 0 errors
4. **Cloudflare Worker Type Check (`npm --prefix cloudflare/ntk-gateway run typecheck`):**
   - 0 errors
5. **Production Build (`npm run build`):**
   - Built singlefile bundle in 23.06s (`dist/index.html`: 2,768.65 kB, gzip: 776.39 kB)
6. **Secret Audit (`node scripts/audit_secrets.mjs`):**
   - 154 files scanned, 0 findings

---

## 7. Deployment & Infrastructure Invariants

- **Command:** `npx firebase deploy --only hosting --project ntk-note`
- **Result:** Deployment complete. Release URL: `https://ntk-note.web.app`
- **Infrastructure:**
  - Cloudflare Worker modified: NO (0 changes)
  - Firestore rules modified: NO (0 changes)
  - Firebase indexes modified: NO (0 changes)
  - Cloudflare KV / R2 / Backblaze B2 modified: NO (0 changes)
  - Plan / Billing: Firebase Spark (free-tier only, no Cloud Functions, no App Hosting)

---

## 8. Live Owner Acceptance Status

Required BrowserOS Neo profile: `FEAICCWS` (`feaiccws@gmail.com`).
During inspection, BrowserOS Neo held active session for `appdevmanwill@gmail.com`. Profile `feaiccws@gmail.com` was not loaded. In accordance with Section 32:
- **LIVE TEST SAFELY BLOCKED**
- **FINAL LIVE A/B ACCEPTANCE = PENDING**

---

## 9. Stage 3 Residual Scope

Non-P0 audit items remain for subsequent stages:
- S3-003 through S3-014 (UX improvements, extended performance optimizations, secondary novice-first refinements).
- No work commenced on Stage 3B.
- No merge, tag, or final release push executed.
