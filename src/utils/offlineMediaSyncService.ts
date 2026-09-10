/**
 * NTK Note v2.8 — Global Offline Media Sync Service
 *
 * Decouples offline media synchronization from component lifecycles (e.g. NoteEditor).
 * Coordinates single-leader queue draining across browser tabs, guarantees stable remoteObjectId usage,
 * updates note metadata upon upload completion, and handles cross-tab manual sync requests.
 *
 * v2.8 Reliability Closure:
 * - Web Locks exclusive drain: prevents concurrent drain across tabs even without BroadcastChannel.
 * - Auth-session generation guard: stops drain mid-loop on UID change.
 * - Follower timeout no longer force-drains: returns truthful pending count instead.
 * - scheduleNextBackoffRetry uses ALL pending items for timer calculation.
 */

import { uploadStorageFile, type StoragePurpose } from '@/utils/cloudStorage';
import {
  syncPendingMediaForUser,
  getPendingMediaForUser,
  resumeAuthPausedMediaForUser,
  type OfflineMediaItem,
} from '@/utils/offlineMediaQueue';
import { getTabCoordinator, TabCoordinator, type TabMessage } from '@/utils/tabCoordinator';
import { useStore } from '@/store';

export interface MediaSyncResult {
  synced: number;
  failed: number;
  pendingCount: number;
  pendingTotal: number;
  eligibleNow: number;
  waitingForBackoff: number;
  needsAttention: number;
  authPaused: number;
}

export function summarizePendingMedia(
  items: OfflineMediaItem[],
  synced = 0,
  failed = 0
): MediaSyncResult {
  const now = Date.now();
  const needsAttention = items.filter(i => i.requiresUserAction).length;
  const authPaused = items.filter(i => i.authPaused).length;
  const waitingForBackoff = items.filter(
    i => !i.requiresUserAction && !i.authPaused && i.nextEligibleAttemptAt && new Date(i.nextEligibleAttemptAt).getTime() > now
  ).length;
  const eligibleNow = items.filter(
    i => !i.requiresUserAction && !i.authPaused && (!i.nextEligibleAttemptAt || new Date(i.nextEligibleAttemptAt).getTime() <= now)
  ).length;

  return {
    synced,
    failed,
    pendingCount: items.length,
    pendingTotal: items.length,
    eligibleNow,
    waitingForBackoff,
    needsAttention,
    authPaused,
  };
}

export type MediaUploadFn = (
  blob: Blob,
  purpose: StoragePurpose,
  fileName: string,
  noteId?: string,
  customObjectId?: string,
  options?: { expectedUid?: string; signal?: AbortSignal }
) => Promise<{ objectId: string; url: string; idempotent?: boolean }>;

export class OfflineMediaSyncService {
  private isDraining = false;
  private currentUid: string | null = null;
  private activeSessionGeneration = 0;
  private activeAbortController: AbortController | null = null;
  private unsubscribeLeader: (() => void) | null = null;
  private unsubscribeMessages: (() => void) | null = null;
  private onlineListener: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCrossTabSyncs = new Map<string, (result: MediaSyncResult) => void>();
  private currentDrainPromise: Promise<MediaSyncResult> | null = null;

  constructor(
    private customUploadFn?: MediaUploadFn,
    private customCoordinator?: TabCoordinator
  ) {
    this.setupTriggers();
  }

  private setupTriggers() {
    // Trigger 1: Network reconnect offline -> online
    if (typeof window !== 'undefined') {
      this.onlineListener = () => {
        if (this.currentUid) {
          void this.drainPendingMedia(this.currentUid);
        }
      };
      window.addEventListener('online', this.onlineListener);
    }

    const coordinator = this.customCoordinator || getTabCoordinator();

    // Trigger 2: Tab becomes leader
    this.unsubscribeLeader = coordinator.onLeaderChange((isLeader: boolean) => {
      if (isLeader && this.currentUid && navigator.onLine) {
        void this.drainPendingMedia(this.currentUid);
      }
    });

    // Trigger 3: Cross-tab sync request / response handling
    this.unsubscribeMessages = coordinator.onMessage((msg: TabMessage) => {
      if (msg.type === 'SYNC_REQUESTED') {
        const syncId = (msg.payload?.syncId as string) || '';
        const reqUid = (msg.payload?.uid as string) || this.currentUid;
        if (coordinator.getIsLeader() && reqUid) {
          void this.drainPendingMedia(reqUid, { force: true }).then(result => {
            coordinator.broadcast({
              type: 'SYNC_COMPLETED',
              senderId: coordinator.tabId,
              timestamp: Date.now(),
              payload: { syncId, ...result },
            });
          });
        }
      } else if (msg.type === 'SYNC_COMPLETED') {
        const syncId = (msg.payload?.syncId as string) || '';
        const resolver = this.pendingCrossTabSyncs.get(syncId);
        if (resolver) {
          this.pendingCrossTabSyncs.delete(syncId);
          resolver({
            synced: Number(msg.payload?.synced || 0),
            failed: Number(msg.payload?.failed || 0),
            pendingCount: Number(msg.payload?.pendingCount ?? msg.payload?.pendingTotal ?? 0),
            pendingTotal: Number(msg.payload?.pendingTotal ?? msg.payload?.pendingCount ?? 0),
            eligibleNow: Number(msg.payload?.eligibleNow || 0),
            waitingForBackoff: Number(msg.payload?.waitingForBackoff || 0),
            needsAttention: Number(msg.payload?.needsAttention || 0),
            authPaused: Number(msg.payload?.authPaused || 0),
          });
        }
      }
    });
  }

  public getIsDraining(): boolean {
    return this.isDraining;
  }

  /**
   * Set the active authenticated UID. Triggers immediate bounded drain if online.
   * §21: Owns an AbortController for in-flight requests. On UID change, aborts old request.
   * §19: Resumes auth-paused items for the SAME UID. Never retries User A media under User B.
   */
  public setActiveUser(uid: string | null) {
    if (uid !== this.currentUid) {
      this.activeSessionGeneration++;
      if (this.activeAbortController) {
        try { this.activeAbortController.abort(); } catch {}
        this.activeAbortController = null;
      }
    }
    this.currentUid = uid;
    if (uid) {
      void resumeAuthPausedMediaForUser(uid);
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        void this.drainPendingMedia(uid);
      }
    }
  }

  /**
   * Drain pending offline media items for the specified UID.
   * §10: Web Locks exclusive drain — only one tab can hold the drain lock.
   * §11: Auth-session generation guard — stops drain on UID change mid-loop.
   * §15-§17: Options separate leader bypass from retry eligibility bypass.
   * §25: Enforces stable leadership for browsers without Web Locks.
   */
  public async drainPendingMedia(
    targetUid?: string,
    options: { force?: boolean; bypassEligibility?: boolean } = {}
  ): Promise<MediaSyncResult> {
    const uid = targetUid || this.currentUid;
    if (!uid) {
      return summarizePendingMedia([], 0, 0);
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const allPending = await getPendingMediaForUser(uid, false);
      return summarizePendingMedia(allPending, 0, 0);
    }

    if (this.currentDrainPromise) {
      return this.currentDrainPromise;
    }

    const coordinator = this.customCoordinator || getTabCoordinator();
    if (!options.force && !coordinator.getIsLeader()) {
      // Follower tab: do not drain concurrently
      const allPending = await getPendingMediaForUser(uid, false);
      return summarizePendingMedia(allPending, 0, 0);
    }

    // §10: Web Locks exclusive drain — only one tab at a time
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      try {
        const result = await navigator.locks.request(
          'ntk-note-media-drain',
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              if (this.currentDrainPromise) {
                return this.currentDrainPromise;
              }
              // Another tab holds the lock — return truthful observer result
              const allPending = await getPendingMediaForUser(uid, false);
              return summarizePendingMedia(allPending, 0, 0);
            }
            return this.executeDrain(uid, options);
          }
        );
        return result;
      } catch {
        // Web Locks failed — fall back to isDraining flag
        return this.executeDrain(uid, options);
      }
    }

    // Fallback: no Web Locks available. Enforce stable coordinator leadership (§25)
    if (!options.force && typeof coordinator.isStableLeader === 'function' && !coordinator.isStableLeader(400)) {
      await new Promise(r => setTimeout(r, 400));
      if (!coordinator.getIsLeader() || this.currentUid !== uid) {
        const allPending = await getPendingMediaForUser(uid, false);
        return summarizePendingMedia(allPending, 0, 0);
      }
    }

    return this.executeDrain(uid, options);
  }

  /**
   * Internal drain execution with isDraining guard, abort controller, and session generation check.
   */
  private async executeDrain(
    uid: string,
    options: { force?: boolean; bypassEligibility?: boolean } = {}
  ): Promise<MediaSyncResult> {
    if (this.currentDrainPromise) {
      return this.currentDrainPromise;
    }

    const drainTask = (async (): Promise<MediaSyncResult> => {
      this.isDraining = true;
      const capturedGeneration = this.activeSessionGeneration;
      this.activeAbortController = new AbortController();
      const abortSignal = this.activeAbortController.signal;

      try {
        const { synced, failed } = await syncPendingMediaForUser(
          uid,
          async (item: OfflineMediaItem) => {
            // §11: Auth-session generation guard — stop if UID changed mid-drain
            if (this.currentUid !== uid || this.activeSessionGeneration !== capturedGeneration) {
              throw new Error('Auth session changed during media drain. Stopping.');
            }

            // CRITICAL: Always supply item.remoteObjectId as customObjectId (argument 5)
            const uploader = this.customUploadFn || uploadStorageFile;
            const res = await uploader(
              item.blob,
              item.purpose,
              item.fileName,
              item.noteId,
              item.remoteObjectId,
              { expectedUid: uid, signal: abortSignal }
            );

            // §11 & §21: Verify generation/UID again AFTER upload resolves, BEFORE mutating store
            if (this.currentUid !== uid || this.activeSessionGeneration !== capturedGeneration) {
              // Upload succeeded but we can't safely update store — leave queue item for reconciliation
              throw new Error('Auth session changed after upload. Store mutation skipped.');
            }

            // Update note attachments in local store upon confirmed upload
            if (item.noteId) {
              const currentNote = useStore.getState().notes.find(n => n.id === item.noteId);
              if (currentNote) {
                if (item.purpose === 'voiceNotes' && currentNote.voiceNotes) {
                  const updated = currentNote.voiceNotes.map(vn =>
                    vn.id === item.id ? { ...vn, objectId: res.objectId, pendingUpload: false } : vn
                  );
                  useStore.getState().updateNote(item.noteId, { voiceNotes: updated });
                } else if (item.purpose === 'images' && currentNote.images) {
                  const updated = currentNote.images.map(img =>
                    img.id === item.id ? { ...img, objectId: res.objectId, pendingUpload: false } : img
                  );
                  useStore.getState().updateNote(item.noteId, { images: updated });
                } else if (item.purpose === 'attachments' && currentNote.attachments) {
                  const updated = currentNote.attachments.map(att =>
                    att.id === item.id ? { ...att, objectId: res.objectId, pendingUpload: false } : att
                  );
                  useStore.getState().updateNote(item.noteId, { attachments: updated });
                }
              }
            }

            return { objectId: res.objectId, url: res.url };
          },
          {
            leaderBypass: Boolean(options.force || (this.customCoordinator || getTabCoordinator()).getIsLeader()),
            bypassEligibility: options.bypassEligibility,
          }
        );

        // §34: scheduleNextBackoffRetry needs ALL pending items (not just eligible)
        // to find items with future nextEligibleAttemptAt
        const allPending = await getPendingMediaForUser(uid, false);
        this.scheduleNextBackoffRetry(uid, allPending);

        return summarizePendingMedia(allPending, synced, failed);
      } finally {
        this.isDraining = false;
        if (this.activeAbortController?.signal === abortSignal) {
          this.activeAbortController = null;
        }
        this.currentDrainPromise = null;
      }
    })();

    this.currentDrainPromise = drainTask;
    return drainTask;
  }

  /**
   * Follower tab triggers manual sync by requesting the leader to drain.
   * §38–§39: On timeout, return truthful pending count — do NOT force-drain on follower.
   */
  public async requestSyncFromLeader(uid: string): Promise<MediaSyncResult> {
    const coordinator = this.customCoordinator || getTabCoordinator();

    if (coordinator.getIsLeader() || (!this.customCoordinator && typeof window === 'undefined')) {
      return this.drainPendingMedia(uid, { force: true });
    }

    const syncId = `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    return new Promise<MediaSyncResult>(resolve => {
      const timeout = setTimeout(async () => {
        this.pendingCrossTabSyncs.delete(syncId);
        // §38: Do NOT force-drain on follower tab.
        // Return truthful pending count without violating single-active-drainer.
        try {
          const allPending = await getPendingMediaForUser(uid, false);
          resolve(summarizePendingMedia(allPending, 0, 0));
        } catch {
          resolve({
            synced: 0,
            failed: 0,
            pendingCount: -1,
            pendingTotal: -1,
            eligibleNow: 0,
            waitingForBackoff: 0,
            needsAttention: 0,
            authPaused: 0,
          });
        }
      }, 4000);

      this.pendingCrossTabSyncs.set(syncId, result => {
        clearTimeout(timeout);
        resolve(result);
      });

      coordinator.broadcast({
        type: 'SYNC_REQUESTED',
        senderId: coordinator.tabId,
        timestamp: Date.now(),
        payload: { syncId, uid },
      });
    });
  }

  private scheduleNextBackoffRetry(uid: string, items: OfflineMediaItem[]) {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const eligibleTimes = items
      .filter(item => !item.requiresUserAction && item.nextEligibleAttemptAt)
      .map(item => new Date(item.nextEligibleAttemptAt!).getTime())
      .filter(time => !isNaN(time));

    if (eligibleTimes.length === 0) return;

    const earliest = Math.min(...eligibleTimes);
    const delay = Math.max(1000, earliest - Date.now());

    if (delay < 300000) {
      this.retryTimer = setTimeout(() => {
        if (this.currentUid === uid && typeof navigator !== 'undefined' && navigator.onLine) {
          void this.drainPendingMedia(uid);
        }
      }, delay);
    }
  }

  public destroy() {
    if (this.onlineListener && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineListener);
    }
    if (this.unsubscribeLeader) this.unsubscribeLeader();
    if (this.unsubscribeMessages) this.unsubscribeMessages();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pendingCrossTabSyncs.clear();
  }
}

// Singleton global service
let activeMediaSyncService: OfflineMediaSyncService | null = null;

export function getOfflineMediaSyncService(): OfflineMediaSyncService {
  if (!activeMediaSyncService) {
    activeMediaSyncService = new OfflineMediaSyncService();
  }
  return activeMediaSyncService;
}
