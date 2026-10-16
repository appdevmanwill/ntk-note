# NTK Note v2.9.0 correction integration

Date: 16 October 2026 (Africa/Lagos). Status: VERIFIED functional corrections, GitHub backup, and Firebase Hosting preview. Production was not deployed.

## Source and preservation

- Authoritative source: local `final-novice-ux`, `d83dc0659f55315b9981cf58618b078b1a89de06`, package version **2.9.0**.
- Development branch: `codex/v2.9.0-safe-sync-20261016-131848`.
- Complete private filesystem backup: `C:\Users\NTK\Projects\NTK Projects\NTK-note-preservation-20261016-131848\workspace`.
- All **864** original files were copied and individually verified by SHA-256, including `.git`, environment configuration, ignored files, and the unchanged supplied ZIP. Verification is beside the backup in `verification.json`.
- The 25 pre-existing report deletions remain unstaged. The owner's untracked version audit remains unchanged and uncommitted. Neither was restored, removed, or included in the correction commit.
- All 12 package manifest entries matched the current source (including absence of the two added files), and all 12 overlay SHA-256 hashes matched before integration.
- No GitHub pull, reset, or replacement of local source occurred. Primary remote `appdevmanwill/ntk-note` main was `fc7327f9d5c44d41f2abd85bc422c1463cfcf21a`; owner-account push permission was independently verified. The secondary remote was not needed.
- This is a filesystem/source backup, not an export of production Firestore or the browser's personal storage. Those stores were not modified.

## Corrections

- The top-right profile avatar contains Profile, Settings, appearance, Help, sync status, owner actions when authorized, and sign-out. Sidebar footer duplicates were removed. The dropdown stays inside desktop and mobile viewports and supports Escape/arrow navigation.
- Sidebar height and notebook scrolling were corrected. Recent Notebooks and newly created notebooks open the selected notebook's filtered view.
- Notebook/sub-notebook creation and editing share a 32-icon emoji picker. Existing icon values remain compatible, and name/icon/color changes use the existing Firestore synchronization path.
- Automatic conflict-recovery forks were removed from app/store sync paths. Existing recovered notes are preserved. Legacy **explicit** private-copy actions remain available internally for backward compatibility, with no automatic caller.
- Genuine conflicts remain pending, deduplicated by original note ID. The user can compare local/cloud versions, keep the current draft, keep cloud, review later, keep a remote deletion, or explicitly restore the original ID.
- Local edits enter the durable outbox before incoming snapshots can replace them. Network writes remain debounced. Concurrent flushes are serialized, acknowledged writes rebase later queued edits, cache-only snapshots are not treated as authoritative deletions, and pending shared edits are protected. An identical acknowledged cloud version also clears a stale pre-commit conflict after reconnect/reload.
- Pending notes/notebooks, queue entries, and conflict decisions have an additional UID- and tab-scoped IndexedDB checkpoint. Reload restores that tab's pending work before cloud listeners attach, preventing another tab's shared-cache writes from erasing its draft or decision. Existing IndexedDB stores and migration records are preserved.
- Transactions fail closed for missing baselines and concurrent edits, including timestamp collisions. Owner-shared notes use the shared document as canonical authority, so a stale private mirror cannot cause endless conflict prompts after a user decision.
- Conflict decisions cancel deferred editor/store saves. Encrypted saves are guarded against stale completion; Keep Current waits for the latest pending encryption, and Keep Cloud invalidates the old unlocked draft. Session coherence is checked before resolution and after asynchronous work.
- A real-interface regression exposed an editor mount-cleanup bug that could save blank initial state. The editor now initializes directly from the selected note. Ordinary updates cannot replace its ID.
- Development mode no longer registers the production service worker. The isolated browser harness uses local Auth/Firestore emulators, verified disposable identities, external HTTPS request blocking, desktop/mobile viewports, separate contexts for devices, and shared-context tabs.

## Verification

| Check | Result |
| --- | --- |
| Clean dependency installation | PASS (`npm ci`; Playwright added as a development dependency) |
| `npx tsc --noEmit` | PASS |
| `npm test` | PASS — **393** tests, zero failures/skips |
| `npm run test:rules` | PASS — **24** emulator tests, including selected shared-version commit and unknown-baseline rejection |
| `npm run build` | PASS — final single-file client 2,781.37 kB, gzip 781.28 kB |
| Desktop/mobile browser journeys | PASS — **12 unique journeys** verified. Full run: 11 passed, 1 local Chromium `ERR_NO_BUFFER_SPACE` navigation failure; that single case passed in a fresh-browser rerun. Both raw JSON reports are retained. |
| Source secret scan | PASS — no credential findings |
| Reachable Git history scan | PASS — no secret findings after reviewing one historical public Firebase web-configuration blob |
| Protected source/configuration | PASS — Cloudflare source, production Firebase config, Firestore rules/indexes unchanged |
| Original local environment, audit, ZIP | PASS — still match the preservation backup hashes |

The historical Firebase web key is an intentionally public client identifier, not a service-account credential. The narrowly pinned exception is documented in `scripts/audit_git_secrets.mjs`; see [Firebase API-key guidance](https://firebase.google.com/docs/projects/api-keys). No private key, provider credential, GitHub token, or local environment file is included in the backup branch.

## Preview and GitHub backup

Preview: [Open NTK Note corrections](https://ntk-note--note-fixes-v290-20261016-6mt7tqjb.web.app). Expires **23 October 2026 at approximately 14:46 Africa/Lagos**. Only this preview channel was deployed.

GitHub backup: [`codex/backup-v2.9.0-corrections-20261016`](https://github.com/appdevmanwill/ntk-note/tree/codex/backup-v2.9.0-corrections-20261016). Tested application-source commit: `28c941088c52991b48ea41303fda410217861142`; the final documentation/evidence commit follows it on the same branch. The backup branch was created without force-pushing or changing main.

HTTP verification returned 200 and exactly matched the tested local build SHA-256: `01625e274a006548ce56c5a28ffd437ec94ca3a2940860368a97a6975a1dd5b9`. The generated Cloudflare configuration is excluded. BrowserOS Neo verified the hosted landing page rendered its headings and sign-in controls; no production sign-in or note writes were performed.

The preview-only configuration is `firebase.preview.json`; it excludes the generated Cloudflare `wrangler.json` from Hosting. Firebase account: **feaiccws@gmail.com**, project/site: **ntk-note**. Billing API and Neo console both confirmed Spark / No-cost, with no billing account linked. The console showed Hosting storage **96.7 MB / 10 GB** and downloads **79.1 MB / 10 GB** before deployment.

Production Hosting was checked before and after preview deployment: release `1791322182458000`, version `5cf3b6959416c071`, released 6 October 2026, is **unchanged**. Firebase CLI added only the preview hostname to Authentication's authorized domains (two existing domains preserved; three total), enabling preview sign-in. No provider, billing, Firestore, or Cloudflare configuration was changed.

Machine-readable acceptance evidence, raw full-run and retry browser reports, and desktop/mobile screenshots are in `test-evidence/fix-v290/`. Browser results distinguish the single local Chromium infrastructure retry from application assertions.

## Limits and next action

- The preview uses the existing Firebase backend. Automated test writes were confined to local emulators. Opening/signing into the preview yourself will use your real account and data; Firebase preview channels do not isolate the backend. See [Firebase preview documentation](https://firebase.google.com/docs/hosting/test-preview-deploy).
- Physical Android/iOS devices, real Google popup authentication on the preview, and encrypted conflict comparison in the hosted interface are not claimed as verified. Encrypted save-race behavior is covered by executable logic tests.
- **Inherited dependency advisories:** both the preserved baseline and updated tree report the same **15** entries with `npm audit --omit=dev`: 2 low, 3 moderate, 9 high, 1 critical. The critical entry is transitive `websocket-driver`; advisory counts cover the dependency tree and are not a browser-bundle exploitability assessment. No forced dependency upgrades were mixed into this correction. These remain an explicit production-readiness follow-up; functional PASS does not mean the dependency audit is clean.
- No existing recovered note was deleted or merged. No production Firestore document, rule, index, Cloudflare deployment, GitHub main branch, tag, or release was changed.
- Rollback: retain the private complete backup and original `final-novice-ux` branch at `d83dc06`. Restore selected source/configuration files into a separate review checkout if needed; do not overwrite live browser data or unsynced notes. Production requires no rollback because only a preview is in scope.
