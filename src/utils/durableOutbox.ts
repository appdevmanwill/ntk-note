/**
 * NTK Note v2.8 — Durable Outbox, IndexedDB Heavy State & Crash Journal
 *
 * Prevents localStorage quota exhaustion for large workspaces (1000+ notes)
 * by persisting heavy note arrays and pending sync operations into UID-scoped IndexedDB.
 * Maintains an emergency synchronous crash journal in localStorage for last-millisecond pagehide/beforeunload.
 *
 * v2.8 Reliability Closure:
 * - loadDurableRecord() returns metadata (updatedAt) for deterministic hydration choice.
 * - Two-phase crash journal: peekCrashJournal() reads WITHOUT deleting; acknowledgeCrashJournal() deletes AFTER durable persist.
 * - Migration tracking: markDurableMigrationComplete() / isDurableMigrationComplete().
 */

import type { Note, Notebook, SyncConflict, SyncQueueItem } from '@/types';

const DB_NAME = 'ntk_durable_outbox_db';
const DB_VERSION = 2;
const STORE_NOTES = 'durable_notes';
const STORE_QUEUE = 'durable_queue';
const STORE_META = 'durable_meta';

let dbPromise: Promise<IDBDatabase> | null = null;
let fallbackTabId: string | null = null;

/** sessionStorage survives reload, while each independently opened tab gets its own draft key. */
export function getDraftTabId(): string {
  try {
    const key = 'ntk:pending-draft-tab';
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = globalThis.crypto?.randomUUID?.() || `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    fallbackTabId ||= `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return fallbackTabId;
  }
}

export interface TabPendingDrafts {
  ownerUid: string;
  tabId: string;
  notes: Note[];
  notebooks: Notebook[];
  queue: SyncQueueItem[];
  conflicts: SyncConflict[];
}

/**
 * A tab's unsynced work must not share a last-writer-wins cache key with other
 * tabs. Keep only pending entities here; the existing user cache stays intact.
 * STORE_META already supports arbitrary string keys, so no schema migration or
 * destructive replacement of existing IndexedDB stores is needed.
 */
export async function persistTabPendingDrafts(uid: string, tabId: string, state: {
  notes: Note[]; notebooks: Notebook[]; syncQueue: SyncQueueItem[]; syncConflicts: SyncConflict[];
}): Promise<boolean> {
  if (!uid || !tabId) return false;
  try {
    const db = await openDurableDB();
    const noteIds = new Set(state.syncQueue.filter(q => (q.entityType || 'note') === 'note').map(q => q.noteId));
    state.syncConflicts.forEach(c => noteIds.add(c.noteId));
    const notebookIds = new Set(state.syncQueue.filter(q => q.entityType === 'notebook').map(q => q.noteId));
    const record: TabPendingDrafts & { uid: string; updatedAt: string } = {
      uid: `pending:${uid}:${tabId}`, ownerUid: uid, tabId,
      notes: state.notes.filter(n => noteIds.has(n.id)),
      notebooks: state.notebooks.filter(n => notebookIds.has(n.id)),
      queue: state.syncQueue, conflicts: state.syncConflicts, updatedAt: new Date().toISOString(),
    };
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Pending draft transaction aborted.'));
    });
  } catch (error) {
    console.warn('[DurableOutbox] Could not preserve this tab pending drafts:', error);
    return false;
  }
}

export async function loadTabPendingDrafts(uid: string, tabId: string): Promise<TabPendingDrafts | null> {
  if (!uid || !tabId) return null;
  try {
    const db = await openDurableDB();
    return await new Promise<TabPendingDrafts | null>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const request = tx.objectStore(STORE_META).get(`pending:${uid}:${tabId}`);
      request.onsuccess = () => {
        const record = request.result as TabPendingDrafts | undefined;
        resolve(record?.ownerUid === uid && record.tabId === tabId ? record : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

function getIndexedDB(): IDBFactory | undefined {
  if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
  if (typeof globalThis !== 'undefined' && (globalThis as any).indexedDB) return (globalThis as any).indexedDB;
  return undefined;
}

function openDurableDB(): Promise<IDBDatabase> {
  const idb = getIndexedDB();
  if (!idb) {
    return Promise.reject(new Error('IndexedDB is not available.'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        db.createObjectStore(STORE_NOTES, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'uid' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('Failed to open durable outbox DB.'));
    };
  });
  return dbPromise;
}

// ── Durable Record Types ──

export interface DurableNotesRecord {
  uid: string;
  notes: Note[];
  updatedAt: string;
}

export interface DurableQueueRecord {
  uid: string;
  queue: SyncQueueItem[];
  updatedAt: string;
}

export interface DurableRecord {
  notes: Note[] | null;
  notesUpdatedAt: string | null;
  queue: SyncQueueItem[] | null;
  queueUpdatedAt: string | null;
}

/**
 * Save heavy note array to durable UID-scoped IndexedDB storage.
 */
export async function persistDurableNotes(uid: string, notes: Note[]): Promise<boolean> {
  try {
    const db = await openDurableDB();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NOTES, 'readwrite');
      tx.objectStore(STORE_NOTES).put({ uid, notes, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[DurableOutbox] Failed to persist notes to IndexedDB:', err);
    return false;
  }
}

/**
 * Load notes from durable UID-scoped IndexedDB storage.
 */
export async function loadDurableNotes(uid: string): Promise<Note[] | null> {
  try {
    const db = await openDurableDB();
    return new Promise<Note[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NOTES, 'readonly');
      const req = tx.objectStore(STORE_NOTES).get(uid);
      req.onsuccess = () => {
        const result = req.result as DurableNotesRecord | undefined;
        resolve(result?.notes || null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Save pending sync queue to durable UID-scoped IndexedDB storage.
 */
export async function persistDurableSyncQueue(uid: string, queue: SyncQueueItem[]): Promise<boolean> {
  try {
    const db = await openDurableDB();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readwrite');
      tx.objectStore(STORE_QUEUE).put({ uid, queue, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[DurableOutbox] Failed to persist sync queue to IndexedDB:', err);
    return false;
  }
}

/**
 * Load pending sync queue from durable UID-scoped IndexedDB storage.
 */
export async function loadDurableSyncQueue(uid: string): Promise<SyncQueueItem[] | null> {
  try {
    const db = await openDurableDB();
    return new Promise<SyncQueueItem[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, 'readonly');
      const req = tx.objectStore(STORE_QUEUE).get(uid);
      req.onsuccess = () => {
        const result = req.result as DurableQueueRecord | undefined;
        resolve(result?.queue || null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/**
 * Load the full durable record for a UID including metadata timestamps.
 * Returns both notes and queue with their updatedAt for deterministic hydration choice.
 */
export async function loadDurableRecord(uid: string): Promise<DurableRecord> {
  const empty: DurableRecord = { notes: null, notesUpdatedAt: null, queue: null, queueUpdatedAt: null };
  try {
    const db = await openDurableDB();
    return new Promise<DurableRecord>((resolve, reject) => {
      const tx = db.transaction([STORE_NOTES, STORE_QUEUE], 'readonly');
      let notesResult: DurableNotesRecord | undefined;
      let queueResult: DurableQueueRecord | undefined;

      const notesReq = tx.objectStore(STORE_NOTES).get(uid);
      notesReq.onsuccess = () => { notesResult = notesReq.result as DurableNotesRecord | undefined; };

      const queueReq = tx.objectStore(STORE_QUEUE).get(uid);
      queueReq.onsuccess = () => { queueResult = queueReq.result as DurableQueueRecord | undefined; };

      tx.oncomplete = () => {
        resolve({
          notes: notesResult?.notes || null,
          notesUpdatedAt: notesResult?.updatedAt || null,
          queue: queueResult?.queue || null,
          queueUpdatedAt: queueResult?.updatedAt || null,
        });
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[DurableOutbox] Failed to load durable record:', err);
    return empty;
  }
}

/**
 * Mark that initial localStorage → IndexedDB migration has completed for a UID.
 */
export async function markDurableMigrationComplete(uid: string): Promise<boolean> {
  try {
    const db = await openDurableDB();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ uid, migrated: true, migratedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return false;
  }
}

/**
 * Check whether initial localStorage → IndexedDB migration has completed for a UID.
 */
export async function isDurableMigrationComplete(uid: string): Promise<boolean> {
  try {
    const db = await openDurableDB();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(uid);
      req.onsuccess = () => {
        const result = req.result as { uid: string; migrated: boolean } | undefined;
        resolve(result?.migrated === true);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return false;
  }
}

/**
 * Safe localStorage wrapper with QuotaExceededError recovery.
 * Never throws uncaught exceptions that would crash the editor or UI.
 */
export function saveJSONSafe(key: string, data: unknown): { ok: boolean; quotaExceeded?: boolean } {
  if (typeof localStorage === 'undefined') return { ok: false };
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return { ok: true };
  } catch (err: any) {
    const isQuota =
      err?.name === 'QuotaExceededError' ||
      err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err?.code === 22 ||
      err?.code === 1014;

    console.warn(`[Storage] localStorage write failed for key "${key}" (isQuota: ${isQuota}):`, err);
    return { ok: false, quotaExceeded: isQuota };
  }
}

// ── Synchronous Emergency Crash Journal ──

const JOURNAL_PREFIX = 'ntk:journal:';

export interface CrashJournalEntry {
  noteId: string;
  title: string;
  content: string;
  updatedAt: string;
  baseUpdatedAt?: string;
}

/**
 * Write a small synchronous active-draft journal entry to localStorage during pagehide/beforeunload.
 */
export function saveCrashJournal(uid: string, noteId: string, entry: Omit<CrashJournalEntry, 'noteId'>): void {
  if (typeof localStorage === 'undefined') return;
  const key = `${JOURNAL_PREFIX}${uid}:${noteId}`;
  try {
    localStorage.setItem(key, JSON.stringify({ ...entry, noteId }));
  } catch {
    // If even a single draft fails localStorage, ignore safely
  }
}

/**
 * Load a single active-draft crash journal entry.
 */
export function loadCrashJournal(uid: string, noteId: string): CrashJournalEntry | null {
  if (typeof localStorage === 'undefined') return null;
  const key = `${JOURNAL_PREFIX}${uid}:${noteId}`;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getMatchingStorageKeys(prefix: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  const keys: string[] = [];
  try {
    if (typeof localStorage.key === 'function' && typeof localStorage.length === 'number') {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
    }
  } catch {}
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(prefix) && !keys.includes(k)) keys.push(k);
    }
  } catch {}
  return keys;
}

/**
 * TWO-PHASE CRASH JOURNAL — Phase 1: Peek.
 * Read all crash journal entries for a UID WITHOUT deleting the localStorage keys.
 * Caller must apply recovery, persist durably, then call acknowledgeCrashJournal().
 */
export function peekCrashJournal(uid: string): CrashJournalEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const entries: CrashJournalEntry[] = [];
  const prefix = `${JOURNAL_PREFIX}${uid}:`;
  const keys = getMatchingStorageKeys(prefix);

  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw) as CrashJournalEntry;
        entries.push(parsed);
      }
    } catch {}
  }

  return entries;
}

/**
 * TWO-PHASE CRASH JOURNAL — Phase 2: Acknowledge.
 * Remove journal localStorage keys ONLY for the specified entries.
 * Call this only AFTER the recovered drafts have been durably persisted to IndexedDB.
 */
export function acknowledgeCrashJournal(uid: string, entries: CrashJournalEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  for (const entry of entries) {
    const key = `${JOURNAL_PREFIX}${uid}:${entry.noteId}`;
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}

/**
 * Legacy reconcileCrashJournal: reads AND deletes in one pass.
 * DEPRECATED — use peekCrashJournal() + acknowledgeCrashJournal() for safe two-phase recovery.
 * Kept for backward compatibility with existing call sites not yet migrated.
 */
export function reconcileCrashJournal(uid: string): CrashJournalEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const entries: CrashJournalEntry[] = [];
  const prefix = `${JOURNAL_PREFIX}${uid}:`;
  const keys = getMatchingStorageKeys(prefix);

  try {
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as CrashJournalEntry;
          entries.push(parsed);
        } catch {}
      }
      localStorage.removeItem(k);
    }
  } catch (err) {
    console.warn('[CrashJournal] Error reconciling journal:', err);
  }

  return entries;
}

/**
 * Clear all crash journal entries for a given UID.
 */
export function clearCrashJournal(uid: string): void {
  if (typeof localStorage === 'undefined') return;
  const prefix = `${JOURNAL_PREFIX}${uid}:`;
  const keys = getMatchingStorageKeys(prefix);
  for (const k of keys) {
    try { localStorage.removeItem(k); } catch {}
  }
}
