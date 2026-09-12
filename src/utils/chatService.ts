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

import { useStore } from '@/store';
import {
  getConfirmedUid,
  resolveConfirmedUid,
  isConfirmedSession,
} from '@/utils/sessionAuthority';

export { getConfirmedUid, resolveConfirmedUid, isConfirmedSession };

export interface ComposerState {
  uid: string | null;
  chatId: string | null;
  text: string;
}
export type MessagesComposerState = ComposerState;

/**
 * Pure state reducer for atomic identity transitions in Messages composer.
 * When UID or chatId transitions, the previous account's draft/text is instantly cleared
 * and the new scoped draft is loaded (or empty if unauthenticated/transitioning).
 */
export const reduceMessagesComposerState = (
  prev: ComposerState,
  nextUid: string | null,
  nextChatId: string | null
): ComposerState => {
  const confirmed = getConfirmedUid(nextUid);
  const safeChatId = nextChatId?.trim() || null;

  if (prev.uid !== confirmed || prev.chatId !== safeChatId) {
    return {
      uid: confirmed,
      chatId: safeChatId,
      text: confirmed && safeChatId ? getChatDraft(confirmed, safeChatId) : '',
    };
  }

  return prev;
};

export const getChatDraftKey = (uid: string | null | undefined, chatId: string | null | undefined): string => {
  const confirmed = getConfirmedUid(uid);
  const safeChatId = chatId?.trim() || '';
  if (!confirmed || !safeChatId) {
    return '';
  }
  return `ntk:chat:draft:${confirmed}:${safeChatId}`;
};

export const getLegacyChatDraftKey = (chatId: string): string => {
  return `ntk:chat:draft:${chatId?.trim() || ''}`;
};

/**
 * Retrieve an unsent chat draft strictly scoped to the authenticated UID.
 * Never falls back to legacy unscoped storage or invalid UIDs to prevent cross-account draft leakage.
 */
export const getChatDraft = (uid: string | null | undefined, chatId: string | null | undefined): string => {
  if (typeof localStorage === 'undefined') return '';
  const confirmed = getConfirmedUid(uid);
  const safeChatId = chatId?.trim();
  if (!confirmed || !safeChatId) return '';
  try {
    const key = getChatDraftKey(confirmed, safeChatId);
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

/**
 * Store an unsent chat draft strictly scoped to the authenticated UID.
 * If text is empty, deletes the key. Fails closed (no-op) if UID is unconfirmed.
 */
export const setChatDraft = (uid: string | null | undefined, chatId: string | null | undefined, text: string): void => {
  if (typeof localStorage === 'undefined') return;
  const confirmed = getConfirmedUid(uid);
  const safeChatId = chatId?.trim();
  if (!confirmed || !safeChatId) return; // FAIL CLOSED
  try {
    const key = getChatDraftKey(confirmed, safeChatId);
    if (text) {
      localStorage.setItem(key, text);
    } else {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.warn('[Chat] Failed to persist scoped draft:', err);
  }
};

/**
 * Clear a specific user's chat draft. Fails closed (no-op) if UID is unconfirmed.
 */
export const clearChatDraft = (uid: string | null | undefined, chatId: string | null | undefined): void => {
  if (typeof localStorage === 'undefined') return;
  const confirmed = getConfirmedUid(uid);
  const safeChatId = chatId?.trim();
  if (!confirmed || !safeChatId) return; // FAIL CLOSED
  try {
    const key = getChatDraftKey(confirmed, safeChatId);
    localStorage.removeItem(key);
  } catch (err) {
    console.warn('[Chat] Failed to clear scoped draft:', err);
  }
};

/**
 * Legacy Draft Policy:
 * Unscoped chat drafts (`ntk:chat:draft:${chatId}`) cannot be proven to belong
 * to the currently signed-in user, because deterministic chat IDs are symmetric
 * between User A and User B.
 * Therefore, legacy drafts are NEVER automatically migrated to a user's scoped draft.
 * Instead, they are quarantined and safely removed so obsolete unscoped drafts do not linger.
 */
export const cleanupLegacyChatDraft = (chatId: string): void => {
  if (typeof localStorage === 'undefined') return;
  if (!chatId) return;
  try {
    const legacyKey = getLegacyChatDraftKey(chatId);
    localStorage.removeItem(legacyKey);
  } catch {}
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
 * DEFENSE-IN-DEPTH AUTHENTICATION & SESSION COHERENCE:
 * Before performing ANY Firestore write, validates:
 * 1. Current Firebase auth UID exists and is confirmed.
 * 2. Current workspace store UID exists and is confirmed.
 * 3. Auth UID === Store UID.
 * 4. Expected sender UID (from composer) === Confirmed UID.
 * If any identity differs, ABORTS immediately with ZERO Firestore writes.
 */
export const sendMessage = async (
  chatId: string,
  text: string,
  expectedSenderUid?: string | null,
  overrides?: {
    currentAuthUid?: string | null;
    currentStoreUid?: string | null;
  }
): Promise<void> => {
  const authUid = overrides?.currentAuthUid !== undefined
    ? overrides.currentAuthUid
    : auth.currentUser?.uid;
  const storeUid = overrides?.currentStoreUid !== undefined
    ? overrides.currentStoreUid
    : useStore.getState().uid;

  const confirmedUid = resolveConfirmedUid(authUid, storeUid);
  if (!confirmedUid) {
    throw new Error('AUTH_TRANSITION_ABORT: No confirmed session active');
  }

  if (expectedSenderUid !== undefined && expectedSenderUid !== null) {
    const expected = getConfirmedUid(expectedSenderUid);
    if (!expected || expected !== confirmedUid) {
      throw new Error(
        `AUTH_TRANSITION_ABORT: Stale sender session (expected ${expectedSenderUid}, active ${confirmedUid})`
      );
    }
  }

  const cleanText = text.trim();
  if (!cleanText) throw new Error('Message cannot be empty');
  if (cleanText.length > DIRECT_MESSAGE_MAX_CHARS) {
    throw new Error(`Message exceeds maximum length of ${DIRECT_MESSAGE_MAX_CHARS} characters`);
  }

  if (sendingLock) return;
  sendingLock = true;

  try {
    const batch = writeBatch(db);

    const messageRef = doc(collection(db, 'direct_chats', chatId, 'messages'));
    const messageData = {
      senderUid: confirmedUid,
      text: cleanText,
      createdAt: serverTimestamp(),
      type: 'text' as const,
    };

    batch.set(messageRef, messageData);

    const chatRef = doc(db, 'direct_chats', chatId);
    batch.update(chatRef, {
      lastMessageAt: serverTimestamp(),
      lastMessagePreview: cleanText.slice(0, 80),
      lastMessageSenderUid: confirmedUid,
      [`lastReadAtByUid.${confirmedUid}`]: serverTimestamp(),
    });

    await batch.commit();
  } finally {
    sendingLock = false;
  }
};

export interface ExecuteSendMessageParams {
  chatId: string;
  text: string;
  expectedSenderUid: string | null;
  currentAuthUid?: string | null;
  currentStoreUid?: string | null;
}

export interface ExecuteSendMessageResult {
  success: boolean;
  error?: string;
}

export const executeSendMessage = async (
  params: ExecuteSendMessageParams
): Promise<ExecuteSendMessageResult> => {
  try {
    await sendMessage(params.chatId, params.text, params.expectedSenderUid, {
      currentAuthUid: params.currentAuthUid,
      currentStoreUid: params.currentStoreUid,
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Send failed' };
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
