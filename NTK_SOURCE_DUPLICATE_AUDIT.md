# NTK Note — Source Duplicate Audit

**Auditor**: Antigravity  
**Date**: 2026-09-09 (Re-verified Post-v2.8.2 Frontend Owner Identity Removal)  
**Project Root**: `c:\Users\NTK\Projects\NTK Projects\NTK-note`  
**Target Version**: v2.8.2  

---

## 1. Methodology

1. **File-name comparison**: Searched `src/` and `cloudflare/` for names matching `-copy`, `-old`, `-backup`, `-new`, `-2`, `_copy`, `(1)`, `(2)` patterns.
2. **Content hash / import analysis**: Verified each utility module is imported from exactly one canonical path.
3. **Implementation scan**: Grepped for critical function names to verify single implementations.
4. **Hardcoded identity scan**: Searched all TypeScript and TSX files under `src/` for owner email patterns, personal email strings (`@gmail.com`), and `OWNER_EMAILS` identifier definitions.
5. **Connection ID scan**: Searched `src/` for hardcoded connection IDs (`storage_*`).

---

## 2. File Name Duplicates

| Pattern | Directories Searched | Results |
|---|---|---|
| `*-copy.*`, `*(1).*`, `*-old.*`, `*-backup.*`, `*-new.*`, `*-2.*`, `*_copy.*` | `src/`, `cloudflare/` (excluding `node_modules`) | **0 duplicates found** |

---

## 3. Critical Implementation Duplicates

| Function / Module | Expected Count | Found | Canonical Location |
|---|---|---|---|
| `ensureBoundR2Connection` | 1 | 1 | `cloudflare/ntk-gateway/src/index.ts` |
| `offlineMediaQueue` (IndexedDB queue) | 1 | 1 | `src/utils/offlineMediaQueue.ts` |
| `calculateGlobalR2Usage` | 1 | 1 | `cloudflare/ntk-gateway/src/index.ts` |
| `calculateGlobalB2Usage` | 1 | 1 | `cloudflare/ntk-gateway/src/index.ts` |
| `DEFAULT_STORAGE_POLICY` | 1 | 1 | `cloudflare/ntk-gateway/src/index.ts` |
| `AiSettingsPanel` | 1 | 1 | `src/components/AiSettingsPanel.tsx` |
| `SettingsView` | 1 | 1 | `src/components/SettingsView.tsx` |
| `BackupCenterModal` | 1 | 1 | `src/components/BackupCenterModal.tsx` |
| `cloudBackup` | 1 | 1 | `src/utils/cloudBackup.ts` |
| `cloudStorage` | 1 | 1 | `src/utils/cloudStorage.ts` |

---

## 4. Hardcoded Identifiers & Owner Authentication Truth

In v2.8.1 and earlier, `src/components/SyncOfflineCenterModal.tsx` retained a vestigial frontend `OWNER_EMAILS` constant containing hardcoded email addresses to decide whether to display owner diagnostic sections. In v2.8.2, this redundant array was completely removed. Owner status is now strictly derived from the server-authoritative Cloudflare Worker gateway (`getAiGatewayStatus()` -> `status.isOwner === true`), adhering to the exact same pattern used in `AccountMenu.tsx` and `AiSettingsPanel.tsx`.

### Fail-Closed Guarantee
If the gateway is unreachable, offline, or returns an error, `isOwner` fails closed (defaults to `false`). The general user Sync & Offline Center remains fully functional, while technical owner diagnostic tools remain concealed.

### Actual Scan Proof (2026-09-09)

| Pattern / Identifier | Scope | Command Executed | Results |
|---|---|---|---|
| `futureeternal@gmail.com` | `src/` | `git grep -i "futureeternal@gmail.com" src/` | **0 matches** |
| `feaiccws@gmail.com` | `src/` | `git grep -i "feaiccws@gmail.com" src/` | **0 matches** |
| `appdevmanwill@gmail.com` | `src/` | `git grep -i "appdevmanwill@gmail.com" src/` | **0 matches** |
| `@gmail.com` | `src/` | `grep_search "@gmail.com" in src/` | **0 matches** |
| `OWNER_EMAILS` | `src/` | `git grep "OWNER_EMAILS" src/` | **0 matches** |
| Connection IDs (`storage_*`) | `src/` | `git grep "storage_" src/` | **0 matches** |

---

## 5. Owner Configuration & Identity Verification

- **Active Frontend Source**: Exactly 0 hardcoded owner email addresses exist in `src/`.
- **Server Authority**: The Cloudflare Gateway Worker encrypted secret `OWNER_EMAILS` remains the single source of owner authorization truth across all administrative routes (`/v1/admin/*`, `/v1/status`).
- **Support Email**: `firebase.json` verified as `"supportEmail": "appdevmanwill@gmail.com"`.
- **Identity Status**: Former removed accounts verified absent from Authentication, Firestore application records, and active source/configuration. Exactly three authorized owners are configured on the gateway.

---

## 6. Generated & Temporary Artifacts Audit

| Artifact / Pattern | Purpose | Status |
|---|---|---|
| `scripts/active_oauth_url.txt` | Generated OAuth authorization artifact | **DELETED / EXCLUDED FROM SOURCE PACKAGES** |
| `active_callback_url.txt`, `*oauth_url.txt` | OAuth session URLs | **EXCLUDED** via `.gitignore` and packaging scripts |
| `.env`, `.env.*`, `.dev.vars*` | Local environment secrets | **EXCLUDED** via `.gitignore` (allowing only `.env.example`) |
| `*.log` (e.g. `preview-*.log`, `firestore-debug.log`) | Runtime logs | **EXCLUDED** via `.gitignore` and packaging scripts |
| `backups/`, `*.zip`, `.wrangler`, `.firebase` | Local archives & caches | **EXCLUDED** via `.gitignore` and packaging scripts |

`.gitignore` configuration was verified to strictly exclude all generated OAuth/session artifacts, logs, and actual secrets while explicitly preserving `.env.example`.

---

## 7. Conclusion

**No duplicate source code found.** The active codebase has a single canonical implementation for every critical module. Zero hardcoded owner emails or connection IDs exist anywhere in frontend `src/`. All generated OAuth artifacts and logs are deleted or excluded, and owner authorization is strictly server-authoritative.
