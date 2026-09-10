import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/utils/firebase';

/**
 * Cloud snapshot backups.
 *
 * Snapshots live in Firestore under `users/{uid}/backups/{backupId}` so a
 * backup is a single click with no file pickers or third-party popups, and it
 * follows the account across devices. The export payload can exceed the
 * 1 MiB Firestore document limit once inline images are included, so the JSON
 * string is split into ordered chunk documents in a `chunks` subcollection.
 */

export interface CloudBackupMeta {
  id: string;
  createdAt: string;
  noteCount: number;
  notebookCount: number;
  sizeBytes: number;
  chunkCount: number;
  trigger: 'manual' | 'reminder';
}

/** Characters of payload per chunk document — safely under the 1 MiB doc cap. */
const CHUNK_SIZE = 700_000;

/** Oldest snapshots beyond this count are pruned after each backup. */
export const MAX_CLOUD_BACKUPS = 10;

const backupsRoot = (uid: string) => collection(db, 'users', uid, 'backups');

const padChunkId = (index: number) => `chunk_${String(index).padStart(4, '0')}`;

const chunkPayload = (payload: string): string[] => {
  if (payload.length <= CHUNK_SIZE) return [payload];
  const chunks: string[] = [];
  for (let offset = 0; offset < payload.length; offset += CHUNK_SIZE) {
    chunks.push(payload.slice(offset, offset + CHUNK_SIZE));
  }
  return chunks;
};

interface ExportPayload {
  notes?: { id?: string; content?: string; checklist?: { text?: unknown }[] }[];
  notebooks?: unknown[];
}

export const summarizePayload = (payload: string) => {
  let parsed: ExportPayload = {};
  try {
    parsed = JSON.parse(payload) as ExportPayload;
  } catch {
    // Callers validate the payload again on restore; summary stays zeroed.
  }
  const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
  return {
    noteCount: notes.length,
    notebookCount: Array.isArray(parsed.notebooks) ? parsed.notebooks.length : 0,
    sizeBytes: new Blob([payload]).size,
  };
};

export const saveCloudBackup = async (
  uid: string,
  payload: string,
  trigger: CloudBackupMeta['trigger'] = 'manual'
): Promise<CloudBackupMeta> => {
  const backupId = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const chunks = chunkPayload(payload);
  const summary = summarizePayload(payload);
  const meta: CloudBackupMeta = {
    id: backupId,
    createdAt: new Date().toISOString(),
    noteCount: summary.noteCount,
    notebookCount: summary.notebookCount,
    sizeBytes: summary.sizeBytes,
    chunkCount: chunks.length,
    trigger,
  };

  const metaRef = doc(backupsRoot(uid), backupId);

  // Chunks first, meta last: a visible meta doc always has a complete payload.
  for (let i = 0; i < chunks.length; i += 400) {
    const batch = writeBatch(db);
    chunks.slice(i, i + 400).forEach((data, j) => {
      batch.set(doc(metaRef, 'chunks', padChunkId(i + j)), { index: i + j, data });
    });
    await batch.commit();
  }
  await setDoc(metaRef, meta);

  await pruneOldBackups(uid);
  return meta;
};

const pruneOldBackups = async (uid: string) => {
  const snapshot = await getDocs(query(backupsRoot(uid), orderBy('createdAt', 'desc'), limit(50)));
  const stale = snapshot.docs
    .map(d => ({ id: d.id, createdAt: d.data().createdAt as string | undefined }))
    .filter((entry): entry is { id: string; createdAt: string } => !!entry.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(MAX_CLOUD_BACKUPS);

  await Promise.all(stale.map(entry => removeCloudBackup(uid, entry.id)));
};

export const listCloudBackups = async (uid: string): Promise<CloudBackupMeta[]> => {
  const snapshot = await getDocs(query(backupsRoot(uid), orderBy('createdAt', 'desc'), limit(50)));
  return snapshot.docs.map(d => d.data() as CloudBackupMeta)
    .filter(meta => meta && meta.id && meta.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const loadCloudBackupPayload = async (uid: string, backupId: string): Promise<string> => {
  const chunksSnapshot = await getDocs(collection(backupsRoot(uid), backupId, 'chunks'));
  if (chunksSnapshot.empty) {
    throw new Error('Backup payload is missing or incomplete.');
  }
  return chunksSnapshot.docs
    .map(d => d.data() as { index: number; data: string })
    .sort((a, b) => a.index - b.index)
    .map(chunk => chunk.data)
    .join('');
};

export const removeCloudBackup = async (uid: string, backupId: string): Promise<void> => {
  const chunksSnapshot = await getDocs(collection(backupsRoot(uid), backupId, 'chunks'));
  for (let i = 0; i < chunksSnapshot.docs.length; i += 400) {
    const batch = writeBatch(db);
    chunksSnapshot.docs.slice(i, i + 400).forEach(chunkDoc => batch.delete(chunkDoc.ref));
    await batch.commit();
  }
  await deleteDoc(doc(backupsRoot(uid), backupId));
};

export const saveExternalStorageBackup = async (
  payload: string,
  retentionCount = 5,
): Promise<{ objectId: string; fileName: string; size: number }> => {
  const { uploadStorageFile, listStorageFiles, deleteStorageFile } = await import('@/utils/cloudStorage');
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `ntk-backup-${dateStr}.json`;
  const blob = new Blob([payload], { type: 'application/json' });
  const result = await uploadStorageFile(blob, 'backups', fileName);

  try {
    const list = await listStorageFiles('backups');
    if (list.length > retentionCount) {
      const sorted = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const excess = sorted.slice(retentionCount);
      for (const item of excess) {
        await deleteStorageFile('backups', item.id);
      }
    }
  } catch {
    // Non-critical pruning failure
  }

  return { objectId: result.objectId, fileName: result.fileName, size: result.size };
};
