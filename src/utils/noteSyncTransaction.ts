/**
 * NTK Note v2.8 — Atomic Server-Authoritative Note Compare-and-Write
 *
 * Replaces non-atomic TOCTOU (check-then-set) logic with atomic Firestore transactions.
 * Within a single transaction:
 * 1. Reads canonical remote document inside transaction.
 * 2. Compares canonical remote updatedAt to queued baseUpdatedAt.
 * 3. Aborts write and returns structured conflict if remote changed concurrently.
 * 4. Writes local version inside the SAME transaction if remote is unchanged.
 * 5. Fails closed: if server state cannot be verified, write is aborted.
 *
 * v2.8 Reliability Closure:
 * - remote_deleted: baseUpdatedAt present + remote absent = deleted on another device, NOT a new create.
 * - Owner-shared notes read shared_notes/{noteId} as canonical collaborative authority.
 */

import {
  type Firestore,
  doc,
  runTransaction,
} from 'firebase/firestore';
import type { Note, SyncQueueItem } from '@/types';

export interface NoteCommitSuccess {
  status: 'committed';
  updatedAt: string;
}

export interface NoteCommitConflict {
  status: 'conflict';
  remoteNote: Note;
}

export interface NoteCommitFailure {
  status: 'failed';
  error: string;
}

export interface NoteCommitRemoteDeleted {
  status: 'remote_deleted';
  noteId: string;
  localNote: Note;
}

export type NoteCommitResult = NoteCommitSuccess | NoteCommitConflict | NoteCommitFailure | NoteCommitRemoteDeleted;

export function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        result[key] = stripUndefined(value);
      } else {
        result[key] = value;
      }
    }
  }
  return result as T;
}

export type TransactionRunner = (
  firestore: Firestore,
  updateFunction: (transaction: any) => Promise<any>
) => Promise<any>;

export async function commitQueuedNoteSafely(
  db: Firestore,
  uid: string,
  note: Note,
  queueItem: SyncQueueItem,
  transactionRunner: TransactionRunner = runTransaction
): Promise<NoteCommitResult> {
  const isCollaboratorEdit = Boolean(note.isShared && note.ownerId && note.ownerId !== uid);
  const isOwnerShared = Boolean(note.isShared && note.ownerId === uid);

  const resolveDoc = (path: string, ...segments: string[]) => {
    if (typeof (db as any)?.mockDoc === 'function') {
      return (db as any).mockDoc(path, ...segments);
    }
    return doc(db, path, ...segments);
  };

  const targetRef = isCollaboratorEdit
    ? resolveDoc('shared_notes', note.id)
    : resolveDoc(`users/${uid}/notes`, note.id);

  const sharedMirrorRef = isOwnerShared
    ? resolveDoc('shared_notes', note.id)
    : null;

  try {
    const result = await transactionRunner(db, async transaction => {
      // 1. Read canonical remote document inside transaction
      const remoteSnap = await transaction.get(targetRef);

      // 2. For owner-shared notes, also read the shared authority as canonical
      let sharedSnap: typeof remoteSnap | null = null;
      if (isOwnerShared && sharedMirrorRef) {
        sharedSnap = await transaction.get(sharedMirrorRef);
      }

      if (remoteSnap.exists()) {
        const remoteNote = remoteSnap.data() as Note;

        // Compare canonical remote updatedAt to queued baseUpdatedAt
        if (queueItem.baseUpdatedAt) {
          if (
            remoteNote.updatedAt &&
            remoteNote.updatedAt !== queueItem.baseUpdatedAt &&
            remoteNote.updatedAt !== note.updatedAt
          ) {
            // Server has newer concurrent edits: abort write inside transaction
            return { conflict: true, remoteDeleted: false, remoteNote };
          }
        }

        // For owner-shared notes, also check the shared authority for collaborator edits
        if (isOwnerShared && sharedSnap && sharedSnap.exists()) {
          const sharedNote = sharedSnap.data() as Note;
          if (
            queueItem.baseUpdatedAt &&
            sharedNote.updatedAt &&
            sharedNote.updatedAt !== queueItem.baseUpdatedAt &&
            sharedNote.updatedAt !== note.updatedAt
          ) {
            // Collaborator edited the shared authority: conflict
            return { conflict: true, remoteDeleted: false, remoteNote: sharedNote };
          }
        }
      } else {
        // Remote document does NOT exist.
        // Distinguish: genuine new create vs. remotely deleted existing note.
        if (queueItem.baseUpdatedAt) {
          // baseUpdatedAt present proves the note existed remotely when this edit session began.
          // Remote absence + prior existence = deleted on another device.
          // Do NOT recreate. Return remote_deleted status.
          return { conflict: false, remoteDeleted: true, remoteNote: null };
        }
        // No baseUpdatedAt = genuine new note. Proceed to create.
      }

      // 3. Remote unchanged (or new document): write inside the SAME transaction
      transaction.set(targetRef, stripUndefined(note));

      if (sharedMirrorRef) {
        transaction.set(sharedMirrorRef, stripUndefined(note));
      }

      return { conflict: false, remoteDeleted: false, remoteNote: null };
    });

    if (result.remoteDeleted) {
      return { status: 'remote_deleted', noteId: note.id, localNote: note };
    }

    if (result.conflict && result.remoteNote) {
      return { status: 'conflict', remoteNote: result.remoteNote };
    }

    return { status: 'committed', updatedAt: note.updatedAt };
  } catch (err) {
    // 4. FAIL CLOSED: If transaction or read fails, do NOT write anyway.
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Transaction failed to commit note.',
    };
  }
}

