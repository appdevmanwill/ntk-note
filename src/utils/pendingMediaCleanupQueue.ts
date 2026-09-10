/**
 * NTK Note — Durable Pending Media Cleanup Queue
 *
 * Records media objects that failed physical deletion during permanent note deletion.
 * Scoped strictly by user UID.
 * Persists retry count, error codes, and backoff eligibility across app restarts.
 * Does NOT store note content and NEVER resurrects deleted notes.
 */

import type { StoragePurpose } from '@/types';
import {
  deleteStorageFileDetailed,
  recordServerPendingMediaCleanup,
  fetchServerPendingMediaCleanups,
  dismissServerPendingMediaCleanup,
} from '@/utils/cloudStorage';

export interface PendingMediaCleanup {
  id: string; // `${uid}:${purpose}:${objectId}`
  uid: string;
  purpose: StoragePurpose;
  objectId: string;
  noteId?: string;
  queuedAt: string;
  retryCount: number;
  lastAttemptAt?: string;
  lastErrorCode?: string;
  nextEligibleAttemptAt?: string;
}

const QUEUE_STORAGE_KEY = 'ntk_pending_media_cleanup_queue';
const MAX_BATCH_SIZE = 10;

export function calculateNextEligibleAttempt(retryCount: number): string {
  // attempt 0 / 1: next normal opportunity (0s delay)
  // attempt 2: >= 1 minute (60s)
  // attempt 3: >= 5 minutes (300s)
  // later: bounded exponential ceiling of 1 hour (3600s)
  let delayMs = 0;
  if (retryCount <= 1) {
    delayMs = 0;
  } else if (retryCount === 2) {
    delayMs = 60 * 1000;
  } else if (retryCount === 3) {
    delayMs = 5 * 60 * 1000;
  } else {
    delayMs = Math.min(3600 * 1000, 5 * 60 * 1000 * Math.pow(2, retryCount - 3));
  }
  return new Date(Date.now() + delayMs).toISOString();
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function getLocalQueue(): PendingMediaCleanup[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(QUEUE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalQueue(queue: PendingMediaCleanup[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-200)));
  } catch {
    // Ignore quota or storage errors
  }
}

export function enqueuePendingMediaCleanup(item: {
  uid: string;
  purpose: StoragePurpose;
  objectId: string;
  noteId?: string;
}): void {
  if (!item.uid) return;
  const queue = getLocalQueue();
  const id = `${item.uid}:${item.purpose}:${item.objectId}`;
  if (!queue.some(q => q.id === id)) {
    queue.push({
      id,
      uid: item.uid,
      purpose: item.purpose,
      objectId: item.objectId,
      noteId: item.noteId,
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    });
    saveLocalQueue(queue);
  }

  // Asynchronously register in server-side KV fallback marker if online
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    recordServerPendingMediaCleanup(item.purpose, item.objectId, { retryCount: 0 }).catch(() => {
      // non-fatal server fallback registration failure
    });
  }
}

export function getPendingMediaCleanups(uid: string): PendingMediaCleanup[] {
  if (!uid) return [];
  return getLocalQueue().filter(item => item.uid === uid);
}

export function removePendingMediaCleanup(id: string): void {
  const queue = getLocalQueue().filter(item => item.id !== id);
  saveLocalQueue(queue);
}

export function getDismissedMarkers(uid: string): Set<string> {
  const storage = getStorage();
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(`ntk_dismissed_markers_${uid}`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function recordDismissedMarker(uid: string, id: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const set = getDismissedMarkers(uid);
    set.add(id);
    storage.setItem(`ntk_dismissed_markers_${uid}`, JSON.stringify(Array.from(set).slice(-200)));
  } catch {}
}

/**
 * Retries pending media cleanups for the specific authenticated user.
 * - Strictly UID-scoped: User A never processes User B's entries.
 * - Bounded batch: at most 10 eligible items per invocation.
 * - Adheres to backoff schedule: skips items whose nextEligibleAttemptAt is in the future.
 * - Persists updated retryCount, lastAttemptAt, lastErrorCode, and nextEligibleAttemptAt on failure.
 * - Pulls server-side markers for cross-device durability and merges retry count conservatively.
 * - Enforces terminal failure policy: 400 (invalid) and 403 (forbidden) stop retrying.
 * - Purges both local queue item AND server KV marker on terminal error or success.
 */
export async function retryPendingMediaCleanups(uid: string): Promise<number> {
  if (!uid) return 0;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;

  // 1. Synchronize server-side markers if available
  try {
    const serverItems = await fetchServerPendingMediaCleanups();
    if (serverItems.length > 0) {
      const currentQueue = getLocalQueue();
      const dismissedMarkers = getDismissedMarkers(uid);
      let queueChanged = false;
      for (const sItem of serverItems) {
        const id = `${uid}:${sItem.purpose}:${sItem.objectId}`;
        if (dismissedMarkers.has(id)) {
          // Previously dismissed as terminal: ensure dismissed on server as well and do NOT resurrect!
          dismissServerPendingMediaCleanup(sItem.purpose, sItem.objectId).catch(() => {});
          continue;
        }

        const existing = currentQueue.find(q => q.id === id);
        if (existing) {
          // Conservative cross-device merge: never reset higher retryCount down to 0
          const serverRetries = sItem.retryCount || 0;
          if (serverRetries > existing.retryCount) {
            existing.retryCount = serverRetries;
            existing.lastAttemptAt = sItem.lastAttemptAt || existing.lastAttemptAt;
            existing.nextEligibleAttemptAt = sItem.nextEligibleAttemptAt || existing.nextEligibleAttemptAt;
            queueChanged = true;
          }
        } else {
          currentQueue.push({
            id,
            uid,
            purpose: sItem.purpose,
            objectId: sItem.objectId,
            queuedAt: sItem.queuedAt || new Date().toISOString(),
            retryCount: sItem.retryCount || 0,
            lastAttemptAt: sItem.lastAttemptAt || undefined,
            nextEligibleAttemptAt: sItem.nextEligibleAttemptAt || undefined,
          });
          queueChanged = true;
        }
      }
      if (queueChanged) {
        saveLocalQueue(currentQueue);
      }
    }
  } catch {
    // Non-fatal if server marker sync fails
  }

  const queue = getLocalQueue();
  const nowMs = Date.now();

  // 2. Select eligible items for this UID up to bounded batch size (10)
  const eligibleItems = queue.filter(item => {
    if (item.uid !== uid) return false;
    if (item.nextEligibleAttemptAt && new Date(item.nextEligibleAttemptAt).getTime() > nowMs) {
      return false;
    }
    return true;
  }).slice(0, MAX_BATCH_SIZE);

  if (eligibleItems.length === 0) return 0;

  let cleaned = 0;
  let queueModified = false;

  for (const item of eligibleItems) {
    try {
      // 1 immediate attempt during scheduled retry cycle
      const result = await deleteStorageFileDetailed(item.purpose, item.objectId, 0);
      if (result.ok) {
        // Success or 404 (already clean): Remove from local queue & purge server marker
        const idx = queue.findIndex(q => q.id === item.id);
        if (idx !== -1) {
          queue.splice(idx, 1);
          queueModified = true;
        }
        dismissServerPendingMediaCleanup(item.purpose, item.objectId).catch(() => {});
        cleaned++;
      } else if (result.isTerminal) {
        // Section 26: Terminal failure policy (400 invalid marker or 403 access denied)
        // Stop retrying and remove from queue to avoid burning Worker requests forever
        console.warn(`Terminal media cleanup failure for ${item.purpose}:${item.objectId} (status ${result.status}). Removing from queue and dismissing server marker.`);
        const idx = queue.findIndex(q => q.id === item.id);
        if (idx !== -1) {
          queue.splice(idx, 1);
          queueModified = true;
        }
        recordDismissedMarker(uid, item.id);
        dismissServerPendingMediaCleanup(item.purpose, item.objectId).catch(() => {});
      } else if (result.retryNotReady) {
        // Sections 27, 28, 29: Server-authoritative backoff active.
        // DO NOT increment retryCount, DO NOT post new server marker, adopt server schedule.
        if (result.nextEligibleAttemptAt) {
          item.nextEligibleAttemptAt = result.nextEligibleAttemptAt;
        }
        item.lastAttemptAt = new Date().toISOString();
        item.lastErrorCode = 'RETRY_NOT_READY';
        queueModified = true;
      } else {
        // Transient failure (500/503/network): Apply exponential backoff
        item.retryCount += 1;
        item.lastAttemptAt = new Date().toISOString();
        item.lastErrorCode = 'STORAGE_DELETE_FAILED';
        item.nextEligibleAttemptAt = calculateNextEligibleAttempt(item.retryCount);
        queueModified = true;

        // Propagate updated retry backoff to server marker
        recordServerPendingMediaCleanup(item.purpose, item.objectId, {
          retryCount: item.retryCount,
          lastAttemptAt: item.lastAttemptAt,
          nextEligibleAttemptAt: item.nextEligibleAttemptAt,
        }).catch(() => {});
      }
    } catch (err: any) {
      item.retryCount += 1;
      item.lastAttemptAt = new Date().toISOString();
      item.lastErrorCode = err?.code || err?.message || 'ERROR';
      item.nextEligibleAttemptAt = calculateNextEligibleAttempt(item.retryCount);
      queueModified = true;

      recordServerPendingMediaCleanup(item.purpose, item.objectId, {
        retryCount: item.retryCount,
        lastAttemptAt: item.lastAttemptAt,
        nextEligibleAttemptAt: item.nextEligibleAttemptAt,
      }).catch(() => {});
    }
  }

  // 3. Crucial: Persist updated retry counts and backoff state to storage
  if (queueModified) {
    saveLocalQueue(queue);
  }

  return cleaned;
}
