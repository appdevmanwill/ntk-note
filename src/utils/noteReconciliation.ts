/**
 * NTK Note v2.8 — Authoritative Remote Note Snapshot Reconciliation
 *
 * Implements authoritative remote snapshot merge:
 * 1. Remote absence is authoritative: Any local private note missing remotely
 *    is pruned UNLESS an explicit pending outbox queue item exists for it.
 * 2. Never implicitly resurrects remotely deleted notes.
 * 3. Compares remote.updatedAt to queued baseUpdatedAt to detect real concurrent edits.
 * 4. Preserves externally shared notes owned by others.
 */

import type { Note, SyncQueueItem, SyncConflict } from '@/types';

export interface ReconcileNotesResult {
  notes: Note[];
  syncConflicts: SyncConflict[];
  prunedCount: number;
}

const normalizeNewlines = (str?: string | null): string =>
  (str ?? '').replace(/\r\n/g, '\n');

export interface MeaningfulNoteSnapshot {
  title: string;
  content: string;
  type: string;
  color: string;
  theme: string | null;
  tags: string[];
  notebookId: string;
  sectionId: string | null;
  pinned: boolean;
  starred: boolean;
  archived: boolean;
  trashed: boolean;
  locked: boolean;
  encrypted: boolean;
  encryptedPayload: string | null;
  lockHint: string | null;
  priority: string | null;
  order: number;
  linkedNoteIds: string[];
  checklist: Array<{
    id: string;
    text: string;
    checked: boolean;
    order: number;
  }>;
  reminder: {
    id: string;
    time: string;
    title: string;
    triggered: boolean;
  } | null;
  images: Array<{
    id: string;
    objectId: string;
    name: string;
    size: number;
    mimeType: string;
    storageKey: string;
    caption: string;
    width: number | null;
    height: number | null;
  }>;
  photos: Array<{
    id: string;
    objectId: string;
    name: string;
    size: number;
    mimeType: string;
    storageKey: string;
    caption: string;
    width: number | null;
    height: number | null;
  }>;
  attachments: Array<{
    id: string;
    objectId: string;
    name: string;
    size: number;
    mimeType: string;
    storageKey: string;
    url: string;
  }>;
  voiceNotes: Array<{
    id: string;
    objectId: string;
    title: string;
    durationSeconds: number;
    size: number;
    mimeType: string;
    storageKey: string;
    source: string;
    transcript: string;
  }>;
}

export function buildMeaningfulNoteSnapshot(note: Note): MeaningfulNoteSnapshot {
  const images = (note.images || [])
    .map(img => ({
      id: img.id || '',
      objectId: img.objectId || '',
      name: img.name || '',
      size: typeof img.size === 'number' ? img.size : 0,
      mimeType: img.mimeType || '',
      storageKey: img.storageKey || '',
      caption: img.caption || '',
      width: typeof img.width === 'number' ? img.width : null,
      height: typeof img.height === 'number' ? img.height : null,
    }))
    .sort((a, b) => {
      const keyA = `${a.objectId}:${a.id}:${a.name}`;
      const keyB = `${b.objectId}:${b.id}:${b.name}`;
      return keyA.localeCompare(keyB);
    });

  const photos = (note.photos || [])
    .map(p => ({
      id: p.id || '',
      objectId: p.objectId || '',
      name: p.name || '',
      size: typeof p.size === 'number' ? p.size : 0,
      mimeType: p.mimeType || '',
      storageKey: p.storageKey || '',
      caption: p.caption || '',
      width: typeof p.width === 'number' ? p.width : null,
      height: typeof p.height === 'number' ? p.height : null,
    }))
    .sort((a, b) => {
      const keyA = `${a.objectId}:${a.id}:${a.name}`;
      const keyB = `${b.objectId}:${b.id}:${b.name}`;
      return keyA.localeCompare(keyB);
    });

  const attachments = (note.attachments || [])
    .map(att => ({
      id: att.id || '',
      objectId: att.objectId || '',
      name: att.name || '',
      size: typeof att.size === 'number' ? att.size : 0,
      mimeType: att.mimeType || '',
      storageKey: att.storageKey || '',
      url: att.url || '',
    }))
    .sort((a, b) => {
      const keyA = `${a.objectId}:${a.id}:${a.name}`;
      const keyB = `${b.objectId}:${b.id}:${b.name}`;
      return keyA.localeCompare(keyB);
    });

  const voiceNotes = (note.voiceNotes || [])
    .map(vn => ({
      id: vn.id || '',
      objectId: vn.objectId || '',
      title: vn.title || '',
      durationSeconds: typeof vn.durationSeconds === 'number' ? vn.durationSeconds : 0,
      size: typeof vn.size === 'number' ? vn.size : 0,
      mimeType: vn.mimeType || '',
      storageKey: vn.storageKey || '',
      source: vn.source || '',
      transcript: vn.transcript || '',
    }))
    .sort((a, b) => {
      const keyA = `${a.objectId}:${a.id}:${a.title}`;
      const keyB = `${b.objectId}:${b.id}:${b.title}`;
      return keyA.localeCompare(keyB);
    });

  const checklist = (note.checklist || []).filter(Boolean).map((item, idx) => ({
    id: item.id || '',
    text: normalizeNewlines(item.text),
    checked: Boolean(item.checked),
    order: typeof item.order === 'number' ? item.order : idx,
  }));

  const reminder = note.reminder
    ? {
        id: note.reminder.id || '',
        time: note.reminder.time || '',
        title: normalizeNewlines(note.reminder.title),
        triggered: Boolean(note.reminder.triggered),
      }
    : null;

  const tags = [...(note.tags || [])]
    .map(t => (t ?? '').trim().toLowerCase())
    .filter(Boolean)
    .sort();

  const linkedNoteIds = [...(note.linkedNoteIds || [])].slice().sort();

  return {
    title: normalizeNewlines(note.title),
    content: normalizeNewlines(note.content),
    type: note.type || 'note',
    color: note.color || 'default',
    theme: note.theme || null,
    tags,
    notebookId: note.notebookId || '',
    sectionId: note.sectionId || null,
    pinned: Boolean(note.pinned),
    starred: Boolean(note.starred),
    archived: Boolean(note.archived),
    trashed: Boolean(note.trashed),
    locked: Boolean(note.locked),
    encrypted: Boolean(note.encrypted),
    encryptedPayload: note.encryptedPayload || null,
    lockHint: note.lockHint || null,
    priority: note.priority || null,
    order: typeof note.order === 'number' ? note.order : 0,
    linkedNoteIds,
    checklist,
    reminder,
    images,
    photos,
    attachments,
    voiceNotes,
  };
}

export function hasMeaningfulNoteDifference(local: Note, remote?: Note | null): boolean {
  if (!remote) return true;
  const localSnapshot = buildMeaningfulNoteSnapshot(local);
  const remoteSnapshot = buildMeaningfulNoteSnapshot(remote);
  return JSON.stringify(localSnapshot) !== JSON.stringify(remoteSnapshot);
}

export function getConflictIdentity(conflict: SyncConflict): string {
  if (conflict.deletedRemotely) {
    return `del:${conflict.noteId}:${conflict.local.updatedAt}`;
  }
  return `conf:${conflict.noteId}:${conflict.local.updatedAt}:${conflict.remote?.updatedAt || 'none'}`;
}

export function reconcileRemoteNotesSnapshot(
  localNotes: Note[],
  remoteNotes: Note[],
  syncQueue: SyncQueueItem[],
  currentUid: string,
  existingConflicts: SyncConflict[] = [],
  sharedAuthority = false,
): ReconcileNotesResult {
  const pendingIds = new Set(
    syncQueue
      .filter(item => (item.entityType || 'note') === 'note')
      .map(item => item.noteId).concat(existingConflicts.map(c => c.noteId))
  );
  const remoteIds = new Set(remoteNotes.map(n => n.id));
  let conflicts = [...new Map(existingConflicts.map(c => [c.noteId, c])).values()];
  const externallyShared = sharedAuthority ? [] : localNotes.filter(n => n.isShared && n.ownerId !== currentUid);
  const localPrivate = sharedAuthority ? localNotes : localNotes.filter(n => !(n.isShared && n.ownerId !== currentUid));

  const mergedPrivate: Note[] = [...localPrivate];

  remoteNotes.forEach(remote => {
    const idx = mergedPrivate.findIndex(n => n.id === remote.id);
    if (idx >= 0) {
      const local = mergedPrivate[idx];
      // Acknowledged identical content needs no user choice. In particular,
      // discard a stale conflict raised by a pre-commit listener snapshot.
      if (!hasMeaningfulNoteDifference(local, remote)) {
        mergedPrivate[idx] = remote;
        conflicts = conflicts.filter(conflict => conflict.noteId !== remote.id);
        return;
      }
      const queuedItem = syncQueue.find(
        item => item.noteId === remote.id && (item.entityType || 'note') === 'note'
      );
      if (queuedItem) {
        const baseUpdatedAt = queuedItem.baseUpdatedAt;
        // A missing legacy baseline must fail closed when content differs.
        // New notes normally have no remote document to compare against.
        const remoteChangedFromBase = baseUpdatedAt
          ? remote.updatedAt !== baseUpdatedAt
          : hasMeaningfulNoteDifference(local, remote);

        if (remoteChangedFromBase && hasMeaningfulNoteDifference(local, remote)) {
          const existingIndex = conflicts.findIndex(c => c.noteId === remote.id);
          if (existingIndex >= 0) {
            // Keep the same pending decision even if the user continues editing.
            conflicts[existingIndex] = { ...conflicts[existingIndex], local, remote, deletedRemotely: false };
          } else {
            conflicts.push({
              id: `conflict_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              noteId: remote.id,
              local,
              remote,
              detectedAt: new Date().toISOString(),
            });
          }
        } else if (!remoteChangedFromBase) {
          // Remote unchanged since local started editing; keep local draft
        } else {
          mergedPrivate[idx] = remote;
        }
      } else {
        mergedPrivate[idx] = remote;
      }
    } else {
      mergedPrivate.push(remote);
    }
  });

  // Remote absence plus a recorded baseline requires an explicit deletion decision.
  localPrivate.forEach(local => {
    if (remoteIds.has(local.id)) return;
    const queued = syncQueue.find(q => q.noteId === local.id && (q.entityType || 'note') === 'note');
    if (queued?.operation !== 'upsert' || !queued.baseUpdatedAt) return;
    const index = conflicts.findIndex(c => c.noteId === local.id);
    const conflict: SyncConflict = {
      id: index >= 0 ? conflicts[index].id : `deleted_${local.id}`,
      noteId: local.id, local, deletedRemotely: true,
      detectedAt: index >= 0 ? conflicts[index].detectedAt : new Date().toISOString(),
    };
    if (index >= 0) conflicts[index] = conflict;
    else conflicts.push(conflict);
  });

  // Authoritative remote absence: Prune any local private note not present remotely
  // UNLESS it has an explicit pending create/upsert in the syncQueue.
  const beforeCount = mergedPrivate.length;
  const privateWithPending = mergedPrivate.filter(
    note => remoteIds.has(note.id) || pendingIds.has(note.id)
  );
  const prunedCount = beforeCount - privateWithPending.length;

  const combined = new Map<string, Note>();
  privateWithPending.forEach(note => combined.set(note.id, note));
  externallyShared.forEach(note => combined.set(note.id, note));

  return {
    notes: [...combined.values()],
    syncConflicts: conflicts,
    prunedCount,
  };
}
