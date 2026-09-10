import { db, auth } from '@/utils/firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import type { DirectChat, DirectMessage } from '@/types';
import {
  DIRECT_CHAT_LIST_LIMIT,
  DIRECT_MESSAGE_PAGE_SIZE,
  DIRECT_MESSAGE_MAX_CHARS,
} from '@/utils/freeZoneConstants';

export const getDeterministicChatId = (uidA: string, uidB: string): string => {
  if (!uidA || !uidB) {
    throw new Error('Both user IDs are required to compute deterministic chat ID');
  }
  return [uidA.trim(), uidB.trim()].sort().join('_');
};

export const getTimestampMillis = (val: unknown): number => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const t = new Date(val).getTime();
    return isNaN(t) ? 0 : t;
  }
  if (typeof val === 'object' && val !== null) {
    if ('toMillis' in val && typeof (val as { toMillis: () => number }).toMillis === 'function') {
      return (val as { toMillis: () => number }).toMillis();
    }
    if ('seconds' in val && typeof (val as { seconds: number }).seconds === 'number') {
      return (val as { seconds: number }).seconds * 1000;
    }
  }
  return 0;
};

let activeMessagesUnsubscribe: Unsubscribe | null = null;
let sendingLock = false;

const cachedChatsById = new Map<string, DirectChat>();

export const getCachedDirectChat = (chatId: string): DirectChat | undefined => {
  return cachedChatsById.get(chatId);
};

export const updateChatCache = (chat: DirectChat) => {
  cachedChatsById.set(chat.id, chat);
};

export const clearChatCache = () => {
  cachedChatsById.clear();
};

export const unsubscribeActiveMessages = () => {
  if (activeMessagesUnsubscribe) {
    activeMessagesUnsubscribe();
    activeMessagesUnsubscribe = null;
  }
};

export const getOrCreateDirectChat = async (
  targetUser: { uid: string; email: string; name?: string; photoURL?: string },
  _hasCollaborationRelationship = false,
  requestPreview?: string
): Promise<DirectChat> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Must be signed in to access private messaging');

  const myUid = currentUser.uid;
  const targetUid = targetUser.uid;
  if (!targetUid) throw new Error('Target user has no UID');
  if (myUid === targetUid) throw new Error('Cannot create direct chat with yourself');

  const chatId = getDeterministicChatId(myUid, targetUid);

  // Step A/B: Check currently loaded participant chat state/cache FIRST.
  const cached = cachedChatsById.get(chatId);
  if (cached) {
    return cached;
  }

  const chatRef = doc(db, 'direct_chats', chatId);

  const myName = currentUser.displayName || currentUser.email?.split('@')[0] || 'Me';
  const myEmail = currentUser.email || '';
  const myPhoto = currentUser.photoURL || undefined;
  const sanitizedPreview = (requestPreview || '').trim().slice(0, 240);

  const newChatDocData: Record<string, any> = {
    participantUids: [myUid, targetUid].sort(),
    participantEmails: [myEmail, targetUser.email].sort(),
    participantData: {
      [myUid]: {
        name: myName,
        email: myEmail,
        ...(myPhoto ? { photoURL: myPhoto } : {}),
      },
      [targetUid]: {
        name: targetUser.name || targetUser.email.split('@')[0],
        email: targetUser.email,
        ...(targetUser.photoURL ? { photoURL: targetUser.photoURL } : {}),
      },
    },
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessagePreview: sanitizedPreview ? sanitizedPreview.slice(0, 100) : '',
    lastMessageSenderUid: '',
    status: 'pending' as const,
    requestedByUid: myUid,
    lastReadAtByUid: {
      [myUid]: serverTimestamp(),
    },
    blockedByUids: [],
  };

  if (sanitizedPreview) {
    newChatDocData.requestPreview = sanitizedPreview;
  }

  // Step C: Attempt CREATE FIRST using the strict deterministic chat ID
  try {
    await setDoc(chatRef, newChatDocData);
    const createdChat: DirectChat = {
      id: chatId,
      ...(newChatDocData as Omit<DirectChat, 'id'>),
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      lastReadAtByUid: { [myUid]: new Date().toISOString() },
    };
    cachedChatsById.set(chatId, createdChat);
    return createdChat;
  } catch (createError) {
    // Step E: If create fails (e.g. permission denied because existing document is already present
    // and rules reject overwrite, or concurrent race won by the other user):
    try {
      const snap = await getDoc(chatRef);
      if (snap.exists()) {
        const existingChat = { id: snap.id, ...(snap.data() as Omit<DirectChat, 'id'>) };
        cachedChatsById.set(chatId, existingChat);
        return existingChat;
      }
    } catch (getError) {
      console.warn('[NTK Chat] Safe getOrCreateDirectChat fallback failed:', getError);
    }
    // Return friendly, privacy-safe error without leaking Firestore internals
    throw new Error('Could not start conversation. Please check your connection and try again.');
  }
};

export const subscribeToDirectChats = (
  uid: string,
  callback: (chats: DirectChat[]) => void,
  onError?: (err: Error) => void
): Unsubscribe => {
  // Query newest 20 conversations directly from server index
  const q = query(
    collection(db, 'direct_chats'),
    where('participantUids', 'array-contains', uid),
    orderBy('lastMessageAt', 'desc'),
    limit(DIRECT_CHAT_LIST_LIMIT)
  );

  return onSnapshot(
    q,
    snapshot => {
      const chats = snapshot.docs.map(d => {
        const chat = {
          id: d.id,
          ...(d.data() as Omit<DirectChat, 'id'>),
        };
        cachedChatsById.set(chat.id, chat);
        return chat;
      });

      callback(chats);
    },
    error => {
      console.warn('[NTK Chat] Direct chats listener error:', error);
      if (onError) onError(error);
    }
  );
};

export const subscribeToMessages = (
  chatId: string,
  callback: (messages: DirectMessage[]) => void,
  onError?: (err: Error) => void
): Unsubscribe => {
  unsubscribeActiveMessages();

  const q = query(
    collection(db, 'direct_chats', chatId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(DIRECT_MESSAGE_PAGE_SIZE)
  );

  const unsub = onSnapshot(
    q,
    snapshot => {
      const messages = snapshot.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<DirectMessage, 'id'>),
      }));
      // Reverse to chronological order (oldest to newest)
      messages.reverse();
      callback(messages);
    },
    error => {
      console.warn(`[NTK Chat] Messages listener error for chat ${chatId}:`, error);
      if (onError) onError(error);
    }
  );

  activeMessagesUnsubscribe = unsub;
  return unsub;
};

export const loadEarlierMessages = async (
  chatId: string,
  oldestCreatedAt: unknown
): Promise<DirectMessage[]> => {
  const q = query(
    collection(db, 'direct_chats', chatId, 'messages'),
    orderBy('createdAt', 'desc'),
    startAfter(oldestCreatedAt),
    limit(DIRECT_MESSAGE_PAGE_SIZE)
  );

  const snapshot = await getDocs(q);
  const messages = snapshot.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<DirectMessage, 'id'>),
  }));
  messages.reverse();
  return messages;
};

/**
 * Atomic message creation and chat summary update via Firestore writeBatch.
 * Enforces strictly intended fields and prevents stale chat summaries.
 */
export const sendMessage = async (
  chatId: string,
  text: string
): Promise<void> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Must be signed in to send messages');

  const cleanText = text.trim();
  if (!cleanText) throw new Error('Message cannot be empty');
  if (cleanText.length > DIRECT_MESSAGE_MAX_CHARS) {
    throw new Error(`Message exceeds maximum length of ${DIRECT_MESSAGE_MAX_CHARS} characters`);
  }

  if (sendingLock) return;
  sendingLock = true;

  try {
    const myUid = currentUser.uid;
    const batch = writeBatch(db);

    const messageRef = doc(collection(db, 'direct_chats', chatId, 'messages'));
    const messageData = {
      senderUid: myUid,
      text: cleanText,
      createdAt: serverTimestamp(),
      type: 'text' as const,
    };

    batch.set(messageRef, messageData);

    const chatRef = doc(db, 'direct_chats', chatId);
    batch.update(chatRef, {
      lastMessageAt: serverTimestamp(),
      lastMessagePreview: cleanText.slice(0, 80),
      lastMessageSenderUid: myUid,
      [`lastReadAtByUid.${myUid}`]: serverTimestamp(),
    });

    await batch.commit();
  } finally {
    sendingLock = false;
  }
};

export const markChatAsRead = async (chatId: string, myUid: string): Promise<void> => {
  try {
    const chatRef = doc(db, 'direct_chats', chatId);
    await updateDoc(chatRef, {
      [`lastReadAtByUid.${myUid}`]: serverTimestamp(),
    });
  } catch (error) {
    console.warn('[NTK Chat] Could not mark chat as read:', error);
  }
};

export const acceptChatRequest = async (chatId: string): Promise<void> => {
  const chatRef = doc(db, 'direct_chats', chatId);
  await updateDoc(chatRef, {
    status: 'active',
    acceptedAt: serverTimestamp(),
  });
};

export const declineChatRequest = async (chatId: string): Promise<void> => {
  const chatRef = doc(db, 'direct_chats', chatId);
  await updateDoc(chatRef, {
    status: 'declined',
    declinedAt: serverTimestamp(),
  });
};

/**
 * Initiator-based blocking semantics:
 * Adds caller's UID to blockedByUids and transitions chat to 'blocked'.
 */
export const blockUserInChat = async (chatId: string): Promise<void> => {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Must be signed in to block');
  const myUid = currentUser.uid;

  const chatRef = doc(db, 'direct_chats', chatId);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) return;

  const data = snap.data() as DirectChat;
  const existingBlocked = data.blockedByUids || [];
  const updatedBlocked = Array.from(new Set([...existingBlocked, myUid]));

  await updateDoc(chatRef, {
    status: 'blocked',
    blockedByUids: updatedBlocked,
    blockedAt: serverTimestamp(),
  });
};

export const isChatUnread = (chat: DirectChat, myUid: string): boolean => {
  if (!chat.lastMessageSenderUid || chat.lastMessageSenderUid === myUid) return false;
  const myLastRead = chat.lastReadAtByUid?.[myUid];
  const lastReadMillis = getTimestampMillis(myLastRead);
  const lastMsgMillis = getTimestampMillis(chat.lastMessageAt);
  if (!lastReadMillis) return lastMsgMillis > 0;
  return lastMsgMillis > lastReadMillis;
};
