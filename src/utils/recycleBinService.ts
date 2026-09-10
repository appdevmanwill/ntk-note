import { db } from '@/utils/firebase';
import { doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import type { Note, Notebook, AppReminder, StoragePurpose } from '@/types';
import {
  deleteStorageFile,
  getServerPendingReminderCleanups,
  queueServerPendingReminderCleanups,
  deleteServerPendingReminderCleanups,
} from '@/utils/cloudStorage';
import { enqueuePendingMediaCleanup } from '@/utils/pendingMediaCleanupQueue';

export interface MediaCandidate {
  purpose: StoragePurpose;
  objectId: string;
  noteId: string;
  fileName?: string;
}

export interface DeletionPlan {
  notesToDelete: Note[];
  notebooksToDelete: Notebook[];
  activeNotesToReparent: Note[];
  survivingNotesToReparent: Note[];
  childNotebooksToReparent: Notebook[];
  ownedSharedNotesToRemove: Note[];
  collaboratorReferencesToRemove: Note[];
  mediaCandidates: MediaCandidate[];
  remindersToClean: AppReminder[];
  allNotes?: Note[];
  allNotebooks?: Notebook[];
}

export interface DeletionProgress {
  phase: 'preparing' | 'checking' | 'reparenting' | 'deleting-remote' | 'cleaning-reminders' | 'cleaning-media' | 'committing-local';
  totalItems: number;
  completedItems: number;
  currentLabel: string;
}

export interface DeletionResult {
  ok: boolean;
  deletedNoteIds: string[];
  deletedNotebookIds: string[];
  deletedReminderIds: string[];
  failedReminderIds: string[];
  reparentedNoteIds: string[];
  reparentedNotebookIds: string[];
  restoredElsewhereCount: number;
  staleSkippedNoteIds: string[];
  staleSkippedNotebookIds: string[];
  failedNoteIds: string[];
  failedNotebookIds: string[];
  cleanedMediaCount: number;
  pendingMediaCleanupCount: number;
  summaryMessage: string;
}

/**
 * Extracts candidate Cloudflare R2 media references from a note.
 * Combines note.images and note.photos, deduplicating with `${purpose}:${objectId}`.
 */
export function extractMediaCandidates(note: Note): MediaCandidate[] {
  const candidates: MediaCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (purpose: StoragePurpose, objectId: string, fileName?: string) => {
    if (!objectId) return;
    const key = `${purpose}:${objectId}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({
        purpose,
        objectId,
        noteId: note.id,
        fileName,
      });
    }
  };

  // Attachments
  if (Array.isArray(note.attachments)) {
    for (const att of note.attachments) {
      if (att && att.objectId) {
        addCandidate('attachments', att.objectId, att.name);
      }
    }
  }

  // Combined Images and Photos
  const allImages = [
    ...(Array.isArray(note.images) ? note.images : []),
    ...(Array.isArray(note.photos) ? note.photos : []),
  ];
  for (const img of allImages) {
    if (img && img.objectId) {
      addCandidate('images', img.objectId, (img as any).name);
    }
  }

  // Voice Notes
  if (Array.isArray(note.voiceNotes)) {
    for (const vn of note.voiceNotes) {
      if (vn && vn.objectId) {
        addCandidate('voiceNotes', vn.objectId, vn.title);
      }
    }
  }

  // Content-embedded storage file URLs: /v1/storage/file/{purpose}/{objectId}
  if (typeof note.content === 'string') {
    const regex = /\/v1\/storage\/file\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(note.content)) !== null) {
      const purpose = match[1] as StoragePurpose;
      const objectId = match[2];
      addCandidate(purpose, objectId);
    }
  }

  return candidates;
}

/**
 * Checks if a candidate media object is reused by any remaining note.
 * Must check ALL remaining notes (active AND trashed), excluding only
 * notes that are themselves currently being permanently deleted.
 * 
 * Crucial Section 28 & 30: Purpose-safe media identity.
 * Evaluates reuse strictly within matching storage purpose / category.
 * Do not allow attachments:obj_123 to collide with images:obj_123.
 */
export function isMediaReused(
  purposeOrObjectId: StoragePurpose | string,
  objectIdOrCandidateId: string,
  candidateNoteIdOrAllNotes: string | Note[],
  allNotesOrDeletedIds?: Note[] | Set<string>,
  notesBeingDeletedIds?: Set<string>
): boolean {
  let purpose: StoragePurpose | 'any';
  let objectId: string;
  let candidateNoteId: string;
  let allNotes: Note[];
  let notesBeingDeleted: Set<string>;

  if (typeof candidateNoteIdOrAllNotes !== 'string') {
    // 4-argument call: (objectId, candidateNoteId, allNotes, notesBeingDeletedIds?)
    purpose = 'any';
    objectId = purposeOrObjectId;
    candidateNoteId = objectIdOrCandidateId;
    allNotes = candidateNoteIdOrAllNotes;
    notesBeingDeleted = (allNotesOrDeletedIds as Set<string>) || new Set();
  } else {
    // 5-argument purpose-safe call: (purpose, objectId, candidateNoteId, allNotes, notesBeingDeletedIds?)
    purpose = purposeOrObjectId as StoragePurpose;
    objectId = objectIdOrCandidateId;
    candidateNoteId = candidateNoteIdOrAllNotes;
    allNotes = (allNotesOrDeletedIds as Note[]) || [];
    notesBeingDeleted = notesBeingDeletedIds || new Set();
  }

  for (const otherNote of allNotes) {
    if (otherNote.id === candidateNoteId || notesBeingDeleted.has(otherNote.id)) {
      continue;
    }
    if (purpose === 'attachments' || purpose === 'any') {
      if (otherNote.attachments?.some(att => att.objectId === objectId)) return true;
    }
    if (purpose === 'images' || purpose === 'any') {
      if (
        otherNote.images?.some(img => img.objectId === objectId) ||
        otherNote.photos?.some(p => p.objectId === objectId)
      ) return true;
    }
    if (purpose === 'voiceNotes' || purpose === 'any') {
      if (otherNote.voiceNotes?.some(vn => vn.objectId === objectId)) return true;
    }
    if (typeof otherNote.content === 'string') {
      if (purpose === 'any') {
        if (otherNote.content.includes(objectId)) return true;
      } else {
        if (otherNote.content.includes(`/v1/storage/file/${purpose}/${objectId}`)) return true;
      }
    }
  }
  return false;
}

/**
 * Traverses descendant notebook IDs.
 */
export function getNotebookTreeIds(notebookId: string, allNotebooks: Notebook[]): Set<string> {
  const ids = new Set([notebookId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const nb of allNotebooks) {
      if (nb.parentId && ids.has(nb.parentId) && !ids.has(nb.id)) {
        ids.add(nb.id);
        changed = true;
      }
    }
  }
  return ids;
}

/**
 * Builds an explicit, pre-calculated permanent deletion plan with dependency safety.
 */
export function buildDeletionPlan(params: {
  allNotes: Note[];
  allNotebooks: Notebook[];
  allReminders?: AppReminder[];
  targetNoteIds?: string[];
  targetNotebookIds?: string[];
  currentUserId?: string | null;
}): DeletionPlan {
  const {
    allNotes,
    allNotebooks,
    allReminders = [],
    targetNoteIds,
    targetNotebookIds,
    currentUserId,
  } = params;

  // Determine notebook targets
  const notebookIdsToDelete = new Set<string>();
  if (targetNotebookIds && targetNotebookIds.length > 0) {
    if (targetNoteIds && targetNoteIds.length > 0) {
      // Retention cleanup or explicit subset: delete only the targeted notebooks that are trashed
      for (const id of targetNotebookIds) {
        const nb = allNotebooks.find(n => n.id === id);
        if (nb && nb.trashed) notebookIdsToDelete.add(id);
      }
    } else {
      // Direct notebook permanent delete: include targeted notebook + any trashed descendants
      for (const id of targetNotebookIds) {
        const tree = getNotebookTreeIds(id, allNotebooks);
        for (const treeId of tree) {
          const nb = allNotebooks.find(n => n.id === treeId);
          if (nb && nb.trashed) notebookIdsToDelete.add(treeId);
        }
      }
    }
  } else if (!targetNoteIds && !targetNotebookIds) {
    // Empty Recycle Bin: include all trashed notebooks
    for (const nb of allNotebooks) {
      if (nb.trashed) notebookIdsToDelete.add(nb.id);
    }
  }

  const notebooksToDelete = allNotebooks.filter(nb => notebookIdsToDelete.has(nb.id));

  // Determine note targets
  const noteIdsToDelete = new Set<string>();
  if (targetNoteIds && targetNoteIds.length > 0) {
    for (const id of targetNoteIds) noteIdsToDelete.add(id);
  } else if (!targetNoteIds && targetNotebookIds && targetNotebookIds.length > 0) {
    // Notebook permanent delete: only notes inside notebook that are ALSO trashed
    for (const note of allNotes) {
      if (notebookIdsToDelete.has(note.notebookId) && note.trashed) {
        noteIdsToDelete.add(note.id);
      }
    }
  } else {
    // Empty Recycle Bin: all trashed notes
    for (const note of allNotes) {
      if (note.trashed) noteIdsToDelete.add(note.id);
    }
  }

  const notesToDelete = allNotes.filter(note => noteIdsToDelete.has(note.id));

  // Surviving notes inside trashed notebooks that MUST be preserved and reparented:
  // Includes active notes AND younger trashed notes that are not being deleted
  const survivingNotesToReparent = allNotes.filter(
    note => notebookIdsToDelete.has(note.notebookId) && !noteIdsToDelete.has(note.id)
  );
  const activeNotesToReparent = survivingNotesToReparent.filter(note => !note.trashed);

  // Surviving child notebooks whose parent is being deleted
  const childNotebooksToReparent = allNotebooks.filter(
    nb => nb.parentId && notebookIdsToDelete.has(nb.parentId) && !notebookIdsToDelete.has(nb.id)
  );

  // Owned shared notes vs collaborator references
  const ownedSharedNotesToRemove: Note[] = [];
  const collaboratorReferencesToRemove: Note[] = [];

  for (const note of notesToDelete) {
    if (note.isShared) {
      if (currentUserId && note.ownerId === currentUserId) {
        ownedSharedNotesToRemove.push(note);
      } else {
        collaboratorReferencesToRemove.push(note);
      }
    }
  }

  // Media candidates exclusively owned by notes to delete
  const mediaCandidates: MediaCandidate[] = [];
  // Section 29: Use `${candidate.purpose}:${candidate.objectId}` for seenMedia deduplication
  const seenMedia = new Set<string>();

  for (const note of notesToDelete) {
    // Only delete media if current user owns the note (collaborators cannot delete owner's media)
    const isOwner = !note.isShared || (currentUserId && note.ownerId === currentUserId);
    if (!isOwner) continue;

    const items = extractMediaCandidates(note);
    for (const candidate of items) {
      const mediaKey = `${candidate.purpose}:${candidate.objectId}`;
      if (!seenMedia.has(mediaKey)) {
        seenMedia.add(mediaKey);
        // Section 30: Pass purpose into isMediaReused
        if (!isMediaReused(candidate.purpose, candidate.objectId, note.id, allNotes, noteIdsToDelete)) {
          mediaCandidates.push(candidate);
        }
      }
    }
  }

  // Linked reminders
  const remindersToClean = allReminders.filter(
    r => r.noteId && noteIdsToDelete.has(r.noteId)
  );

  return {
    notesToDelete,
    notebooksToDelete,
    activeNotesToReparent,
    survivingNotesToReparent,
    childNotebooksToReparent,
    ownedSharedNotesToRemove,
    collaboratorReferencesToRemove,
    mediaCandidates,
    remindersToClean,
    allNotes,
    allNotebooks,
  };
}

/**
 * Executes irreversible permanent deletion safely:
 * - Checks online connectivity
 * - Verifies authoritative Firestore state for each note & notebook (protects items restored elsewhere)
 * - Recomputes dependencies based strictly on verified deletions
 * - Protects stale-restored notebooks (0 reparenting of children)
 * - Reparents surviving notes in trashed notebooks to 'default' using serverTimestamp() before parent delete
 * - Reparents surviving child notebooks to root using serverTimestamp(); blocks parent delete on failure
 * - Prevents parent notebook deletion if any child note verification fails
 * - Deletes documents in bounded Firestore batches (<= 25 items)
 * - Cleans up linked reminders ONLY for successfully deleted notes; failure is isolated
 * - Deletes exclusive media from Cloudflare R2 with immediate retries, queueing failures for durable retry
 * - Never deletes local state unless remote deletion has succeeded
 */
export const PENDING_REMINDERS_KEY = 'ntk_pending_reminder_cleanups';

export function queuePendingReminderCleanups(uid: string, reminderIds: string[]): void {
  if (!uid || !reminderIds || reminderIds.length === 0) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const storageKey = `${PENDING_REMINDERS_KEY}_${uid}`;
    const raw = localStorage.getItem(storageKey);
    const existing: string[] = raw ? JSON.parse(raw) : [];
    const merged = Array.from(new Set([...existing, ...reminderIds])).slice(0, 100);
    localStorage.setItem(storageKey, JSON.stringify(merged));
  } catch {
    // Ignore storage quota errors
  }
}

export function getPendingReminderCleanups(uid: string): string[] {
  if (!uid) return [];
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(`${PENDING_REMINDERS_KEY}_${uid}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearPendingReminderCleanups(uid: string, reminderIds: string[]): void {
  if (!uid || !reminderIds || reminderIds.length === 0) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const storageKey = `${PENDING_REMINDERS_KEY}_${uid}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const existing: string[] = JSON.parse(raw);
    const toRemove = new Set(reminderIds);
    const updated = existing.filter(id => !toRemove.has(id));
    if (updated.length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Retries pending reminder cleanups for the specific authenticated user.
 * - Current authenticated UID only;
 * - Online only (navigator.onLine);
 * - Bounded chunk: at most 25 reminder deletes per retry event;
 * - Cross-device durability: syncs with server pending reminder queue;
 * - Firestore write batches safely below platform maximum;
 * - Successful IDs removed from both local and server queue; failed IDs remain;
 * - Does NOT recreate notes or touch unrelated reminders.
 */
export async function retryPendingReminderCleanups(uid: string): Promise<number> {
  if (!uid) return 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;

  // 1. Fetch server pending reminders for cross-device durability (Section 23, 25)
  try {
    const serverIds = await getServerPendingReminderCleanups();
    if (serverIds && serverIds.length > 0) {
      queuePendingReminderCleanups(uid, serverIds);
    }
  } catch {
    // Non-blocking: proceed with local items if server fetch fails
  }

  const pendingIds = getPendingReminderCleanups(uid);
  if (!pendingIds || pendingIds.length === 0) return 0;

  const MAX_REMINDER_BATCH = 25;
  const chunk = pendingIds.slice(0, MAX_REMINDER_BATCH);

  const batch = writeBatch(db);
  for (const reminderId of chunk) {
    batch.delete(doc(db, `users/${uid}/reminders/${reminderId}`));
  }

  try {
    await batch.commit();
    clearPendingReminderCleanups(uid, chunk);
    // 2. Remove successful IDs from server queue as well (Section 23)
    deleteServerPendingReminderCleanups(chunk).catch(() => undefined);
    return chunk.length;
  } catch (error) {
    console.warn('Failed to retry pending reminder cleanups batch:', error);
    return 0;
  }
}

/**
 * Executes irreversible permanent deletion safely:
 * - PHASE A: Authoritative multi-device state verification for notes and notebooks.
 * - PHASE B: Required reparenting of surviving child notebooks and notes.
 * - PHASE C: Deletion of NOTES and canonical shared-note records in bounded batches (<= 25 items).
 * - PHASE D: Record verified successful/failed note IDs.
 * - PHASE E: Re-evaluate notebook dependencies using REAL note deletion results.
 * - PHASE F: Deletion of only safe NOTEBOOKS in bounded batches (<= 25 items).
 * - PHASE G: Reminder cleanup for successfully deleted notes with durable failure tracking.
 * - PHASE H: Final media cleanup in Cloudflare R2 RECOMPUTED from actual deletion results.
 */
export async function executePermanentDeletion(
  plan: DeletionPlan,
  options: {
    currentUserId?: string | null;
    onProgress?: (progress: DeletionProgress) => void;
  } = {}
): Promise<DeletionResult> {
  const { currentUserId, onProgress } = options;

  // 1. Online Check
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Connect to the internet to permanently delete items. Your Recycle Bin is safe.');
  }

  const totalToProcess = plan.notesToDelete.length + plan.notebooksToDelete.length;
  let completed = 0;
  const BATCH_SIZE = 25;

  const deletedNoteIds: string[] = [];
  const deletedNotebookIds: string[] = [];
  const deletedReminderIds: string[] = [];
  const failedReminderIds: string[] = [];
  const reparentedNoteIds: string[] = [];
  const reparentedNotebookIds: string[] = [];
  const failedNoteIds: string[] = [];
  const failedNotebookIds: string[] = [];
  const staleSkippedNoteIds: string[] = [];
  const staleSkippedNotebookIds: string[] = [];
  let restoredElsewhereCount = 0;
  let cleanedMediaCount = 0;
  let pendingMediaCleanupCount = 0;

  onProgress?.({
    phase: 'preparing',
    totalItems: totalToProcess,
    completedItems: 0,
    currentLabel: 'Preparing permanent deletion plan...',
  });

  // If Guest (no currentUserId), process purely device-locally
  if (!currentUserId) {
    for (const note of plan.notesToDelete) {
      deletedNoteIds.push(note.id);
    }
    for (const nb of plan.notebooksToDelete) {
      deletedNotebookIds.push(nb.id);
    }
    for (const r of plan.remindersToClean) {
      deletedReminderIds.push(r.id);
    }
    for (const note of plan.survivingNotesToReparent) {
      reparentedNoteIds.push(note.id);
    }
    for (const nb of plan.childNotebooksToReparent) {
      reparentedNotebookIds.push(nb.id);
    }
    return {
      ok: true,
      deletedNoteIds,
      deletedNotebookIds,
      deletedReminderIds,
      failedReminderIds: [],
      reparentedNoteIds,
      reparentedNotebookIds,
      restoredElsewhereCount: 0,
      staleSkippedNoteIds: [],
      staleSkippedNotebookIds: [],
      failedNoteIds: [],
      failedNotebookIds: [],
      cleanedMediaCount: 0,
      pendingMediaCleanupCount: 0,
      summaryMessage: `Permanently deleted ${deletedNoteIds.length} notes and ${deletedNotebookIds.length} notebooks.`,
    };
  }

  // =========================================================================
  // PHASE A: Authoritative Multi-Device State Verification
  // =========================================================================
  onProgress?.({
    phase: 'checking',
    totalItems: totalToProcess,
    completedItems: 0,
    currentLabel: 'Verifying cloud state...',
  });

  const verifiedNotesToDelete: Note[] = [];
  for (const note of plan.notesToDelete) {
    try {
      const noteRef = doc(db, `users/${currentUserId}/notes`, note.id);
      const snap = await getDoc(noteRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.trashed !== true) {
          // Note was restored on another device! Skip deletion.
          restoredElsewhereCount++;
          staleSkippedNoteIds.push(note.id);
          continue;
        }
      }
      verifiedNotesToDelete.push(note);
    } catch {
      // Read failure: fail safe, do NOT permanently delete
      failedNoteIds.push(note.id);
    }
  }

  const candidateNotebooksToDelete: Notebook[] = [];
  for (const nb of plan.notebooksToDelete) {
    try {
      const nbRef = doc(db, `users/${currentUserId}/notebooks`, nb.id);
      const snap = await getDoc(nbRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data.trashed !== true) {
          // Notebook was restored on another device! Skip deletion.
          restoredElsewhereCount++;
          staleSkippedNotebookIds.push(nb.id);
          continue;
        }
      }
      candidateNotebooksToDelete.push(nb);
    } catch {
      failedNotebookIds.push(nb.id);
    }
  }

  // Section 20: If authoritative validation of Note N fails, fail safe:
  // prevent deletion of the parent notebook while child-note state is uncertain.
  const failedNoteIdsSet = new Set(failedNoteIds);
  const candidateVerifiedNotebooks: Notebook[] = [];
  for (const nb of candidateNotebooksToDelete) {
    const hasFailedChildNote = plan.notesToDelete.some(
      n => n.notebookId === nb.id && failedNoteIdsSet.has(n.id)
    );
    if (hasFailedChildNote) {
      failedNotebookIds.push(nb.id);
    } else {
      candidateVerifiedNotebooks.push(nb);
    }
  }

  // =========================================================================
  // PHASE B: Required Reparenting
  // =========================================================================
  const verifiedNotebookIdsSet = new Set(candidateVerifiedNotebooks.map(nb => nb.id));
  const verifiedNoteIdsSet = new Set(verifiedNotesToDelete.map(n => n.id));

  // Determine surviving child notebooks whose parent is being deleted
  const allNotebooksList = plan.allNotebooks || plan.notebooksToDelete;
  const childNotebooksToReparent = allNotebooksList.filter(
    nb => nb.parentId && verifiedNotebookIdsSet.has(nb.parentId) && !verifiedNotebookIdsSet.has(nb.id)
  );

  // Determine surviving notes inside notebooks in verifiedNotebookIdsSet
  const allNotesList = plan.allNotes || [
    ...plan.notesToDelete,
    ...plan.survivingNotesToReparent,
  ];
  const survivingNotesToReparent = allNotesList.filter(
    note => note.notebookId && verifiedNotebookIdsSet.has(note.notebookId) && !verifiedNoteIdsSet.has(note.id)
  );

  onProgress?.({
    phase: 'reparenting',
    totalItems: totalToProcess,
    completedItems: completed,
    currentLabel: 'Safely moving surviving notes and notebooks...',
  });

  const blockedParentNotebookIds = new Set<string>();

  // Reparent surviving child notebooks
  if (childNotebooksToReparent.length > 0) {
    try {
      const childBatch = writeBatch(db);
      for (const childNb of childNotebooksToReparent) {
        const nbRef = doc(db, `users/${currentUserId}/notebooks`, childNb.id);
        childBatch.update(nbRef, {
          parentId: null as unknown as string,
          updatedAt: serverTimestamp(),
        });
      }
      await childBatch.commit();
      for (const childNb of childNotebooksToReparent) {
        reparentedNotebookIds.push(childNb.id);
      }
    } catch (error) {
      console.warn('Failed to reparent child notebooks:', error);
      for (const childNb of childNotebooksToReparent) {
        if (childNb.parentId) {
          blockedParentNotebookIds.add(childNb.parentId);
          if (!failedNotebookIds.includes(childNb.parentId)) {
            failedNotebookIds.push(childNb.parentId);
          }
        }
      }
    }
  }

  // Reparent surviving notes
  if (survivingNotesToReparent.length > 0) {
    try {
      const reparentBatch = writeBatch(db);
      for (const survivingNote of survivingNotesToReparent) {
        const noteRef = doc(db, `users/${currentUserId}/notes`, survivingNote.id);
        reparentBatch.update(noteRef, {
          notebookId: 'default',
          sectionId: null as unknown as string,
          updatedAt: serverTimestamp(),
        });
      }
      await reparentBatch.commit();
      for (const survivingNote of survivingNotesToReparent) {
        reparentedNoteIds.push(survivingNote.id);
      }
    } catch (error) {
      console.warn('Failed to reparent surviving notes before notebook deletion:', error);
      for (const note of survivingNotesToReparent) {
        if (note.notebookId) {
          blockedParentNotebookIds.add(note.notebookId);
          if (!failedNotebookIds.includes(note.notebookId)) {
            failedNotebookIds.push(note.notebookId);
          }
        }
      }
    }
  }

  // =========================================================================
  // PHASE C: Delete NOTES and Canonical Shared-Note Records Atomically
  // Private owner note + canonical shared_notes must commit in the SAME batch!
  // =========================================================================
  interface LogicalNoteUnit {
    noteId: string;
    paths: string[];
  }

  const logicalNotes: LogicalNoteUnit[] = [];
  for (const note of verifiedNotesToDelete) {
    const paths = [`users/${currentUserId}/notes/${note.id}`];
    if (note.isShared && note.ownerId === currentUserId) {
      paths.push(`shared_notes/${note.id}`);
    }
    logicalNotes.push({ noteId: note.id, paths });
  }

  const logicalNoteBatches: LogicalNoteUnit[][] = [];
  let currentNoteBatch: LogicalNoteUnit[] = [];
  let currentNoteDocCount = 0;

  for (const unit of logicalNotes) {
    if (currentNoteDocCount + unit.paths.length > 25 && currentNoteBatch.length > 0) {
      logicalNoteBatches.push(currentNoteBatch);
      currentNoteBatch = [];
      currentNoteDocCount = 0;
    }
    currentNoteBatch.push(unit);
    currentNoteDocCount += unit.paths.length;
  }
  if (currentNoteBatch.length > 0) {
    logicalNoteBatches.push(currentNoteBatch);
  }

  for (const batchUnits of logicalNoteBatches) {
    const batch = writeBatch(db);
    for (const unit of batchUnits) {
      for (const path of unit.paths) {
        batch.delete(doc(db, path));
      }
    }

    try {
      await batch.commit();
      for (const unit of batchUnits) {
        if (!deletedNoteIds.includes(unit.noteId)) {
          deletedNoteIds.push(unit.noteId);
        }
      }
    } catch (error) {
      console.error('Firestore logical note deletion batch failed:', error);
      for (const unit of batchUnits) {
        if (!failedNoteIds.includes(unit.noteId)) {
          failedNoteIds.push(unit.noteId);
        }
      }
    }

    completed = Math.min(totalToProcess, completed + batchUnits.length);
    onProgress?.({
      phase: 'deleting-remote',
      totalItems: totalToProcess,
      completedItems: completed,
      currentLabel: `Deleting ${completed} of ${totalToProcess} items...`,
    });
  }

  // =========================================================================
  // PHASE D: Real Note Results are now recorded in deletedNoteIds & failedNoteIds
  // =========================================================================
  const finalDeletedNoteIdsSet = new Set(deletedNoteIds);
  const reparentedNoteIdsSet = new Set(reparentedNoteIds);
  const reparentedNotebookIdsSet = new Set(reparentedNotebookIds);

  // =========================================================================
  // PHASE E & F: Bottom-Up Notebook Deletion by Hierarchy Depth
  // (Deepest descendants first, actual success gates parent, private + shared atomic)
  // =========================================================================
  const notebookMap = new Map<string, Notebook>();
  for (const nb of allNotebooksList) {
    notebookMap.set(nb.id, nb);
  }

  function getNotebookDepth(nbId: string, visited = new Set<string>()): number {
    if (visited.has(nbId)) return 0;
    visited.add(nbId);
    const nb = notebookMap.get(nbId);
    if (!nb || !nb.parentId || !notebookMap.has(nb.parentId)) return 0;
    return 1 + getNotebookDepth(nb.parentId, visited);
  }

  // Calculate depths for all candidate verified notebooks
  const notebooksByDepth = new Map<number, Notebook[]>();
  let maxDepth = 0;
  for (const nb of candidateVerifiedNotebooks) {
    const depth = getNotebookDepth(nb.id);
    if (depth > maxDepth) maxDepth = depth;
    const list = notebooksByDepth.get(depth) || [];
    list.push(nb);
    notebooksByDepth.set(depth, list);
  }

  // Process from deepest descendants (maxDepth) down to root (0)
  for (let depth = maxDepth; depth >= 0; depth--) {
    const notebooksAtDepth = notebooksByDepth.get(depth) || [];
    if (notebooksAtDepth.length === 0) continue;

    const safeNotebooksAtDepth: Notebook[] = [];

    for (const nb of notebooksAtDepth) {
      if (blockedParentNotebookIds.has(nb.id) || failedNotebookIds.includes(nb.id)) {
        continue;
      }

      // 1. Verify child notes: EVERY child note must be either confirmed deleted or reparented
      let hasUnsafeChildNote = false;
      for (const note of allNotesList) {
        if (note.notebookId === nb.id) {
          const isDeleted = finalDeletedNoteIdsSet.has(note.id);
          const isReparented = reparentedNoteIdsSet.has(note.id);
          if (!isDeleted && !isReparented) {
            hasUnsafeChildNote = true;
            break;
          }
        }
      }

      // 2. Verify child notebooks: EVERY child notebook must be confirmed deleted or reparented
      // Crucial: check ACTUAL deletedNotebookIds (not candidate lists!)
      let hasUnsafeChildNotebook = false;
      for (const childNb of allNotebooksList) {
        if (childNb.parentId === nb.id) {
          const isChildDeleted = deletedNotebookIds.includes(childNb.id);
          const isChildReparented = reparentedNotebookIdsSet.has(childNb.id);
          if (!isChildDeleted && !isChildReparented) {
            hasUnsafeChildNotebook = true;
            break;
          }
        }
      }

      if (hasUnsafeChildNote || hasUnsafeChildNotebook) {
        if (!failedNotebookIds.includes(nb.id)) {
          failedNotebookIds.push(nb.id);
        }
      } else {
        safeNotebooksAtDepth.push(nb);
      }
    }

    if (safeNotebooksAtDepth.length === 0) continue;

    // Pack safe notebooks at this depth into atomic logical batches (private + shared in same batch)
    interface LogicalNotebookUnit {
      notebookId: string;
      paths: string[];
    }

    const logicalNotebooks: LogicalNotebookUnit[] = [];
    for (const nb of safeNotebooksAtDepth) {
      const paths = [`users/${currentUserId}/notebooks/${nb.id}`];
      if (nb.isShared && nb.ownerId === currentUserId) {
        paths.push(`shared_notebooks/${nb.id}`);
      }
      logicalNotebooks.push({ notebookId: nb.id, paths });
    }

    const logicalNbBatches: LogicalNotebookUnit[][] = [];
    let currentNbBatch: LogicalNotebookUnit[] = [];
    let currentNbDocCount = 0;

    for (const unit of logicalNotebooks) {
      if (currentNbDocCount + unit.paths.length > 25 && currentNbBatch.length > 0) {
        logicalNbBatches.push(currentNbBatch);
        currentNbBatch = [];
        currentNbDocCount = 0;
      }
      currentNbBatch.push(unit);
      currentNbDocCount += unit.paths.length;
    }
    if (currentNbBatch.length > 0) {
      logicalNbBatches.push(currentNbBatch);
    }

    for (const batchUnits of logicalNbBatches) {
      const batch = writeBatch(db);
      for (const unit of batchUnits) {
        for (const path of unit.paths) {
          batch.delete(doc(db, path));
        }
      }

      try {
        await batch.commit();
        for (const unit of batchUnits) {
          if (!deletedNotebookIds.includes(unit.notebookId)) {
            deletedNotebookIds.push(unit.notebookId);
          }
        }
      } catch (error) {
        console.error('Firestore logical notebook deletion batch failed:', error);
        for (const unit of batchUnits) {
          if (!failedNotebookIds.includes(unit.notebookId)) {
            failedNotebookIds.push(unit.notebookId);
          }
        }
      }

      completed = Math.min(totalToProcess, completed + batchUnits.length);
      onProgress?.({
        phase: 'deleting-remote',
        totalItems: totalToProcess,
        completedItems: completed,
        currentLabel: `Deleting ${completed} of ${totalToProcess} items...`,
      });
    }
  }

  // =========================================================================
  // PHASE G: Reminder Cleanup
  // Clean up linked reminders ONLY for successfully deleted notes
  // =========================================================================
  const remindersToClean = plan.remindersToClean.filter(
    r => r.noteId && finalDeletedNoteIdsSet.has(r.noteId)
  );

  if (remindersToClean.length > 0) {
    onProgress?.({
      phase: 'cleaning-reminders',
      totalItems: totalToProcess,
      completedItems: completed,
      currentLabel: 'Cleaning up reminders for deleted notes...',
    });

    for (let i = 0; i < remindersToClean.length; i += BATCH_SIZE) {
      const chunk = remindersToClean.slice(i, i + BATCH_SIZE);
      const reminderBatch = writeBatch(db);
      for (const reminder of chunk) {
        reminderBatch.delete(doc(db, `users/${currentUserId}/reminders/${reminder.id}`));
      }
      try {
        await reminderBatch.commit();
        for (const reminder of chunk) {
          deletedReminderIds.push(reminder.id);
        }
      } catch (err) {
        console.warn('Reminder deletion batch failed:', err);
        for (const reminder of chunk) {
          failedReminderIds.push(reminder.id);
        }
        // Reminder failure does NOT roll back note deletion
      }
    }

    // If any reminder cleanup failed, queue durable user-scoped retry (local and server, Sections 20, 22)
    if (failedReminderIds.length > 0) {
      queuePendingReminderCleanups(currentUserId, failedReminderIds);
      queueServerPendingReminderCleanups(failedReminderIds).catch(() => undefined);
    }
  }

  // =========================================================================
  // PHASE H: Final Media Cleanup in Cloudflare R2
  // Recompute media candidates strictly from ACTUAL successfully deleted notes
  // =========================================================================
  const notesActuallyDeleted = allNotesList.filter(n => finalDeletedNoteIdsSet.has(n.id));
  const remainingNotes = allNotesList.filter(n => !finalDeletedNoteIdsSet.has(n.id));

  // Harvest all media candidates from successfully deleted notes owned by caller
  const candidateMediaMap = new Map<string, MediaCandidate>();
  for (const deletedNote of notesActuallyDeleted) {
    const isOwner = !deletedNote.isShared || (currentUserId && deletedNote.ownerId === currentUserId);
    if (!isOwner) continue;

    const items = extractMediaCandidates(deletedNote);
    for (const item of items) {
      const mediaKey = `${item.purpose}:${item.objectId}`;
      if (!candidateMediaMap.has(mediaKey)) {
        candidateMediaMap.set(mediaKey, item);
      }
    }
  }

  // Filter candidates: must NOT be referenced by ANY note in remainingNotes
  // (remainingNotes includes active notes, untargeted trashed notes, stale-restored notes, and failed-deletion notes)
  const finalMediaToClean: MediaCandidate[] = [];
  for (const candidate of candidateMediaMap.values()) {
    const isReusedInRemaining = isMediaReused(
      candidate.purpose,
      candidate.objectId,
      candidate.noteId,
      remainingNotes,
      new Set<string>()
    );
    if (!isReusedInRemaining) {
      finalMediaToClean.push(candidate);
    }
  }

  if (finalMediaToClean.length > 0) {
    onProgress?.({
      phase: 'cleaning-media',
      totalItems: totalToProcess,
      completedItems: completed,
      currentLabel: 'Cleaning up permanently removed media...',
    });

    for (const media of finalMediaToClean) {
      try {
        // Immediate 1-2 limited retries with small backoff before enqueuing (Section 11)
        const deleted = await deleteStorageFile(media.purpose, media.objectId, 2);
        if (deleted) {
          cleanedMediaCount++;
        } else {
          pendingMediaCleanupCount++;
          enqueuePendingMediaCleanup({
            uid: currentUserId,
            purpose: media.purpose,
            objectId: media.objectId,
            noteId: media.noteId,
          });
        }
      } catch (err) {
        console.warn('R2 media cleanup error, enqueued for retry:', err);
        pendingMediaCleanupCount++;
        enqueuePendingMediaCleanup({
          uid: currentUserId,
          purpose: media.purpose,
          objectId: media.objectId,
          noteId: media.noteId,
        });
      }
    }
  }

  // =========================================================================
  // Result Summary
  // =========================================================================
  const isCompleteSuccess = failedNoteIds.length === 0 && failedNotebookIds.length === 0;
  let summaryMessage = '';

  if (isCompleteSuccess) {
    const parts: string[] = [];
    if (deletedNoteIds.length > 0) {
      parts.push(`${deletedNoteIds.length} note${deletedNoteIds.length === 1 ? '' : 's'}`);
    }
    if (deletedNotebookIds.length > 0) {
      parts.push(`${deletedNotebookIds.length} notebook${deletedNotebookIds.length === 1 ? '' : 's'}`);
    }
    summaryMessage = parts.length > 0
      ? `Permanently deleted ${parts.join(' and ')}.`
      : 'Recycle Bin is empty.';
  } else {
    const successCount = deletedNoteIds.length + deletedNotebookIds.length;
    const failCount = failedNoteIds.length + failedNotebookIds.length;
    summaryMessage = `${successCount} items were permanently deleted. ${failCount} items could not be deleted and remain in your Recycle Bin.`;
  }

  if (restoredElsewhereCount > 0) {
    summaryMessage += ` ${restoredElsewhereCount} item${restoredElsewhereCount === 1 ? ' was' : 's were'} restored on another device and kept.`;
  }

  if (failedReminderIds.length > 0) {
    summaryMessage += ` ${failedReminderIds.length} reminder${failedReminderIds.length === 1 ? '' : 's'} could not be removed and will be cleaned up on next sync.`;
  }

  if (pendingMediaCleanupCount > 0) {
    summaryMessage += ` ${pendingMediaCleanupCount} media file${pendingMediaCleanupCount === 1 ? ' is' : 's are'} still being cleaned up.`;
  }

  return {
    ok: isCompleteSuccess,
    deletedNoteIds,
    deletedNotebookIds,
    deletedReminderIds,
    failedReminderIds,
    reparentedNoteIds,
    reparentedNotebookIds,
    restoredElsewhereCount,
    staleSkippedNoteIds,
    staleSkippedNotebookIds,
    failedNoteIds,
    failedNotebookIds,
    cleanedMediaCount,
    pendingMediaCleanupCount,
    summaryMessage,
  };
}

