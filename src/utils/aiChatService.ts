import { db } from '@/utils/firebase';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  limit,
  startAfter,
} from 'firebase/firestore';
import type { AiThread, AiTurn } from '@/types';
import {
  AI_THREAD_LIST_LIMIT,
  AI_TURN_PAGE_SIZE,
} from '@/utils/freeZoneConstants';

export const createAiThread = async (
  uid: string,
  firstUserText: string,
  noteContext?: { noteId?: string; noteTitle?: string }
): Promise<AiThread> => {
  const nowIso = new Date().toISOString();
  // Safe sensible title derived from first prompt without costly extra AI calls
  const rawTitle = firstUserText.trim().replace(/^["']|["']$/g, '');
  const title = (rawTitle.slice(0, 42).trim() || 'New conversation') + (rawTitle.length > 42 ? '…' : '');

  const threadRef = doc(collection(db, 'users', uid, 'ai_threads'));
  const threadData: Omit<AiThread, 'id'> = {
    title,
    createdAt: nowIso,
    updatedAt: nowIso,
    preview: firstUserText.slice(0, 80),
    ...(noteContext?.noteId ? { noteId: noteContext.noteId } : {}),
    ...(noteContext?.noteTitle ? { noteTitle: noteContext.noteTitle } : {}),
  };

  await setDoc(threadRef, threadData);
  return { id: threadRef.id, ...threadData };
};

export const fetchAiThreads = async (uid: string): Promise<AiThread[]> => {
  const q = query(
    collection(db, 'users', uid, 'ai_threads'),
    orderBy('updatedAt', 'desc'),
    limit(AI_THREAD_LIST_LIMIT)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<AiThread, 'id'>),
  }));
};

export const fetchAiTurns = async (uid: string, threadId: string): Promise<AiTurn[]> => {
  const q = query(
    collection(db, 'users', uid, 'ai_threads', threadId, 'turns'),
    orderBy('createdAt', 'desc'),
    limit(AI_TURN_PAGE_SIZE)
  );

  const snapshot = await getDocs(q);
  const turns = snapshot.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<AiTurn, 'id'>),
  }));
  turns.reverse(); // Chronological order
  return turns;
};

export const loadEarlierAiTurns = async (
  uid: string,
  threadId: string,
  oldestCreatedAt: string
): Promise<AiTurn[]> => {
  const q = query(
    collection(db, 'users', uid, 'ai_threads', threadId, 'turns'),
    orderBy('createdAt', 'desc'),
    startAfter(oldestCreatedAt),
    limit(AI_TURN_PAGE_SIZE)
  );

  const snapshot = await getDocs(q);
  const turns = snapshot.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<AiTurn, 'id'>),
  }));
  turns.reverse();
  return turns;
};

/**
 * CRITICAL SPARK LOCK REQUIREMENT:
 * Tokens are streamed exclusively in browser memory.
 * Only one turn document is persisted to Firestore once generation finishes.
 */
export const saveCompletedAiTurn = async (
  uid: string,
  threadId: string,
  userText: string,
  assistantText: string,
  status: 'completed' | 'error' | 'stopped' = 'completed'
): Promise<AiTurn> => {
  const nowIso = new Date().toISOString();
  const turnRef = doc(collection(db, 'users', uid, 'ai_threads', threadId, 'turns'));
  const turnData: Omit<AiTurn, 'id'> = {
    userText,
    assistantText,
    createdAt: nowIso,
    status,
  };

  await setDoc(turnRef, turnData);

  // Update thread metadata
  const threadRef = doc(db, 'users', uid, 'ai_threads', threadId);
  await updateDoc(threadRef, {
    updatedAt: nowIso,
    preview: assistantText.slice(0, 80) || userText.slice(0, 80),
  });

  return { id: turnRef.id, ...turnData };
};

export const deleteAiThread = async (
  uid: string,
  threadId: string,
  onProgress?: (deletedCount: number) => void
): Promise<void> => {
  const turnsCol = collection(db, 'users', uid, 'ai_threads', threadId, 'turns');
  let deletedCount = 0;

  // Spark-compatible bounded batch deletion to ensure no orphaned turns remain
  while (true) {
    const q = query(turnsCol, limit(50));
    const snapshot = await getDocs(q);
    if (snapshot.empty) break;

    const batch = writeBatch(db);
    for (const docSnap of snapshot.docs) {
      batch.delete(docSnap.ref);
    }
    await batch.commit();
    deletedCount += snapshot.size;
    if (onProgress) {
      onProgress(deletedCount);
    }
  }

  const threadRef = doc(db, 'users', uid, 'ai_threads', threadId);
  await deleteDoc(threadRef);
};

export const renameAiThread = async (uid: string, threadId: string, newTitle: string): Promise<void> => {
  const cleanTitle = newTitle.trim().slice(0, 60);
  if (!cleanTitle) return;
  const threadRef = doc(db, 'users', uid, 'ai_threads', threadId);
  await updateDoc(threadRef, {
    title: cleanTitle,
  });
};
