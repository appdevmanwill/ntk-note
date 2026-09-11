# NTK Note v2.9 — Stage 3 Independent Final Product Acceptance Report

**Audit date:** 2026-09-10

**Branch:** `final-novice-ux`

**Stage 3 starting HEAD:** `a288023c3b3d98b07490d229d7990f74ce42733c`

**Stage 3 ending HEAD at report creation:** `a288023c3b3d98b07490d229d7990f74ce42733c`

**Frozen rollback baseline:** local annotated tag `v2.8.2` -> `43b6121698035d54978111fb17496b94f47156d4`

**Final verdict:** **C. FAIL — RELEASE BLOCKER REMAINS**

## 1. Executive acceptance decision

NTK Note v2.9 is **not ready for Stage 4**. The fresh local gates pass, the frozen rollback tag remains intact, the historical secret-bearing commit is not an ancestor of the development branch, and much of the mobile/PWA architecture is present in source. Those positives do not outweigh the release blockers found by the independent audit.

The most serious defects are two same-browser cross-account data exposures:

1. unsent private-message drafts are keyed only by the symmetric chat ID, not by the signed-in UID; and
2. local note version history is keyed only by note ID, not by UID.

Additional release blockers affect cloud restore correctness, truthful manual-sync reporting, collaboration-rule integrity, mobile safe areas, keyboard accessibility, directory enumeration protection, sync serialization, backup chunk safety, and mobile touch/reduced-motion accessibility.

No application fix was made. The Stage 3 instruction requires a defect to be implemented specifically through Antigravity IDE using Gemini 3.8 Flash with High thinking and then returned to Codex for independent re-audit. That implementation route was not available to this task. GPT-5.6 Sol Ultra specialist audit tasks were dispatched, but two explicitly returned account-usage-limit errors and none delivered findings. They are not represented as completed reviews.

The required full BrowserOS Neo live journey also could not be completed because the BrowserOS profile disconnected and no BrowserOS window/profile remained available. Limited authenticated live evidence gathered before disconnection is recorded below. No physical-device test and no device-emulation viewport matrix were completed.

## 2. Audit method and evidence standard

The audit was performed read-only before report creation. Application source was not changed during discovery. Evidence came from:

- direct Git object/ref inspection;
- current production source and configuration;
- fresh logic, Firestore emulator, TypeScript, build, and secret-scan gates;
- a fresh isolated build of the frozen `v2.8.2` tree using the same installed toolchain;
- limited authenticated BrowserOS Neo inspection of the live app, gateway status, Firebase plan, Functions, App Hosting, and Firestore database selector; and
- small read-only reproductions of deterministic branches and byte-size assumptions.

Classifications in this report mean:

- **VERIFIED:** directly supported by current source, a behavioral test, Git evidence, or observed live state appropriate to the claim.
- **PARTIAL:** some evidence is positive, but the required end-to-end/live/device proof is incomplete.
- **NOT VERIFIED:** the required evidence was not available.
- **DEFECT FOUND:** current production source contains a reproducible violation.

## 3. Git truth and frozen-baseline protection

Fresh Git evidence established:

```text
branch: final-novice-ux
HEAD: a288023c3b3d98b07490d229d7990f74ce42733c
local v2.8.2 tag object: 285d232fc4e806b19cc8090da034d14d188671e7
local v2.8.2 dereferenced target: 43b6121698035d54978111fb17496b94f47156d4
local main: 43b6121698035d54978111fb17496b94f47156d4
origin/main: fc7327f9d5c44d41f2abd85bc422c1463cfcf21a
historical secret commit ancestor check exit: 1 (NO)
```

The remote currently advertises `origin/main` at `fc7327f9d5c44d41f2abd85bc422c1463cfcf21a`. It does not advertise a remote `v2.8.2` tag; the verified rollback tag is local and remains an annotated tag targeting the specified frozen commit.

### Stage 2 SHA discrepancy

**VERIFIED.** `ba784c917b7cfb1a8ec1f45dae0376892eb8e23e` and `a288023c3b3d98b07490d229d7990f74ce42733c` both exist and have the same Stage 1 parent. Reflog/object inspection shows that `ba784c...` was the intermediate Stage 2 commit and `a288023...` was the amended replacement. The tracked Stage 2 report therefore contains a pre-amend SHA. The authoritative post-Stage-2 state is the actual measured HEAD, `a288023...`. The Stage 2 commit was not amended again to chase its own SHA.

No history rewrite, force push, merge, release tag, release push, credential recovery, or secret-unblock action was performed in Stage 3.

## 4. Independent defect register

| ID | Severity | Component | Evidence and user impact | Release blocking | Minimal correction required |
|---|---|---|---|---:|---|
| S3-001 | **P0 CRITICAL** | Messages / account isolation | `MessagesView.tsx` reads and writes `ntk:chat:draft:${activeChatId}`. `getDeterministicChatId()` sorts the two UIDs, so User A and User B use the same chat ID. If both accounts use the same browser profile, B can open the A-B chat and see A's unsent private draft. `clearAuth()` clears the in-memory chat cache but not these draft keys. | **YES** | Namespace drafts by authenticated UID and chat ID; do not migrate unscoped draft content without proven ownership; add a real A -> sign-out -> B regression test. |
| S3-002 | **P0 CRITICAL** | Version history / account isolation | `VersionHistory.tsx` stores full title/content snapshots under `ntk-versions-${noteId}` with no UID. Shared notes intentionally have the same note ID for multiple users, allowing one account in the same browser profile to load another account's local historical content. | **YES** | Namespace every local version-history operation by UID + note ID; quarantine unscoped historical data unless ownership is proven; test account switching on a shared note. |
| S3-003 | **P1 HIGH** | Backup restore / data safety | Replace restore clears local state before remote deletion, catches and suppresses every `deleteDoc` failure, then reports success. `importNotes()` syncs imported notes but never queues imported notebooks. Old remote data can survive a claimed replacement and restored notebooks can disappear/revert after listener/reload activity. | **YES** | Validate/stage payload first; suspend or generation-guard listeners; fail closed on every required deletion; queue notes and notebooks; await pending writes; report success only after authoritative confirmation. |
| S3-004 | **P1 HIGH** | Manual sync truth | If media sync fails and the fallback queue query also fails, both pending counts are `-1`. The production branch computes `remainingMedia = -1`, skips `remainingMedia > 0`, and emits **“Everything is up to date.”** A read-only reproduction confirmed this fall-through. | **YES** | Treat unknown media state as attention/error, never success; return an explicitly unknown count; add failure-injection coverage for both media calls failing. |
| S3-005 | **P1 HIGH** | Firestore activity feed | Any verified user can create an `activity_feed` record with their own actor email, include their own and an arbitrary victim email in `participants`, omit `noteId`, and pass the rules. The victim's bounded listener then receives attacker-created activity. Schema/type/size constraints are also absent. | **YES** | Require an authorized shared-note relationship for every cross-user activity; constrain keys, types, action values, participant bounds, timestamps, and string sizes; add negative emulator tests. |
| S3-006 | **P1 HIGH** | Firestore comments | Comment create requires fields but not `hasOnly`, string type, body length, or server timestamp. Author update can add/change arbitrary fields while preserving only three fields. A malicious collaborator can store a map/object body that React later renders as `comment.body`, potentially breaking the collaboration UI for other participants. | **YES** | Enforce exact keys, string body with a conservative cap, immutable identity, server timestamps, and update-only allowed fields; add malformed-body and oversized/extra-field tests. |
| S3-007 | **P1 HIGH** | Mobile editor/messages safe areas | `viewport-fit=cover` is enabled. TopBar (which supplies top inset) is hidden while editing and during an active message chat, but the replacement Note Editor and Messages headers do not apply `safe-area-inset-top`. The active Messages composer also has no bottom safe-area inset after MobileNav is hidden. Back/Send can collide with a notch or home indicator. | **YES** | Apply top/bottom safe-area padding to each full-screen replacement chrome surface and verify in standalone mode across compact/large iPhone and Android viewports with keyboard open. |
| S3-008 | **P1 HIGH** | NTK AI accessibility | AI history items are clickable `<div>` elements without button semantics, role, `tabIndex`, or keyboard handler. Keyboard-only and many assistive-technology users cannot select a prior AI thread. The delete control is visually hover-only. | **YES** | Use semantic buttons/list controls, provide focus-visible behavior and accessible names, and make destructive actions discoverable without hover; add DOM keyboard/focus tests. |
| S3-009 | **P2 NORMAL** | Directory privacy | Rules allow any verified user to list discoverable directory entries with only `limit <= 10`. The existing emulator test explicitly proves a query containing only `where(discoverable == true)` and `limit(10)` is allowed. A malicious client can paginate and enumerate users without the UI's 3-character prefix check. | **YES** | Move search authorization to a design the server can enforce (for example, prefix-addressed documents or an authenticated bounded gateway); add an emulator test rejecting a discoverable-only list. |
| S3-010 | **P2 NORMAL** | Sync concurrency / Spark cost | `flushQueuedSync()` assigns `syncFlushPromise` every call but never returns an existing in-flight promise. Automatic and manual triggers can process the same queue concurrently, causing duplicate writes/races and unnecessary Spark usage. | **YES** | Return/await the active same-session flush, and clear only the promise instance that completed; add concurrent-call and account-switch tests. |
| S3-011 | **P2 NORMAL** | Backup chunk integrity | Cloud backup chunks use 700,000 JavaScript characters, not UTF-8 bytes. A fresh reproduction produced a 700,000-code-unit emoji chunk of 1,399,978 UTF-8 bytes, above Firestore's 1 MiB document limit. Restore does not compare actual chunks with metadata `chunkCount` or verify contiguous indices. | **YES** | Chunk by measured UTF-8 bytes below a safe envelope; preserve code points; validate count, indices, total byte size, and optional digest before parsing/restoring; add Unicode and missing-chunk tests. |
| S3-012 | **P2 NORMAL** | Touch targets / reduced motion | Critical phone controls in Messages and AI are approximately 28-40 CSS px (`p-1.5`, `p-2.5`, `h-10`) rather than the requested 44-48 px. Reduced-motion CSS disables only three custom classes; numerous `animate-spin`, `animate-pulse`, slide, fade, scale, and smooth-scroll behaviors remain. | **YES** | Raise critical controls to at least 44 CSS px and add a comprehensive `prefers-reduced-motion: reduce` policy, including non-essential animation and smooth scrolling. Verify contrast/focus/touch behavior live. |
| S3-013 | **P3 MINOR** | Theme pre-paint | `index.html` reads legacy unscoped `ntk-settings`, while production settings persist under `ntk:user:{uid}:settings`/guest namespaces. Reload can begin in the wrong theme and flash when React applies the correct account theme. | No | Store a non-sensitive device-level prepaint theme intentionally, or update it whenever the canonical account setting changes without exposing account data. |
| S3-014 | **P3 MINOR** | Spark efficiency | Sidebar already subscribes to the bounded direct-chat list. MoreView opens a second identical listener, and MessagesView opens another while Sidebar remains mounted but hidden. This duplicates initial reads and updates. | No | Lift unread state into one shared bounded subscription or conditionally disable the hidden duplicate. |

**Release-blocker count:** P0 = **2**, P1 = **6**, release-blocking P2 = **4**.

**Remaining non-blocking P3 count:** **2**.

## 5. Stage 2 mobile architecture and novice UX

| Area | Classification | Independent finding |
|---|---|---|
| Mobile navigation | **VERIFIED in source / live NOT VERIFIED** | MobileNav exposes Home, Notes, central Create, Search, and More; it is `lg:hidden`. Sidebar has a separate mobile drawer/desktop model and is not merely squeezed desktop chrome. |
| Create sheet | **VERIFIED in source / live NOT VERIFIED** | It is a bottom sheet with a dialog name, Escape handling, focus trap/return, bottom safe area, and 52 px rows. New Note, Checklist, Notebook, Reminder, Template, and Markdown all map to code paths. No interaction test proves single-activation behavior. |
| More | **VERIFIED in source / live NOT VERIFIED** | Workspace and Account & Application are separated; Profile, Settings, Appearance, Help, Messages, AI, Recycle Bin, reminders, notebooks, and Sync are discoverable. |
| Mobile editor | **DEFECT FOUND** | Dedicated header and keyboard-adjacent toolbar exist; desktop chrome and MobileNav hide. Bottom toolbar has safe-area padding, autosave/crash journal, checklist, attachment, AI, Listen, undo/redo, and dynamic-height structure. The replacement top header lacks notch inset; several header targets are only 40 px. Keyboard/caret behavior was not live tested. |
| Messages mobile | **DEFECT FOUND** | List/conversation split and local back behavior exist. Active-chat top/bottom safe areas are missing; critical targets are undersized; private drafts fail UID isolation. |
| NTK AI mobile | **DEFECT FOUND** | Drawer, multi-turn UI, Copy, Retry, Save as note, Insert, Stop, and offline message are present. Thread rows are non-semantic clickable divs and key controls are undersized. |
| Settings mobile hierarchy | **VERIFIED in source / live NOT VERIFIED** | Mobile uses a category list and selected subscreen with Back to All Settings. Required everyday categories and owner-only conditional section are present. |
| Navigation/back | **PARTIAL** | Note/editor and chat detail use local close/back state, preserving their parent list. Settings subscreens have local back. Global navigation stores only one `previousView`, not a history stack; tests cover one Home -> Settings -> Back transition only. Repeated/deep/direct flows were not live exercised. |
| Home novice UX | **PARTIAL** | Authenticated desktop Home visibly exposed six quick actions, recent notes, recent notebooks, Scratch Pad, and search access. No material desktop confusion was observed, but phone hierarchy and first-use comprehension were not tested. |

## 6. Mobile keyboard, safe-area, and touch audit

**DEFECT FOUND.** The root uses `h-dvh` and the document includes `viewport-fit=cover`, which are correct foundations. Safe-area protection is explicitly present on TopBar, MobileNav, CreateSheet, and the Note Editor bottom toolbar. It is not consistently propagated when those surfaces are replaced:

- full-screen Note Editor hides TopBar but does not add top safe-area padding to its mobile header;
- an active Messages conversation hides both TopBar and MobileNav, while its header/composer add neither top nor bottom safe-area padding;
- AI keeps TopBar/MobileNav and reserves bottom-nav space, but its send/history targets remain below the requested touch size;
- Messages Back, options, and Send controls are approximately 28-36 px; Note Editor secondary header actions are 40 px; several AI controls are approximately 28-36 px.

Software-keyboard collision, active-caret visibility, landscape keyboard space, and exact visual-viewport behavior are **NOT VERIFIED** because the required BrowserOS device-emulation journey was unavailable.

## 7. Functional acceptance matrix

| Product area | Classification | Evidence/limit |
|---|---|---|
| Notes and Search | **PARTIAL** | Source supports create/open/edit/pin/star/filter/sort/list/grid/kanban and bounded local search. Large-workspace pure logic passes. Search-result back is structurally preserved because closing editor retains `currentView`; live flow not completed. |
| Notebooks | **PARTIAL** | Create/rename/open/hierarchy/move/remove/trash code exists. Replace restore fails to sync imported notebooks. Live hierarchy and move flows not completed. |
| Reminders | **PARTIAL** | Create, active/completed, Today/Upcoming/Overdue categorization, Snooze, and note-linked/standalone models have behavioral tests. Mobile clipping/notification journey not completed. |
| Sharing | **DEFECT FOUND** | Owner/editor/commenter/viewer role logic and shared-note/notebook rules exist, and rule tests pass. Directory enumeration and comment/activity rule gaps prevent acceptance; no two-user convergence journey was completed. |
| Messaging privacy | **DEFECT FOUND** | Server rules restrict reads to participants and contain no owner surveillance override. Unsent local drafts are cross-account exposed; live request/accept/decline/block/send/receive was not completed. |
| NTK AI | **PARTIAL / accessibility DEFECT** | Source contains new chat, bounded multi-turn history, note context, Copy, Retry, Save/Insert, streaming completion, Stop, friendly errors, and reasoning stripping. Authenticated live gateway status reported AI available with four configured connections, but a chat journey was not run. Keys/routing secrets are not returned by status helpers. |
| Listen/TTS/audio | **PARTIAL** | Worker/frontend audio source is unchanged from the frozen baseline. Logic coverage for primary Cloudflare TTS, Google fallback, language normalization, download/save, playback, transcription authorization, size/type restrictions, and no owner media bypass passes. Live Listen, long note, selection, saved audio, and transcription were not rerun. |
| Offline/reconnect | **DEFECT FOUND** | UID-scoped durable note/queue IndexedDB, offline media queue, backoff, and conflict helpers have meaningful tests. Manual sync can falsely report fully up to date when media state is unknown, and flushes are not serialized. No live offline edit/reconnect was completed. |
| Conflict recovery | **VERIFIED in production helper and behavioral tests / live PARTIAL** | Remote canonical note is retained; one private recovered copy is created; sharing metadata is stripped; remote deletion is not resurrected; technical-only differences are ignored. Cross-device live proof was not repeated. |
| Recycle Bin/data lifecycle | **VERIFIED in production helper and behavioral tests / live PARTIAL** | Tests cover notes/notebooks, stale-remote protection, bounded phases, referenced/shared media protection, reminder cleanup, and lack of infrastructure-owner bypass. Live restore/permanent-delete/empty-bin journey was not run. |
| Backup/restore/export | **DEFECT FOUND** | Manual Firestore snapshot list/download/merge/replace UI and external B2/R2-connected export paths exist. Replace restore, notebook syncing, UTF-8 chunk sizing, and chunk validation are unsafe. No legitimate backup was touched and no live disposable object was created. |
| Profile | **PARTIAL** | Profile is exposed in desktop Account & App, More, and AccountMenu. Authenticated live Home showed the expected owner profile identity; profile-edit flow was not run. |
| Appearance | **PARTIAL** | Sidebar, More, and Settings all call the same store theme state with System/Light/Dark. Reload pre-paint reads the obsolete unscoped key, and live three-mode persistence was not completed. |
| Authentication | **PARTIAL** | Authenticated live session showed `isAnonymous === false` and Google provider. Google sign-in, Guest, sign-out, and A/B switching were not executed because doing so was unnecessary after the static P0 isolation reproductions and BrowserOS then disconnected. |
| Cross-user isolation | **DEFECT FOUND** | Notes, main workspace settings, crash journal, durable outbox, and offline media are UID-scoped. Message drafts and version histories are not. |

## 8. Security, privacy, and owner authority

### Positive findings

- **VERIFIED:** private user documents are limited to `request.auth.uid == userId`.
- **VERIFIED:** direct-chat and message reads are participant-only; no owner/admin surveillance bypass exists.
- **VERIFIED:** gateway owner authority is derived from server secrets (`OWNER_UIDS`/`OWNER_EMAILS`); no frontend owner-email allowlist was found.
- **VERIFIED:** owner controls fail closed in Settings and Sync Center when gateway status fails.
- **VERIFIED:** owner status responses return redacted connection/status metadata, not API keys, access keys, secret keys, endpoints, or bucket credentials.
- **VERIFIED:** Worker file authorization tests deny cross-user and infrastructure-owner access to private application media.
- **VERIFIED:** fresh generic secret scan found zero findings in the 131 files it scanned.

### Blocking findings

- same-browser draft and version-history isolation failures (S3-001/S3-002);
- cross-user activity injection (S3-005);
- permissive comment payload/update schema (S3-006); and
- enumerable discoverable directory (S3-009).

The 24 passing rules tests are real Firestore-emulator tests, but they do not cover these negative invariants. One existing test actively treats a discoverable-only list query as allowed, demonstrating that client-side three-character filtering is not a server security boundary.

## 9. Sync, offline, conflicts, and data lifecycle

### Durable local/offline architecture

**PARTIAL.** The main notes and document outbox are stored in UID-keyed IndexedDB and mirrored in UID-scoped localStorage. Crash journals include UID + note ID. The media queue is UID-isolated and has retry/backoff/terminal-state tests. Firestore uses persistent multi-tab local cache and snapshot listeners.

### Manual sync

**DEFECT FOUND.** It correctly queues debounced edits, flushes document writes, calls `waitForPendingWrites(db)`, and requests media draining. It does not perform a wasteful full collection pull; snapshots remain the incoming data path. However, the double-failure media branch maps unknown to `-1` and then reaches the success message. `lastManualSyncAt` and success metrics are also recorded in that case. The function's shared flush promise is not actually used as a mutex.

Read-only branch reproduction:

```text
{"remainingMedia":-1,"failedBranch":false,"attentionBranch":false,"fallsThroughToEverythingUpToDate":true}
```

### Conflict recovery and deletion

**VERIFIED in source/tests, live PARTIAL.** The recovery helper compares meaningful user-visible fields, keeps the server canonical note, creates one private recovered copy, strips collaboration metadata, and treats remote deletion as authoritative. Recycle Bin tests cover stale-device protection and shared/referenced media safety. These areas were not exercised in the incomplete live journey.

## 10. PWA acceptance

| Item | Result |
|---|---|
| Manifest | **VERIFIED** — standalone, `/` start/scope, 192/512/SVG maskable icons. |
| Service-worker source | **VERIFIED** — `ntk-note-offline-v12`, network-first navigation, same-origin cache fallback, old-cache cleanup, explicit `SKIP_WAITING`, notification deep links. |
| Registration/update prompt | **PARTIAL** — live browser showed active/controller worker plus an installed waiting worker and “An update is ready.” The Update action was not clicked after BrowserOS disconnected. |
| Offline shell | **PARTIAL** — live cache keys contained only `ntk-note-offline-v12`; full offline reload was not run. |
| Safe draft flushing | **PARTIAL** — editor registers `beforeunload`/`pagehide`, synchronously writes a UID-scoped crash journal, and flushes store edits before controller-change reload. Live update-during-edit was not tested. |
| Theme persistence | **DEFECT FOUND (P3)** — pre-paint reads obsolete `ntk-settings`. |
| Safe area/viewport | **DEFECT FOUND** — `h-dvh` and viewport-fit are present, but full-screen replacement headers/composer omit required insets. |

Local and live static-asset comparison before BrowserOS disconnected:

```text
local dist/index.html: 2,763,276 bytes; sha256 8898714619aaea0696fa710173dfd36f4c5e0a71b273609c3b8cd122de2fd08d
live  /index.html:      2,763,327 bytes; sha256 247f3fc93c3d9645ca8896fc1b48c141b7f498ceac130d1b473b77bb7e0b31b4
local/live manifest:   645 bytes; sha256 283fd9d28d41237537d4c90c2415bc30257d6e8b06fd4eb134d7a0e6f53cbe10
local/live sw.js:      3,916 bytes; sha256 39817a77007510a8238b373e31f2a372d7d5f35bd404ae35aed9c0b3024730b6
```

The manifest and service worker are byte-identical. The rebuilt HTML bundle differs from live by 51 bytes and by hash. This does not prove a functional drift by itself, but it prevents a claim of exact local/live bundle parity. No redeployment was attempted because defects remain and the required implementation/re-audit route is unavailable.

## 11. Performance and Spark-cost audit

### Fresh bundle comparison

The frozen `v2.8.2` Git tree was extracted into a disposable directory and rebuilt with the same installed Vite 7.3.2 toolchain. The temporary directory was removed after measurement.

| Build | Exact HTML bytes | Exact gzip bytes | Vite reported | Build time |
|---|---:|---:|---|---:|
| `v2.8.2` | 2,740,301 | 770,426 | 2,740.30 kB / 770.43 kB gzip | 50.79 s |
| Stage 3 HEAD | 2,763,276 | 774,331 | 2,763.28 kB / 774.33 kB gzip | 25.44 s |
| Growth | **+22,975** (+0.84%) | **+3,905** (+0.51%) | +22.98 kB / +3.90 kB gzip | n/a |

No dependency other than the package version changed between `v2.8.2` and HEAD, and no heavyweight animation library was added. The bundle remains a large single-file artifact; this audit did not measure cold-network Core Web Vitals.

### Large workspace

A focused fresh run reported:

```text
Production Large-Workspace Local Durability: 100, 500, 1000 Realistic Notes ... 26.4576ms
Large workspace performance: 1000 notes filter and sort executes in < 25ms ... 10.6096ms
tests 2; suites 1; pass 2; fail 0
```

These are useful production-helper/local-persistence checks, not browser DOM rendering, typing latency, or low-end-device proof. Cold/warm PWA load, editor typing, list rendering, messages, and AI thread rendering remain **NOT VERIFIED** live.

### Spark cost

Stage 2 did not change Firestore rules, Worker, Firebase configuration, or service worker. Queries for chats/messages/directory/AI/activity use explicit limits. The main user collections use snapshot listeners rather than manual full sweeps. S3-010 and S3-014 nevertheless create avoidable duplicate work/reads.

## 12. Firebase Spark and canonical cloud resources

Limited authenticated Firebase Console inspection before BrowserOS disconnection showed:

- **VERIFIED:** plan **Spark**, displayed as **No-cost ($0/month)**;
- **VERIFIED:** Cloud Functions page contains no functions and only the upgrade prompt — count **0**;
- **VERIFIED:** App Hosting page contains no backends and only the upgrade prompt — count **0**;
- **VERIFIED:** Firestore selector shows only `(default)`; adding another database requires upgrade — database count **1**;
- **VERIFIED in source:** Firebase Storage SDK is not imported for application media;
- **PARTIAL:** the console did not separately surface a billing-account identifier during the captured evidence, so “billing account NONE” is not claimed beyond the observed Spark/no-cost state.

Canonical source configuration is unchanged from `v2.8.2`:

- Worker name `ntk-note-gateway`;
- KV binding `NTK_CONFIG`;
- R2 binding `NTK_FILES`, bucket `ntk-note-files`;
- no Firebase Functions or App Hosting configuration;
- Worker source and config have zero Git diff from `v2.8.2`.

Authenticated gateway status returned HTTP 200, `connected: true`, owner-authorized status, AI available, four AI connections, two storage connections, all six storage purposes available, and the primary/fallback TTS architecture. BrowserOS disconnected before the two storage-connection names and B2 bucket could be independently re-read. Therefore `Main R2 Storage`, `NTK Backup`, and `ntk-note-backups` are **PARTIAL/current-context values**, not freshly completed live inventory evidence. No resource was created, deleted, duplicated, or redeployed.

The supplied current Worker deployment ID is `c88feccb-9113-4741-8fdd-031ccab589a9`. Worker source is unchanged; the deployment ID was not independently revalidated in the disconnected Appdevmanwill BrowserOS profile, and no new deployment was made.

## 13. Automated test-strength audit

### Fresh totals

- Logic: **291 tests / 44 suites / 291 pass / 0 fail**.
- Firestore rules: **24 tests / 1 suite / 24 pass / 0 fail**.

### Strength classification

The 24 rules tests execute against the Firestore emulator and are meaningful behavioral authorization tests for the cases they cover. Many earlier logic tests directly import production helpers, use real IndexedDB emulation, exercise queue/conflict/deletion algorithms, and inject failures.

The new Stage 1/Stage 2 counts must not be treated as 16 equivalent end-user regressions:

- Stage 2 adds nine tests: **one shallow Zustand navigation behavior test** and **eight source-text assertions**.
- Across Stage 1 + Stage 2, there are approximately **two direct production behavior checks**, **one partial real-helper/fake-toggle check**, **ten source-text invariants**, and **three synthetic arrays/functions copied into the test**.
- None mounts the changed React components or verifies DOM behavior, focus, touch size, viewport, keyboard, sheet interaction, safe areas, or screen-reader semantics.
- The directory rule test permits the exact unfiltered bounded query that enables enumeration.
- There is no A/B account-switch test for message drafts or version history.
- There is no double-failure manual-media-sync test, concurrent-flush test, Unicode backup-chunk test, missing-chunk test, restore-delete failure test, restored-notebook persistence test, malicious activity injection test, or malformed comment-body rule test.

The total pass count is genuine, but it is not sufficient acceptance evidence for the changed UI or the uncovered security/data-safety invariants.

## 14. Fresh required gate outputs

### `npm test`

```text
ℹ tests 291
ℹ suites 44
ℹ pass 291
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12882.2872
```

### `npm run test:rules`

```text
ℹ tests 24
ℹ suites 1
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17734.4217
Firestore rules test suite finished with exit code 0
```

### `npx tsc --noEmit`

```text
exit code 0
(no diagnostics)
```

### `npm --prefix cloudflare/ntk-gateway run typecheck`

```text
> ntk-note-gateway@0.2.0 typecheck
> tsc --noEmit

exit code 0
```

### `npm run build`

```text
> react-vite-tailwind@2.9.0 build
> vite build

vite v7.3.2 building client environment for production...
✓ 2675 modules transformed.
rendering chunks...
[plugin vite:singlefile] Inlining: index-CMrc1c6w.js
[plugin vite:singlefile] Inlining: style-V2YOTbxv.css
[plugin vite:singlefile] NOTE: asset not inlined: .assetsignore
[plugin vite:singlefile] NOTE: asset not inlined: wrangler.json
computing gzip size...
dist/.assetsignore      0.02 kB
dist/wrangler.json      1.09 kB │ gzip:   0.56 kB
dist/index.html     2,763.28 kB │ gzip: 774.33 kB
✓ built in 25.44s
```

Exact artifact measurement:

```text
dist/index.html bytes=2763276 gzip_bytes=774331 sha256=8898714619aaea0696fa710173dfd36f4c5e0a71b273609c3b8cd122de2fd08d
```

### `node scripts/audit_secrets.mjs`

```text
Scanning 131 repository files for generic secret shapes...

Scan complete. Total files scanned: 131. Findings: 0
```

The 131-file count is the fresh current-working-tree result, not the Stage 2 report's older count. Seventeen tracked documentation files were already deleted in the working tree when Stage 3 began, and the scanner also applies its own exclusions.

### Additional repository hygiene

```text
git diff --check
exit code 0
```

## 15. Accessibility acceptance

**DEFECT FOUND.** Positive source evidence includes named MobileNav/CreateSheet controls, `aria-current`, dialog labels, CreateSheet and Backup Center focus trap/return/Escape behavior, a global visible focus rule, live-region sync status, and several 44-52 px mobile targets.

Acceptance fails because:

- AI history selection is not keyboard-operable or semantically exposed;
- multiple critical mobile controls are below 44 px;
- reduced-motion handling is incomplete;
- full-screen safe-area omissions can obstruct controls; and
- no fresh automated accessibility scan, keyboard walkthrough, screen-reader walkthrough, or viewport contrast verification was completed.

The prior “482/482” result is not used as Stage 3 proof.

## 16. Viewport matrix

No physical-device test was performed. No complete device-emulation matrix was performed. The required BrowserOS Neo environment disconnected before viewport routing could begin.

| Viewport | Result |
|---|---|
| 360 x representative Android | **NOT VERIFIED** |
| 375 x compact iPhone | **NOT VERIFIED** |
| 390 x modern iPhone | **NOT VERIFIED** |
| 412 x Android | **NOT VERIFIED** |
| 430 x large iPhone | **NOT VERIFIED** |
| 844 x 390 landscape | **NOT VERIFIED** |
| 768 x 1024 tablet | **NOT VERIFIED** |
| 1024 x 768 tablet landscape | **NOT VERIFIED** |
| 1280 x 800 desktop | **PARTIAL** — authenticated desktop Home inspected; exact viewport was not recorded. |
| 1440 desktop | **NOT VERIFIED** |

## 17. Limited live acceptance evidence and blockers

Before disconnection, BrowserOS Neo FEAICCWS showed:

- signed-in account `feaiccws@gmail.com`;
- Google provider and `isAnonymous === false`;
- authenticated Home with desktop sidebar, quick actions, recent notes/notebooks, and Scratch Pad;
- gateway status HTTP 200, owner-authorized and connected;
- live PWA active/controller/waiting service-worker states and cache `ntk-note-offline-v12`;
- Firebase Spark/no-cost, Functions 0, App Hosting 0, and one Firestore database.

The realistic create/edit/format/checklist/attachment/Search/Notebook/Reminder/Share/Messages/AI/Listen/Profile/Appearance/Sync/offline/reconnect/Recycle Bin/restore/delete journey was **NOT completed**. No two-user journey was completed. No disposable content was created or deleted, so no test residue was added. Existing live notes were not modified.

Acceptance process blockers:

1. BrowserOS Neo skill/environment disconnected; no BrowserOS profile/window was available afterward.
2. Antigravity IDE / Gemini 3.8 Flash High implementation route was not available.
3. Requested GPT-5.6 Sol Ultra specialist reviewers reached the account usage limit and returned no audit findings.
4. Local/live HTML bundle hashes differ by 51 bytes, so exact deployment parity is unproven.
5. The working tree began with 17 unstaged tracked report deletions that are outside Stage 3's safe authority to discard.

## 18. Fixes performed

None. This is an audit/report-only Stage 3 outcome.

- No application source or Firestore rule was changed.
- No frontend or Worker was deployed.
- Worker deployment ID was not changed.
- Service-worker version remained `ntk-note-offline-v12`.
- No cloud resource or backup was created, altered, or deleted.
- No branch was merged, tagged, pushed, or rewritten.

## 19. Working-tree truth

At Stage 3 start, the worktree already contained 17 unstaged tracked documentation deletions. They were preserved. This report adds one untracked documentation file. Restoring or committing the pre-existing deletions without explicit direction could discard user-owned changes, so the required clean-tree stop condition is **NOT MET** and the report is **NOT COMMITTED**.

The Stage 3 ending HEAD therefore remains `a288023c3b3d98b07490d229d7990f74ce42733c`.

## 20. Final Stage 3 gate table

| Gate | Result |
|---|---|
| Auditor/model | Codex primary auditor; exact runtime variant not exposed. Requested GPT-5.6 Sol Ultra specialist runs quota-blocked and are not counted as completed. |
| Reasoning level | Strongest available in the active task; requested Ultra specialist evidence unavailable. |
| Branch | `final-novice-ux` |
| Actual starting HEAD | `a288023c3b3d98b07490d229d7990f74ce42733c` |
| Stage 3 ending HEAD | `a288023c3b3d98b07490d229d7990f74ce42733c` |
| v2.8.2 tag target | **VERIFIED** `43b6121698035d54978111fb17496b94f47156d4` |
| Historical secret ancestor result | **NO**; `merge-base --is-ancestor` exit 1 |
| Release blockers P0 | **2** |
| Release blockers P1 | **6** |
| Release-blocking P2 | **4** |
| Non-blocking P3 count | **2** |
| Native mobile architecture | **VERIFIED in source / live PARTIAL** |
| Mobile editor | **DEFECT FOUND** |
| Mobile keyboard safety | **NOT VERIFIED; safe-area defect found** |
| Safe areas | **DEFECT FOUND** |
| Navigation/back stack | **PARTIAL** |
| Create sheet | **VERIFIED in source / live NOT VERIFIED** |
| More navigation | **VERIFIED in source / live NOT VERIFIED** |
| Settings mobile hierarchy | **VERIFIED in source / live NOT VERIFIED** |
| Messages mobile | **DEFECT FOUND** |
| NTK AI mobile | **DEFECT FOUND** |
| Home novice UX | **PARTIAL** |
| Notes/Search | **PARTIAL** |
| Notebooks | **DEFECT FOUND in restore path; routine UI PARTIAL** |
| Reminders | **PARTIAL** |
| Sharing | **DEFECT FOUND** |
| Messaging privacy | **DEFECT FOUND** |
| AI | **PARTIAL; accessibility defect** |
| Listen/TTS | **PARTIAL** |
| Offline/reconnect | **DEFECT FOUND** |
| Conflict recovery | **VERIFIED helper/tests / live PARTIAL** |
| Recycle Bin/data lifecycle | **VERIFIED helper/tests / live PARTIAL** |
| Backup/restore | **DEFECT FOUND** |
| Profile | **PARTIAL** |
| Appearance | **PARTIAL; P3 prepaint defect** |
| Authentication | **PARTIAL; authenticated owner verified** |
| Cross-user isolation | **DEFECT FOUND (2 P0s)** |
| Accessibility | **FAIL** |
| Reduced motion | **DEFECT FOUND** |
| PWA | **PARTIAL; v12 verified** |
| 360px | **NOT VERIFIED** |
| 375px | **NOT VERIFIED** |
| 390px | **NOT VERIFIED** |
| 412px | **NOT VERIFIED** |
| 430px | **NOT VERIFIED** |
| Phone landscape | **NOT VERIFIED** |
| Tablet | **NOT VERIFIED** |
| Desktop | **PARTIAL** |
| Performance | **PARTIAL**; +22,975 raw bytes / +3,905 gzip bytes vs fresh v2.8.2 build |
| Logic tests | **PASS** — 291/291, 44 suites; strength limitations documented |
| Rules tests | **PASS** — 24/24, 1 suite; missing negative invariants documented |
| Frontend TypeScript | **PASS** — exit 0, no diagnostics |
| Worker TypeScript | **PASS** — exit 0, no diagnostics |
| Build exact result | **PASS** — 2,763,276 bytes; 774,331 gzip bytes; 25.44 s |
| Secret scan exact result | **PASS** — 131 files, 0 findings |
| Worker version | `c88feccb-9113-4741-8fdd-031ccab589a9` supplied/current-context; unchanged source, live ID not revalidated |
| Service Worker version | **VERIFIED** `ntk-note-offline-v12`; local/live SW hash identical |
| Firebase Spark | **VERIFIED** |
| Billing | **VERIFIED No-cost ($0/month); billing account NONE not separately surfaced** |
| Cloud Functions | **VERIFIED 0** |
| App Hosting | **VERIFIED 0** |
| Firestore DB count | **VERIFIED 1** |
| Working tree | **FAIL / DIRTY** — 17 pre-existing tracked deletions + this untracked report |
| Final Stage 3 verdict | **C. FAIL — RELEASE BLOCKER REMAINS** |

## 21. Required next audit cycle

Stage 3 can be resumed only after the release blockers are corrected through the authorized implementation route. The correction should be minimal and separated into auditable changes, with new behavioral/emulator tests for every invariant. Codex must then independently rerun all six local gates, verify the exact build, deploy only the necessary frontend/rules changes to the existing Firebase project, complete the BrowserOS Neo owner and two-user live journey, clean disposable residue, and reconcile the working tree.

Do **not** merge to main, create `v2.9.0`, push the final release, create a release ZIP/checksum, enter maintenance mode, or declare the project complete. Those remain Stage 4 actions and are not authorized while this verdict is FAIL.
