# NTK Note Production Runbook

This guide explains how NTK Note operates in production, how to check its health, how backups work, and how to resolve common situations in everyday language without needing technical jargon or exposing secrets.

---

## 1. Where Is the Live App?

- **Web Application URL**: [https://ntk-note.web.app](https://ntk-note.web.app)
- **Application Gateway**: `https://ntk-note-gateway.ntk-note.workers.dev`
- **Supported Browsers**: Any modern browser (Chrome, Edge, Safari, Firefox) on desktop, tablet, or mobile.
- **Installable App (PWA)**: On Android, Windows, macOS, and iOS, tap or click "Install" in your browser menu to run NTK Note as a standalone app.

---

## 2. What Services Does NTK Note Use?

NTK Note is built on a resilient, multi-cloud architecture designed to be permanently zero-cost for normal usage:

1. **Firebase (Hosting & Database)**:
   - **Hosting**: Serves the web application files worldwide over fast Google CDNs.
   - **Firestore Database**: Safely synchronizes note metadata, checklists, notebooks, and private messages between your devices.
   - **Pricing Plan**: Strict Firebase **Spark Plan ($0/month)**. Billing is never linked.
2. **Cloudflare Gateway Worker & R2 Storage**:
   - **Gateway Worker**: A lightweight server that protects your API keys and encrypts settings.
   - **R2 Storage (`ntk-note-files`)**: Stores uploaded files, voice recordings, and photos securely with zero egress bandwidth charges.
   - **Workers AI**: Provides free text-to-speech voice playback for your notes.
3. **Backblaze B2 (`ntk-note-backups`)**:
   - Acts as an independent disaster recovery backup location. It is only used when you create or schedule backups, keeping backups completely separate from live files.

---

## 3. How to Check Sync & Connection Status

You never have to guess whether your notes are saved:

- **Top Bar Status**:
  - A green checkmark or `"Synced"` badge means all your notes and files are safely stored in the cloud.
  - A spinning icon means changes are currently uploading.
  - A small number badge shows how many changes are waiting to sync.
- **Sync & Offline Center**:
  - Tap your profile photo or go to **Settings → Sync & offline → Open Sync & Offline Center**.
  - You will see exact counts of:
    - Notes available offline on this device.
    - Notes waiting to upload.
    - Files waiting to upload.
    - Items needing attention.
  - Tap **Sync Now** anytime you want an immediate cloud confirmation.

### What the Messages Mean

- **"Everything is up to date."**: All your notes and files exist safely both on this device and in the cloud.
- **"Your notes are synced. Some files are waiting to upload and will retry automatically."**: Your text and notes are 100% saved in the cloud. A voice recording or image is waiting for a temporary retry delay and will upload on its own.
- **"Your notes are synced. Some files need attention before they can upload."**: A file could not upload (for example, if the file was deleted before it finished uploading). Open the Sync Center to dismiss or retry.
- **"You're offline. Your changes are safe on this device and will sync when you're back online."**: You can keep writing normally. Everything is safely preserved on your device and will sync automatically the moment your connection returns.

---

## 4. What Happens If Two Devices Edit the Same Note? (Safe Recovery)

NTK Note never deletes your work:

1. If you edit a note on your phone and tablet at the same time while offline, both copies are protected.
2. The note on the cloud remains intact as the official copy.
3. Your local edits are automatically created as a new private note: **`[Note Title] (Recovered Copy)`**.
4. You receive a calm notification: *"Your edits are safe. Nothing was lost."*
5. You can keep both notes, combine them, or review the differences whenever you like.

---

## 5. How Backups Work

- **Manual Backups**: Go to **Settings → Backups & data → Backup now**. A snapshot of your workspace is packaged and stored safely in your private Backblaze B2 backup storage.
- **Exporting Notes**: Go to **Settings → Data & Backup → Export** to download your notes to your computer as Markdown, JSON, or text files anytime.
- **Safety First**: Restoring from a backup merges your notes safely without wiping out notes you created since the backup.

---

## 6. How to Respond to Storage, Full, or Offline Issues

- **If your device storage is full**:
  - The app displays a friendly notice if your browser storage limit is low.
  - Go to **Recycle Bin** and tap **Empty Recycle Bin** to permanently remove deleted items you no longer need.
- **If you lose Internet access**:
  - Do not worry. The app continues to work offline. All notes, checklists, and search indexes remain responsive.
  - Avoid clearing your browser cache or cookies while offline so unsynced drafts stay safe.
- **If a file upload is stuck**:
  - Open **Sync & Offline Center**.
  - Tap **Sync Now** to trigger an immediate check.
  - If a file requires attention, tap the item to retry or remove it.

---

## 7. How to Verify Firebase Spark ($0/Month) Status

To confirm that Firebase has no billing attached:

1. Visit the [Firebase Console](https://console.firebase.google.com/project/ntk-note/usage).
2. Look at the bottom-left corner under the project name:
   - It should state **Spark Plan** ($0/month).
   - Billing account must say **None**.
3. Under Build services:
   - **Cloud Functions**: 0 functions deployed.
   - **App Hosting**: 0 backends.
   - **Firestore**: 1 database (`(default)`).
   - **Cloud Storage for Firebase**: Unused (media routes through Cloudflare R2).

---

## 8. Rollback Procedure

If a future update ever needs to be rolled back to this stable release (v2.8.2):

1. The verified release package for v2.8.2 is preserved in:
   `backups/NTK-note-v2.8.2-final-production-live-verified-sanitized.zip`
   (and the prior stable rollback baseline is `backups/NTK-note-v2.8.1-final-production-live-verified-sanitized.zip`).
2. Historical release packages remain archived in `backups/`.
3. To roll back the frontend to v2.8.2, check out the authoritative release commit recorded in `RELEASE_MANIFEST.json` or the verified local annotated tag `v2.8.2`:
   ```bash
   # Check out by local verified tag or the exact commit SHA in RELEASE_MANIFEST.json
   git checkout v2.8.2
   npm run build
   npx firebase deploy --only hosting --project ntk-note
   ```
4. The service worker cache (`ntk-note-offline-v12`) will automatically fetch the restored files when users next open the app.
