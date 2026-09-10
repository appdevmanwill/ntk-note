# NTK Infrastructure & Duplicate Resource Inventory

**Status**: Reconciled Post-Cleanup  
**Project**: NTK Note (`ntk-note`)  
**Audit Source**: Live BrowserOS Neo inspection, Cloudflare Dashboard, Backblaze B2 Console & NTK Note Live App

---

## 1. Executive Summary

Following the live identity purge, Backblaze B2 consolidation, and duplicate-resource cleanup, all identified non-canonical and duplicate resources were permanently removed. The current cloud and application infrastructure maps 1:1 to canonical definitions with zero duplicate resources remaining.

---

## 2. Cloudflare Infrastructure

### Canonical Cloudflare Worker
- **Worker Name**: `ntk-note-gateway`
- **Domain**: `ntk-note-gateway.ntk-note.workers.dev`
- **Status**: **CANONICAL & LIVE** (Active Version `3d6505b4`)
- **Metrics**: 0 errors, within Free Tier ($0.00 cost)
- **Duplicate Workers**: **0** (Historical deployment versions are release/rollback history, not duplicate Workers).

### Bindings
- **KV Namespace Binding**: `NTK_CONFIG`
  - **Bound KV Namespace**: `ntk-note-gateway-NTK_CONFIG`
  - **Namespace ID**: `c3df08383eb744bbbd30be1ee4f3cf4c`
  - **Status**: **CANONICAL & LIVE** (1 canonical namespace, 0 duplicates)
- **R2 Bucket Binding**: `NTK_FILES`
  - **Bound Bucket**: `ntk-note-files`
  - **Status**: **CANONICAL & LIVE** (1 canonical bucket, 0 duplicates)

### Variables & Secrets
- `ALLOWED_ORIGINS` (Text): `https://ntk-note.web.app,https://ntk-note.firebaseapp.com,http://localhost:5173,http://127.0.0.1:5173` (**CANONICAL**)
- `FIREBASE_PROJECT_ID` (Text): `ntk-note` (**CANONICAL**)
- `CONFIG_ENCRYPTION_KEY` (Secret): Encrypted runtime secret (**CANONICAL**)
- `OWNER_EMAILS` (Secret): Encrypted runtime secret (**CANONICAL** — configured with 3 authorized owners: `futureeternal@gmail.com,feaiccws@gmail.com,appdevmanwill@gmail.com`)

---

## 3. Backblaze B2 Infrastructure

### Current Canonical Inventory

| Bucket Name | Bucket ID | Type | Encryption | Status / Role |
|---|---|---|---|---|
| `ntk-note-backups` | `c882bb3fc5135446a0020210` | Private | Default (SSE-B2) | **CANONICAL LIVE BACKUP STORE** |

- **Canonical B2 Buckets**: Exactly 1 (`ntk-note-backups`). Two obsolete/empty B2 buckets were permanently deleted during verified live cleanup.
- **Application Keys**: Exactly 1 dedicated bucket key (`ntk-note-backup-key`, ID `00582bf534602200000000002`), scoped strictly to `ntk-note-backups` (+ 1 master key).
- **Duplicate B2 Buckets**: **0**
- **Duplicate B2 Keys**: **0**

---

## 4. NTK Note Application Storage Connections

### Current Canonical Connections Table

| Connection Name | Provider | Target / Binding | Health Status | Role |
|---|---|---|---|---|
| `Main R2 Storage` | Cloudflare R2 | Direct Worker Binding (`NTK_FILES`) | **Ready (READY)** | **CANONICAL PRIMARY OBJECT STORE** |
| `NTK Backup` | Backblaze B2 | `ntk-note-backups` (S3 API) | **Ready (READY)** | **CANONICAL BACKUP STORE** |

- **Live Storage Connections**: Exactly 2 remain. The previous duplicate R2 connection was permanently deleted during verified live cleanup.
- **Duplicate Storage Connections**: **0**

### Authoritative Storage Purpose Routes
- Profile Photos: `Main R2 Storage` (**CANONICAL**)
- Images: `Main R2 Storage` (**CANONICAL**)
- Voice Notes: `Main R2 Storage` (**CANONICAL**)
- Attachments: `Main R2 Storage` (**CANONICAL**)
- Exports: `Main R2 Storage` (**CANONICAL**)
- Backups: `NTK Backup` (**CANONICAL**)

---

## 5. AI Provider Connections (Live Configuration)

- `TWOMN OpenRouter`: Ready (**READY**)
- `appdevmanwill Groq`: Ready (**READY**)
- Duplicate AI Connections: **0**

---

## 6. Final Canonical Resource Count Summary

| Item | Final Count | Status |
|---|---|---|
| Cloudflare Workers | 1 | Match |
| Cloudflare KV Namespaces (relevant) | 1 | Match |
| Cloudflare R2 Buckets | 1 | Match |
| Backblaze B2 Buckets | 1 | Match (`ntk-note-backups`) |
| B2 Dedicated Application Keys | 1 | Match (`ntk-note-backup-key`) |
| NTK Note Live Storage Connections | 2 | Match (`Main R2 Storage`, `NTK Backup`) |
| Live AI Connections | 2 | Match |
| Duplicate Cloud / Application Storage Resources | 0 | Match |
| Authorized Owner Identities | 3 | Match |
