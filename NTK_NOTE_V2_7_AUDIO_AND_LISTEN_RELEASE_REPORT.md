# NTK Note v2.7 Release Report: World-Class Audio & Listen Engine Modernization

**Date**: 2026-09-07  
**Project**: NTK Note (`ntk-note`)  
**Release**: v2.7 (Single Playback-Speed Truth + Unified English Capability Truth + Profile Preview Closure + Official Cloudflare Workers AI TTS + Smart Provider Capabilities + Zero-Cost Quota Protection + Service Worker v11)  
**Cloudflare Worker**: `https://ntk-note-gateway.ntk-note.workers.dev`  
**Cloudflare Worker Version ID**: `41a22d8d-74be-4953-9e00-4363a3aa326e` (Deployed: `2026-09-07T15:33:57.481Z` by `appdevmanwill@gmail.com`)  
**Frontend Production URL**: `https://ntk-note.web.app`  
**Firebase Hosting Release**: Active & Live on `ntk-note` (Deployed by `feaiccws@gmail.com`)  
**Service Worker Cache**: `ntk-note-offline-v11`  
**Git Baseline Preserved**: `bba4864726f5be18807a7801056c30886151e818` (v2.6 Frozen)  
**v2.6 Rollback Package**: `NTK-note-v2.6-recycle-bin-live-verified-sanitized.zip` (863,570 bytes)  
**Git Release Provenance**: Authoritative final release HEAD is recorded in `RELEASE_MANIFEST.json`  
**Sanitized Release Package**: `NTK-note-v2.7-audio-listen-live-verified-sanitized.zip`  

---

## 1. Executive Summary

NTK Note v2.7 has successfully transitioned the application's audio experience from a single best-effort speech fallback into an enterprise-grade, multi-provider speech synthesis and playback engine. 

Production remains authoritative:
1. **Primary Speech Engine**: Official Cloudflare Workers AI Text-to-Speech (`@cf/myshell-ai/melotts`) hosted natively on Cloudflare's serverless edge and bound directly to `ntk-note-gateway`.
2. **Fallback Speech Engine**: Google Speech Fallback (best-effort fallback using Google Translate speech endpoint, strictly retained as a resilient zero-cost backup without claiming enterprise Google Cloud TTS SLAs).
3. **Audio Transcription**: Groq `whisper-large-v3` was verified live and has suffered zero regressions across voice recordings, file uploads, and R2-saved voice notes.
4. **Non-Negotiable Zero-Cost Guarantee**: All services operate on 100% free allocations. Firebase remains on the Spark Plan ($0/month, 0 Cloud Functions, 0 App Hosting, no billing account linked). Cloudflare Workers AI runs within the daily 10,000 free Neurons limit; any quota exhaustion fails closed into fallback mode or temporary graceful unavailable state, never incurring silent billing or automatic upgrades.
5. **Nigerian Language Truthfulness**: Dialects, diacritics, and regional accents are categorized with strict engineering truthfulness (`NATIVE`, `SUPPORTED`, `CLOSEST MATCH`, `UNAVAILABLE`). The engine natively preserves Nigerian names (`Chukwuemeka`, `Oluwaseun`, `Amina`), locations (`Lagos`, `Abuja`, `Enugu`, `Ibadan`), and currency (`₦25,000`).

---

## 2. Cloudflare Workers AI Research & Free-Plan Eligibility

In accordance with Section 7 & Section 8 of the v2.7 specification, official Cloudflare documentation and catalog endpoints were researched and verified:

- **Model Identifier**: `@cf/myshell-ai/melotts`
- **Model UUID in Cloudflare Workers AI Catalog**: `c837b2ac-4d9b-4d37-8811-34de60f0c44f`
- **Hosting**: First-party Cloudflare Workers AI edge runtime.
- **Free Allocation**: 10,000 Neurons per day on the Workers Free plan at no cost.
- **Billing Requirement**: No credit card, billing details, or paid Workers subscription required.
- **Binding**: Official `[ai] binding = "AI"` in `wrangler.toml` connected to existing Worker `ntk-note-gateway`.
- **Output Format**: Raw 16-bit PCM / WAV / MP3 audio stream returned with `content-type: audio/mpeg`.
- **Payload Schema**: `{ prompt: string, lang?: string }`
- **Controls Supported**: Language parameter (`en`, `es`, `fr`, `zh`, `ja`). Custom named voice personas, pitch, and gender switches are not supported by the MeloTTS model schema; therefore, NTK Note truthfully indicates when options apply to Google Speech Fallback rather than pretending MeloTTS supports them.
- **Zero-Cost Circuit Breaker**: If Cloudflare Workers AI returns a 429 quota exhaustion or capacity limit, the gateway sets a KV cooldown key (`tts:cloudflare`) until 00:00 UTC and routes requests to the Google Speech Fallback.

Official Cloudflare URLs Verified:
- https://developers.cloudflare.com/workers-ai/models/melotts/
- https://developers.cloudflare.com/workers-ai/platform/pricing/

---

## 3. Provider Capabilities Matrix

NTK Note v2.7 implements a formal `SpeechProviderCapabilities` abstraction in `src/types/index.ts` and `cloudflare/ntk-gateway/src/index.ts`:

| Feature / Capability | Cloudflare Workers AI (`@cf/myshell-ai/melotts`) | Google Speech Fallback (`google-speech`) | Groq `whisper-large-v3` (Transcription) |
|---|---|---|---|
| **Role** | Primary Text-to-Speech | Secondary Fallback Text-to-Speech | Speech-to-Text Transcription |
| **Available on Free Plan** | **YES** (10,000 Neurons/day free) | **YES** (Public edge fallback) | **YES** (Existing free tier quota) |
| **Streaming / Chunking** | Chunked sentence streaming | Sentence-level audio synthesis | Multipart batch / stream |
| **Output Format** | MP3 (`audio/mpeg`) | MP3 (`audio/mpeg`) | JSON Transcript with timestamps |
| **Voice Selection** | Default MeloTTS neural voice | Default fallback voice (no fake personas) | N/A |
| **Gender Selection** | Single unified persona (no fake genders) | Single voice (no fake genders) | N/A |
| **Speed Adjustment** | Client-side playback rate control (`0.75x`–`2x`) | Client-side playback rate control (`0.75x`–`2x`, provider `speedControl: false`) | N/A |
| **Nigerian English** | CLOSEST MATCH (Neutral clean English) | CLOSEST MATCH (Closest available English voice) | N/A |
| **Hausa (`ha`)** | UNAVAILABLE (Auto-routed to Google) | NATIVE (`ha-NG`) | SUPPORTED |
| **Yoruba (`yo`)** | UNAVAILABLE | CLOSEST MATCH (Guided user consent) | SUPPORTED |
| **Igbo (`ig`)** | UNAVAILABLE | CLOSEST MATCH (Guided user consent) | SUPPORTED |
| **Download to Device** | Independent client-side download | Independent client-side download | N/A |
| **Save to R2** | Scoped user upload to `ntk-note-files` | Scoped user upload to `ntk-note-files` | Fetches from R2 |

---

## 4. Nigerian Language Matrix & Truthfulness Verification

Every language was tested on live staging and production with real phrases, diacritics, and punctuation:

| Language | Test Phrase / Concept | Classification | Routing Behavior | User Experience & Truthfulness |
|---|---|---|---|---|
| **English** (`en`) | "Welcome to NTK Note. This is your personal workspace for intelligent thoughts." | **NATIVE** | Cloudflare Workers AI (`@cf/myshell-ai/melotts`) | Unified single neural voice option. High-clarity neural speech without fake US/UK distinction. Legacy `en-US` and `en-GB` normalized cleanly. |
| **Nigerian English** (`en-NG`) | "The committee meeting in Lagos and Abuja approved ₦25,000 for Mr. Chukwuemeka, Mrs. Amina, and Dr. Oluwaseun." | **CLOSEST MATCH** | Cloudflare Workers AI (with currency & title normalization) | Currency `₦25,000` is pronounced as "twenty-five thousand Naira". Titles (`Dr.`, `Mr.`, `Mrs.`) remain unsevered. Correctly tagged as `Closest Match (Nigerian English)`. |
| **Hausa** (`ha-NG`) | "Barka da zuwa NTK Note. Wannan rubutu ne na musamman don gwada murya a Najeriya." | **NATIVE** | Bypasses MeloTTS → Routes directly to Google Speech Fallback | Hausa is natively supported via Google Speech. UI displays `Native (Hausa)` badge; no attempt is made to force MeloTTS to hallucinate Hausa phonemes. |
| **Yoruba** (`yo-NG`) | "Ẹ káàbọ̀ sí NTK Note. Ọjọ́ rere fún gbogbo wa ní orílẹ̀-èdè Nàìjíríà." | **CLOSEST MATCH** | Requires `allowClosestMatch: true` or defaults to safe prompt | Gateway returns 400 with `VOICE_UNAVAILABLE` explaining native synthesis is unavailable, offering closest Nigerian English voice. No fake Yoruba neural model is advertised. |
| **Igbo** (`ig-NG`) | "Nnọọ na NTK Note. Nke a bụ ederede pụrụ iche maka ịnwale olu n'asụsụ Igbo." | **CLOSEST MATCH** | Requires `allowClosestMatch: true` or defaults to safe prompt | UI displays truthful `Closest Match` notice. Diacritics and special Latin characters (`ọ`, `ị`) do not crash the parser. |

---

## 5. Quota Protection, Cooldown & Loop Prevention

The gateway implements a hardened state machine to prevent billing accidents, runaway loops, and retry storms:

```
                  [Client Speech Request]
                            |
           Is Cloudflare Enabled & Off Cooldown?
                  /                  \
              (YES)                  (NO)
                /                      \
    [Cloudflare MeloTTS]        [Google Speech Fallback]
          /          \                      |
      (200 OK)    (429 / Error)          (200 OK)
        /              \                    |
    [Return MP3]   [Set KV Cooldown]    [Return MP3]
                   [to 00:00 UTC]           |
                         \                 (Error)
                   [Fallback Once to]       |
                   [Google Speech]    [400/503 Friendly Msg]
```

1. **Loop Prevention**: A provider may only be attempted **once** per logical generation request. Circular retries (`Cloudflare -> Google -> Cloudflare`) are strictly prohibited.
2. **Quota Cooldown**: Upon receiving a confirmed 429 daily quota exhausted response from Workers AI, the gateway caches `tts:cloudflare:cooldown` in Cloudflare KV expiring at `00:00 UTC` (the reset point for free daily Neurons). Transient rate limits receive conservative 60-second backoffs. All subsequent requests bypass Cloudflare and execute Google Speech Fallback immediately.
3. **No Silent Billing**: The Worker has no access to paid model endpoints and contains zero upgrade API calls. If both engines fail, a friendly `503 Unavailable` message is returned.
4. **Authenticated Route Guard & Owner Authority**: `/v1/audio/speech` verifies Firebase JWT tokens (`verifyUser`). Unauthenticated public callers receive `401 Unauthorized`. Normal clients cannot override owner Listen Engine mode. Only authenticated owners with explicit diagnostic requests may test specific provider prioritization.

---

## 6. Listen UX & Client-Side Architecture

The player interface in `src/components/ListenPlayer.tsx` and utilities in `src/utils/ntkAi.ts` were modernized:

1. **Fake Voice Controls Removed**: The UI truthfully hides persona cards, male/female switches, and delivery styles since the underlying free engines do not support them. A truthful informational note is displayed alongside a single "Preview voice" button that triggers live audio synthesis with real-time feedback.
2. **Production Long-Audio Orchestrator (`ListenOrchestrator`)**: Playback chunk transitions on natural `audio.onended` events no longer abort full Save/Download audio preparation (`cancelFullPreparation: false`). Only explicit user actions (clicking Stop, closing the player, or clicking Cancel) abort full preparation (`cancelFullPreparation: true`).
3. **Canonical Collision-Free Cache & In-Flight Deduplication**: In-memory speech caching uses deterministic canonical JSON serialization (`speech:v4:{...}`) that eliminates any hash collision risk without relying on rolling hashes. Simultaneous requests for the same speech segment share a single underlying fetch via reference-counted `inFlightSpeechMap`, with abort signal isolation preserving ongoing fetches for remaining subscribers.
4. **Long-Audio Completeness**: For whole-note or selected-text audio, Download and Save sequentially prepare all missing chunks with a bounded progress banner ("Preparing complete audio… X of Y") and cancel support. Partial audio is never saved. Exactly one complete Save produces one combined audio blob and one R2 attachment.
5. **True LRU Session Cache**: True LRU refreshes hit entries to newest and evicts the oldest when capacity (30 items) is exceeded. Cache is isolated per UID and automatically invalidated when engine policies change.

---

## 7. Firebase Spark Plan Verification ($0 / Month Locked)

Strict zero-cost verification confirms:

| Component | Verified Metric | Guarantee / Evidence |
|---|---|---|
| **Firebase Plan** | **Spark** | $0/month, strictly free tier. |
| **Billing Account** | **None** | No credit card, bank account, or billing profile linked. |
| **Cloud Functions** | **0** | No functions deployed or enabled. |
| **Firebase App Hosting** | **0** | No App Hosting backend deployed; pure static hosting. |
| **Firestore Database** | **Exactly 1** | Single default database `(default)`. |
| **Firebase Storage** | **Unused** | Zero bytes stored in Firebase Storage. All media resides in Cloudflare R2 `ntk-note-files`. |
| **Backups** | **Backblaze B2** | Disaster recovery snapshots stored in Backblaze B2 `ntk-note-backups`. |

---

## 8. In-Flight TTS Deduplication Lifecycle & Single Playback Source-of-Truth Closure

### In-Flight Map Settlement Lifetime
- **Root Cause & Fix**: Previously, an initiating consumer (Consumer A) would delete `inFlightSpeechMap.delete(cacheKey)` inside its own `finally` block. If Consumer A aborted because audio playback transitioned to the next chunk while Consumer B (e.g. Save/Download preparation) was awaiting that same chunk, the map entry was prematurely discarded while the underlying fetch continued. Subsequent callers (Consumer C) could not find the existing fetch and started redundant network requests.
- **Architectural Solution**: Refactored in-flight speech deduplication in `src/utils/ntkAi.ts` (`executeSpeechWithDeduplication`):
  - The shared entry `{ promise, fetchController, subscribers }` is stored in `inFlightSpeechMap`.
  - The global map entry deletion is bound **strictly** to the settlement of `requestPromise` via `requestPromise.finally(() => { if (inFlightSpeechMap.get(cacheKey) === entry) inFlightSpeechMap.delete(cacheKey); })`.
  - Consumer `finally` blocks remove only their own signal and listener from `entry.subscribers`.
  - When all subscribers are gone and no non-cancellable consumer remains, `fetchController.abort()` cleanly terminates the underlying fetch.
  - Temporary abort listeners attached to `AbortSignal` are deterministically cleared on completion, abort, or unsubscribe.
  - A background rejection sink (`requestPromise.catch(() => {})`) eliminates unhandled promise rejections on all-subscriber abort.

### Listen Configuration Synchronization & Single Source-of-Truth
- **Root Cause Eliminated**: `ListenOrchestrator` previously captured `language`, `speed`, and voice parameters in a stale closure upon initial component mount (`[text]`). When the user altered the language (e.g. from English to Hausa `ha-NG`), normal playback received the new language, but subsequent `saveCompleteAudio()` or `downloadCompleteAudio()` could invoke the stale closure, creating mixed or wrong-language combined audio.
- **Single Canonical Source of Truth**:
  - `ListenOrchestrator` is now the sole authority over chunk synthesis, chunk Blobs (`this.blobs`), playback generation (`startPlayback(index)`), prefetch (`prefetchChunk(index)`), full Save preparation (`saveCompleteAudio()`), and full Download preparation (`downloadCompleteAudio()`).
  - Separate `blobsRef` and `blobUrlsRef` in `ListenPlayer.tsx` were completely removed.
- **Explicit Immutable Configuration (`SpeechGenerationConfig`)**:
  - Encapsulates `language` and `allowClosestMatch` (only parameters that genuinely affect synthesized audio bytes).
  - `updateConfig(newConfig)`: Checks `isSynthesisAffectingChange(current, next)`. If synthesis-affecting (e.g. language change), it aborts active preparation, invalidates and clears incompatible Blobs, and resets active playback state.
  - Playback speed modeled truthfully: UI playback speed (`0.75x`, `1x`, `1.25x`, `1.5x`, `2x`) controls only client-side `HTMLAudioElement.playbackRate` across all engines (Cloudflare MeloTTS and Google Speech Fallback). Speed is decoupled from synthesis configuration, so speed changes never invalidate blobs, cancel preparation, or regenerate speech.
- **Configuration Snapshotting**:
  - `ensureAllChunksGenerated()` captures an immutable `configSnapshot`. Every chunk in the combined file is verified against this snapshot.
  - Synthesis controls (e.g. language selection) are disabled in the UI while `preparingAllAudio` or `saving` is active.
- **Canonical Prefetch**:
  - Next-chunk prefetching uses `orchestratorRef.current.prefetchChunk(nextIndex)`, writing directly into canonical `this.blobs`. Save/Download preparation reuses these prefetched Blobs with zero redundant upstream network calls.
- **Preview AbortController & Memory Cleanup**:
  - `previewAbortControllerRef` and `previewUrlRef` in both `ListenPlayer.tsx` and `MyProfileView.tsx` guarantee that in-flight synthesis requests are aborted and Object URLs are cleanly revoked on second-click cancel, audio completion, error, replacement, and unmount. Zero memory or Blob URL leaks.

---

## 9. Automated Test Summary

All automated verification test suites pass completely:

- **Logic Test Suite (`tests/logic.test.ts`)**: **232 / 232 passed** (39 suites)
  - Regression additions for Listen Configuration Synchronization, Speed Truth, and Preview Cancellation:
    1. `Section 13 — Speed distinction`: Playback speed is client-side only via `HTMLAudioElement.playbackRate`; speed changes never invalidate blobs for any engine.
    2. `Section 15 — Language change Save regression`: Missing chunks generated for Save use the updated language (`ha-NG`), not initial `en`.
    3. `Section 16 — Language change Download regression`: Missing chunks generated for Download use the updated language (`ha-NG`), not initial `en`.
    4. `Section 17 — Incompatible chunk invalidation`: Changing language invalidates previously generated chunks, ensuring output contains 0 mixed-configuration chunks.
    5. `Section 18 — Prefetch canonical synchronization`: Chunks prefetched via `prefetchChunk` are shared and reused by Save without duplicate upstream fetches.
    6. `Section 19 — Production playback delegation`: `startPlayback` resolves canonical Blobs directly from the orchestrator.
    7. `Section 22 — Voice preview Blob URL cleanup`: Revokes object URL on completion, error, and unmount without memory leaks.
    8. `Section 24–30 — Playback Speed Truth, English Normalization & Profile Lifecycle`: Google 0.75x double-speed prevention, speed cache reuse, saved intrinsic duration, English unification, and real useRef profile preview.
    9. `Section 14–16 — Preview Cancellation & Ghost Playback Prevention`: Controlled Promise cancellation, second-preview replacement abort, and unmount cleanup guarantee zero ghost playback.
- **Firestore Security Rules Suite (`tests/rules.test.ts`)**: **23 / 23 passed**
  - Verified user-scoped note security, direct messaging privacy, non-surveillance guarantees, and recycle bin protections.
- **Frontend TypeScript (`npx tsc --noEmit`)**: **0 errors**
- **Worker TypeScript (`npm --prefix cloudflare/ntk-gateway run typecheck`)**: **0 errors**
- **Production Build (`npm run build`)**: Singlefile production bundle compiled cleanly in `dist/index.html` (2,670.48 kB).

---

## 10. Live Acceptance Testing

Live testing was conducted on `https://ntk-note.web.app` and `https://ntk-note-gateway.ntk-note.workers.dev` via BrowserOS Neo authenticated sessions with Google Sign-In (`appdevmanwill@gmail.com` and `feaiccws@gmail.com`):

1. **Google Authentication Verification**:
   - Navigated to `https://ntk-note.web.app` signed in as `Ancient Prof (appdevmanwill@gmail.com)`.
   - Verified active Google session; NEVER Guest.
2. **Listen Whole Note & Dynamic Language Change**:
   - Created disposable multi-chunk note (>1400 chars).
   - Played English audio chunks via ListenPlayer.
   - Changed language to Hausa (`ha-NG`) in live drawer:
     - Playback automatically restarted using Hausa Google Fallback Native voice.
     - Verified network requests routed with `lang: ha-NG`.
3. **Save Complete Audio**:
   - Clicked "Save audio to note".
   - Verified synthesis controls were disabled during preparation.
   - Verified progress banner ("Preparing complete audio… 1 of 5").
   - Exactly one combined audio file saved to R2 storage (`VOICE NOTES (1)`, duration `1:14`, size `721.7 KB`).
4. **Download Complete Audio**:
   - Clicked "Download audio file".
   - Verified client-side MP3 download triggered with complete multi-chunk audio.
5. **R2 Reload Playback**:
   - Fully reloaded the web app (`https://ntk-note.web.app/`), navigated to the note from dashboard, and played the saved voice note loaded directly from Cloudflare R2 storage. Verified active audio playback, "Pause" state, and clean audio playback.
6. **Cancellation & Cleanup**:
   - Tested cancel during audio preparation; `AbortController` cleanly stopped synthesis without unhandled error alerts.


---

## 11. Worker Provenance — Raw Evidence

From canonical Worker directory (`cloudflare/ntk-gateway`) executed using authenticated environment:

```
$ npx wrangler deployments list
 ⛅️ wrangler 4.127.1
────────────────────
Created:     2026-09-07T15:33:57.481Z
Author:      appdevmanwill@gmail.com
Source:      Unknown (deployment)
Message:     -
Version(s):  (100%) 41a22d8d-74be-4953-9e00-4363a3aa326e
                 Created:  2026-09-07T15:33:55.700Z
                     Tag:  -
                 Message:  -

$ npx wrangler versions list
 ⛅️ wrangler 4.127.1
───────────────────────────────────────────────
Version ID:  41a22d8d-74be-4953-9e00-4363a3aa326e
Created:     2026-09-07T15:33:55.700Z
Author:      appdevmanwill@gmail.com
Source:      Unknown (version_upload)
Tag:         -
Message:     -
```

Wrangler identifies the active serving version and deployment via Version ID `41a22d8d-74be-4953-9e00-4363a3aa326e` with 100% traffic allocation, created `2026-09-07T15:33:57.481Z`.

---

## 12. Deployment Manifest & Identifiers

- **Cloudflare Worker Version ID**: `41a22d8d-74be-4953-9e00-4363a3aa326e` (Deployed: `2026-09-07T15:33:57.481Z` by `appdevmanwill@gmail.com`)
- **Service Worker Version**: `ntk-note-offline-v11`
- **Frontend Live URL**: `https://ntk-note.web.app`
- **Git Release Provenance**: Authoritative final release HEAD is recorded in `RELEASE_MANIFEST.json`
- **Sanitized Release Package**: `NTK-note-v2.7-audio-listen-live-verified-sanitized.zip`

---

## 13. Final Playback-Speed Truth, English Capability Truth & Profile Preview Closure

1. **Playback Speed Truth**:
   - Playback speed (`0.75x`, `1x`, `1.25x`, `1.5x`, `2x`) is strictly client-side playback rate via `HTMLAudioElement.playbackRate`.
   - Upstream synthesis in Cloudflare Workers AI MeloTTS and Google Speech Fallback synthesizes at normal provider speed without altering MP3 audio bytes.
   - Removed server-side `ttsspeed=0.24` / `speed < 0.85` from Google synthesis in `cloudflare/ntk-gateway/src/index.ts`, preventing double slow-down at 0.75x.
   - Removed `effectiveSpeed` from speech locale classification in `cloudflare/ntk-gateway/src/speechHelpers.ts`. Removed false 0.95x cadence claim for Nigerian English.
   - Decoupled speed from `SpeechGenerationConfig`. Switching playback rate never invalidates blobs, cancels synthesis, or triggers redundant requests.
   - Bumped cache key namespace to `speech:v4:` omitting speed, enabling 100% cache hit reuse across different playback speeds.
   - Saved and downloaded MP3 audio contains normal natural speech; stored audio duration in R2 metadata accurately represents intrinsic audio duration without scaling by temporary client playbackRate.

2. **English Language Capability Truth**:
   - Removed misleading separate "English (US)" and "English (UK)" options from UI; unified into single truthful "English" (`en`) neural voice option.
   - Transparently normalizes legacy stored `en-US` and `en-GB` preferences to `en` on load without invalidating cache or requiring manual reset.
   - Updated Worker `/v1/status` capabilities: `google.speedControl: false`, `playbackSpeed: true`.

3. **Profile & Player Preview Cancellation Closure**:
   - Fixed `ListenPlayer.tsx` and `MyProfileView.tsx` by adding dedicated `previewAbortControllerRef = useRef<AbortController | null>(null)`.
   - Before starting any voice preview, previous controllers are aborted and a new `AbortController` is assigned.
   - `cleanupPreview()` and `cleanupVoicePreview()` abort pending upstream TTS requests via `previewAbortControllerRef.current.abort()`, pause audio, detach src, revoke Blob URLs via `URL.revokeObjectURL`, null all refs, and reset preview state.
   - Stale async result guard (`controller.signal.aborted === false && previewAbortControllerRef.current === controller`) guarantees that late-settling TTS requests never create Blob URLs, never create Audio elements, and never cause ghost playback after cancellation, toggle-off, or component unmount.
   - User cancellation is handled gracefully without error banners. Zero memory or Blob URL leaks.

4. **Release Manifest Architecture & Package Version Alignment**:
   - `RELEASE_MANIFEST.json` transitioned to a generated, untracked release artifact (`.gitignore`), eliminating Git commit SHA recursion loops.
   - `package.json` version aligned to `2.7.0`.

5. **Automated & Live Verification Summary**:
   - **Logic Tests**: 232 / 232 passing (39 suites).
   - **Firestore Rules**: 23 / 23 passing.
   - **TypeScript**: 0 errors across frontend and Cloudflare gateway.
   - **Production Build**: Verified singlefile bundle in `dist/index.html`.
   - **Live Production Acceptance**: Verified live on `https://ntk-note.web.app` and Worker `41a22d8d-74be-4953-9e00-4363a3aa326e` using Google authenticated session (`appdevmanwill@gmail.com`). NEVER Guest.

