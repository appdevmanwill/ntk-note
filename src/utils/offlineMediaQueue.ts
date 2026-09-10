/**
 * NTK Note — Durable IndexedDB Offline Media Queue
 *
 * Persists voice notes, photos, and file attachments safely into browser IndexedDB
 * so user recordings and files survive tab reloads, browser restarts, and device reboots.
 *
 * Strict Isolation: All queries are strictly scoped by Firebase UID namespace.
 * User A's offline media is never exposed or uploaded to User B's workspace.
 */

import type { StoragePurpose } from '@/types';
import { getTabCoordinator } from '@/utils/tabCoordinator';

export interface OfflineMediaItem {
  id: string; // e.g. 'local-voice-123', 'local-img-456'
  uid: string; // Firebase UID or 'guest'
  noteId?: string;
  purpose: StoragePurpose;
  blob: Blob;
  mimeType: string;
  fileName: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  uploadState: 'pending' | 'uploading' | 'failed' | 'uploaded';
  lastError?: string;
  lastErrorCode?: string;
  lastAttemptAt?: string;
  nextEligibleAttemptAt?: string;
  requiresUserAction?: boolean;
  remoteObjectId?: string;
  storagePaused?: boolean;
  authPaused?: boolean;
}

export function calculateNextBackoffMs(retryCount: number): number {
  // Bounded exponential backoff with jitter: 1s * 2^(retryCount - 1), max 60s, + 0-20% jitter
  const baseMs = Math.min(50000, 1000 * Math.pow(2, Math.max(0, retryCount - 1)));
  const jitter = baseMs * (Math.random() * 0.2);
  return Math.min(60000, Math.floor(baseMs + jitter));
}

const DB_NAME = 'ntk_offline_media_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_media';

let dbPromise: Promise<IDBDatabase> | null = null;
const blobUrlCache = new Map<string, string>();

function getIndexedDB(): IDBFactory | undefined {
  if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
  if (typeof globalThis !== 'undefined' && (globalThis as any).indexedDB) return (globalThis as any).indexedDB;
  return undefined;
}

function getIDBKeyRange(): typeof IDBKeyRange | undefined {
  if (typeof window !== 'undefined' && window.IDBKeyRange) return window.IDBKeyRange;
  if (typeof globalThis !== 'undefined' && (globalThis as any).IDBKeyRange) return (globalThis as any).IDBKeyRange;
  return undefined;
}

/**
 * Open or upgrade the dedicated offline media IndexedDB database.
 */
function openMediaDB(): Promise<IDBDatabase> {
  const idb = getIndexedDB();
  if (!idb) {
    return Promise.reject(new Error('IndexedDB is not available in this environment.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('by_uid', 'uid', { unique: false });
        store.createIndex('by_noteId', 'noteId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('Failed to open offline media DB.'));
    };
  });
  return dbPromise;
}

/**
 * Enqueue a media item for deferred offline-first upload.
 */
export async function enqueueOfflineMedia(
  item: Omit<OfflineMediaItem, 'createdAt' | 'retryCount' | 'uploadState'>
): Promise<OfflineMediaItem> {
  const fullItem: OfflineMediaItem = {
    ...item,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    uploadState: 'pending',
  };

  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(fullItem);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineMedia] Error enqueuing item:', err);
  }

  return fullItem;
}

/**
 * Retrieve a local Blob object URL for immediate offline playback/rendering.
 */
export async function getOfflineMediaBlobUrl(id: string, uid: string): Promise<string | null> {
  if (blobUrlCache.has(id)) {
    return blobUrlCache.get(id)!;
  }

  try {
    const db = await openMediaDB();
    return new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        const item = req.result as OfflineMediaItem | undefined;
        if (item && item.uid === uid && item.blob) {
          const url = URL.createObjectURL(item.blob);
          blobUrlCache.set(id, url);
          resolve(url);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Retrieve raw blob for an offline media item.
 */
export async function getOfflineMediaBlob(id: string, uid: string): Promise<Blob | null> {
  try {
    const db = await openMediaDB();
    return new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => {
        const item = req.result as OfflineMediaItem | undefined;
        if (item && item.uid === uid && item.blob) {
          resolve(item.blob);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Get all pending offline media items for a specific UID.
 * @param onlyEligible - If true, filters out items waiting on backoff timers, auth-paused, or requiring user action (default: false)
 */
export async function getPendingMediaForUser(uid: string, onlyEligible = false): Promise<OfflineMediaItem[]> {
  const keyRange = getIDBKeyRange();
  if (!keyRange) return [];
  try {
    const db = await openMediaDB();
    return new Promise<OfflineMediaItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_uid');
      const req = index.getAll(keyRange.only(uid));

      req.onsuccess = () => {
        const all = (req.result as OfflineMediaItem[]) || [];
        const pending = all.filter(item => {
          if (item.uploadState !== 'pending' && item.uploadState !== 'failed') return false;
          if (!onlyEligible) return true;
          if (item.requiresUserAction) return false;
          if (item.authPaused) return false;
          if (item.nextEligibleAttemptAt && new Date(item.nextEligibleAttemptAt).getTime() > Date.now()) {
            return false;
          }
          return true;
        });
        resolve(pending);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function getEligiblePendingMediaForUser(uid: string): Promise<OfflineMediaItem[]> {
  return getPendingMediaForUser(uid, true);
}

/**
 * Resume auth-paused media items when the SAME UID successfully re-authenticates (§19).
 * Never retries User A media under User B.
 */
export async function resumeAuthPausedMediaForUser(uid: string): Promise<number> {
  const keyRange = getIDBKeyRange();
  if (!keyRange) return 0;
  try {
    const db = await openMediaDB();
    return new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_uid');
      const req = index.getAll(keyRange.only(uid));

      req.onsuccess = () => {
        const items = (req.result as OfflineMediaItem[]) || [];
        let resumed = 0;
        for (const item of items) {
          if (item.uid === uid && item.authPaused) {
            item.authPaused = false;
            item.requiresUserAction = false;
            item.nextEligibleAttemptAt = new Date().toISOString();
            store.put(item);
            resumed++;
          }
        }
        resolve(resumed);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

export { getOfflineMediaBlob as resolveOfflineMediaBlob, markMediaFailed as incrementMediaRetry, getOfflineMediaBlobUrl as resolveOfflineMediaObjectUrl };

/**
 * Mark a media item as successfully uploaded and remove the local Blob.
 */
export async function markMediaUploaded(id: string, uid: string, _remoteObjectId?: string): Promise<void> {
  const cachedUrl = blobUrlCache.get(id);
  if (cachedUrl) {
    URL.revokeObjectURL(cachedUrl);
    blobUrlCache.delete(id);
  }

  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result as OfflineMediaItem | undefined;
        if (item && item.uid === uid) {
          store.delete(id);
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.warn('[OfflineMedia] Error marking uploaded:', err);
  }
}

/**
 * Mark a media item upload as failed with classified exponential backoff and error tracking.
 * §18: 507 STORAGE_GUARD_PAUSED does NOT burn retries or storm the worker. Sets 15m cooldown.
 * §19: 401 marks auth-paused until the SAME UID authenticates again.
 */
export async function markMediaFailed(
  id: string,
  uid: string,
  error: string,
  statusCode?: number,
  errorCode?: string
): Promise<void> {
  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result as OfflineMediaItem | undefined;
        if (item && item.uid === uid) {
          item.uploadState = 'failed';
          item.lastAttemptAt = new Date().toISOString();
          item.lastError = error.slice(0, 200);
          item.lastErrorCode = errorCode || (statusCode ? `HTTP_${statusCode}` : 'NETWORK_ERROR');

          if (statusCode === 507 || errorCode === 'STORAGE_GUARD_PAUSED') {
            // Storage Guard paused (§18): keep Blob safe, do NOT burn retries, do NOT storm worker
            item.storagePaused = true;
            item.requiresUserAction = false;
            // Cooldown of 15 minutes before any automatic retry
            item.nextEligibleAttemptAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          } else if (statusCode === 400 || statusCode === 403 || statusCode === 404 || errorCode === 'UNSUPPORTED_MEDIA') {
            // Permanent failure: do not burn endless loops, flag for user attention
            item.requiresUserAction = true;
            item.nextEligibleAttemptAt = undefined;
          } else if (statusCode === 401) {
            // Session expired (§19): pause until next active login / session refresh with the SAME UID
            item.authPaused = true;
            item.requiresUserAction = true;
            item.nextEligibleAttemptAt = undefined;
          } else {
            // Transient network or server error (e.g. 408, 429, 500, 502, 503, 504)
            item.retryCount = (item.retryCount || 0) + 1;
            const backoffMs = calculateNextBackoffMs(item.retryCount);
            item.nextEligibleAttemptAt = new Date(Date.now() + backoffMs).toISOString();
            item.requiresUserAction = item.retryCount >= 5;
          }
          store.put(item);
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.warn('[OfflineMedia] Error marking failed:', err);
  }
}

/**
 * Permanently delete an offline media item (e.g. user discarded or deleted the note).
 */
export async function removeOfflineMedia(id: string, uid: string): Promise<void> {
  const cachedUrl = blobUrlCache.get(id);
  if (cachedUrl) {
    URL.revokeObjectURL(cachedUrl);
    blobUrlCache.delete(id);
  }

  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);

      getReq.onsuccess = () => {
        const item = getReq.result as OfflineMediaItem | undefined;
        if (item && item.uid === uid) {
          store.delete(id);
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.warn('[OfflineMedia] Error removing offline media:', err);
  }
}

/**
 * Clean all offline media associated with a deleted note.
 */
export async function cleanNoteOfflineMedia(noteId: string, uid: string): Promise<void> {
  const keyRange = getIDBKeyRange();
  if (!keyRange) return;
  try {
    const db = await openMediaDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_noteId');
      const req = index.getAll(keyRange.only(noteId));

      req.onsuccess = () => {
        const items = (req.result as OfflineMediaItem[]) || [];
        for (const item of items) {
          if (item.uid === uid) {
            store.delete(item.id);
            const cached = blobUrlCache.get(item.id);
            if (cached) {
              URL.revokeObjectURL(cached);
              blobUrlCache.delete(item.id);
            }
          }
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineMedia] Error cleaning note media:', err);
  }
}

export interface MediaSyncOptions {
  leaderBypass?: boolean;
  bypassEligibility?: boolean;
}

/**
 * Process pending offline media uploads for the current user.
 * Coordinated across tabs: only active leader tab performs automatic draining.
 * §15-§17: Separates leader bypass from retry eligibility bypass.
 * Manual Sync Now may bypass leader checks, but it strictly processes eligibleNow items only!
 */
export async function syncPendingMediaForUser(
  uid: string,
  uploadHandler: (item: OfflineMediaItem) => Promise<{ objectId: string; url: string }>,
  options: MediaSyncOptions | boolean = false
): Promise<{ synced: number; failed: number }> {
  const opts: MediaSyncOptions = typeof options === 'boolean'
    ? { leaderBypass: options, bypassEligibility: false }
    : options;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { synced: 0, failed: 0 };
  }

  // Single Active Queue Drainer rule: only leader tab performs automatic drain
  if (!opts.leaderBypass && !getTabCoordinator().getIsLeader()) {
    return { synced: 0, failed: 0 };
  }

  // Strictly process eligibleNow only, unless explicitly instructed by a per-item retry action
  const pending = await getPendingMediaForUser(uid, !opts.bypassEligibility);
  if (pending.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    // Avoid infinite retry loop: skip items that failed more than 5 times
    if (item.retryCount >= 5) {
      continue;
    }

    try {
      const result = await uploadHandler(item);
      if (result && result.objectId) {
        await markMediaUploaded(item.id, uid, result.objectId);
        synced++;
      } else {
        await markMediaFailed(item.id, uid, 'Upload returned invalid objectId');
        failed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      const status = (err && typeof err === 'object' && 'status' in err && typeof (err as any).status === 'number') ? (err as any).status : undefined;
      const code = (err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'string') ? (err as any).code : undefined;
      await markMediaFailed(item.id, uid, msg, status, code);
      failed++;
    }
  }

  return { synced, failed };
}
