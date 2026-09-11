import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '@/store';
import { auth } from '@/utils/firebase';
import {
  MessageSquare,
  Plus,
  ArrowLeft,
  Send,
  MoreVertical,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Ban,
  LoaderCircle,
  Clock,
  WifiOff,
} from 'lucide-react';
import type { DirectChat, DirectMessage } from '@/types';
import {
  subscribeToDirectChats,
  subscribeToMessages,
  markChatAsRead,
  acceptChatRequest,
  declineChatRequest,
  blockUserInChat,
  loadEarlierMessages,
  isChatUnread,
  getTimestampMillis,
  getChatDraft,
  setChatDraft,
  clearChatDraft,
  cleanupLegacyChatDraft,
  resolveConfirmedUid,
  isConfirmedSession,
  executeSendMessage,
  reduceMessagesComposerState,
} from '@/utils/chatService';
import { DIRECT_MESSAGE_MAX_CHARS, DIRECT_MESSAGE_PAGE_SIZE } from '@/utils/freeZoneConstants';
import UserAvatar from '@/components/UserAvatar';
import NewMessageModal from '@/components/NewMessageModal';

export default function MessagesView() {
  const { activeChatId, setActiveChatId, online, uid: storeUid } = useStore();
  const currentUser = auth.currentUser;
  const confirmedUid = resolveConfirmedUid(currentUser?.uid, storeUid);
  const myUid = confirmedUid || '';

  const [chats, setChats] = useState<DirectChat[]>([]);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMoreEarlier, setHasMoreEarlier] = useState(false);
  const [actionError, setActionError] = useState('');

  // Synchronous atomic identity-transition state:
  const [composerState, setComposerState] = useState(() => ({
    uid: confirmedUid,
    chatId: activeChatId,
    text: confirmedUid && activeChatId ? getChatDraft(confirmedUid, activeChatId) : '',
  }));

  // Synchronous transition guard: If confirmedUid or activeChatId changed, instantly reduce state
  // BEFORE any DOM render or user action can access or send previous account's draft.
  if (composerState.uid !== confirmedUid || composerState.chatId !== activeChatId) {
    const nextState = reduceMessagesComposerState(composerState, confirmedUid, activeChatId);
    setComposerState(nextState);
    setMessages([]);
    setChats([]);
    setActionError('');
  }

  const composerText = composerState.text;
  const [isSending, setIsSending] = useState(false);
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Subscribe to direct chats list
  useEffect(() => {
    if (!confirmedUid) {
      setChats([]);
      setLoadingChats(false);
      return;
    }

    setLoadingChats(true);
    const unsub = subscribeToDirectChats(
      confirmedUid,
      loadedChats => {
        setChats(loadedChats);
        setLoadingChats(false);
      },
      () => setLoadingChats(false)
    );

    return () => unsub();
  }, [confirmedUid]);

  // Active chat object
  const activeChat = useMemo(() => {
    return chats.find(c => c.id === activeChatId) || null;
  }, [chats, activeChatId]);

  // Other participant in the active chat
  const otherParticipant = useMemo(() => {
    if (!activeChat || !confirmedUid) return null;
    const otherUid = activeChat.participantUids.find(uid => uid !== confirmedUid);
    if (!otherUid) return null;
    const pData = activeChat.participantData?.[otherUid];
    const otherEmail = activeChat.participantEmails.find(e => e !== currentUser?.email) || '';
    return {
      uid: otherUid,
      name: pData?.name || otherEmail.split('@')[0] || 'User',
      email: pData?.email || otherEmail,
      photoURL: pData?.photoURL,
    };
  }, [activeChat, confirmedUid, currentUser?.email]);

  // Subscribe to messages in active chat
  useEffect(() => {
    if (!activeChatId || !confirmedUid) {
      setMessages([]);
      setLoadingMessages(false);
      return;
    }

    setLoadingMessages(true);
    setHasMoreEarlier(false);

    // Clean up any legacy unscoped draft without migrating
    cleanupLegacyChatDraft(activeChatId);

    // Mark as read
    void markChatAsRead(activeChatId, confirmedUid);

    const unsub = subscribeToMessages(
      activeChatId,
      loadedMessages => {
        setMessages(loadedMessages);
        setLoadingMessages(false);
        setHasMoreEarlier(loadedMessages.length >= DIRECT_MESSAGE_PAGE_SIZE);
        // Scroll to bottom on initial load / new incoming message
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 80);
      },
      () => setLoadingMessages(false)
    );

    return () => {
      unsub();
    };
  }, [activeChatId, confirmedUid]);

  // Save composer draft on change
  const handleComposerChange = (text: string) => {
    const currentAuth = auth.currentUser?.uid;
    const currentStore = useStore.getState().uid;
    if (!isConfirmedSession(currentAuth, currentStore, composerState.uid) || !activeChatId) {
      setComposerState(s => ({ ...s, text: '' }));
      return;
    }
    const currentConfirmed = resolveConfirmedUid(currentAuth, currentStore);
    if (!currentConfirmed) return;
    setComposerState(s => ({ ...s, text }));
    setChatDraft(currentConfirmed, activeChatId, text);
  };

  const handleSendMessage = async () => {
    const currentAuth = auth.currentUser?.uid;
    const currentStore = useStore.getState().uid;
    if (!isConfirmedSession(currentAuth, currentStore, composerState.uid)) {
      setActionError('Session changed. Unsent text retained locally.');
      return;
    }
    const sendingUid = resolveConfirmedUid(currentAuth, currentStore);
    if (!sendingUid || !activeChatId || !composerText.trim() || isSending) return;
    const textToSend = composerText;
    setIsSending(true);
    setActionError('');

    try {
      const result = await executeSendMessage({
        chatId: activeChatId,
        text: textToSend,
        expectedSenderUid: sendingUid,
        currentAuthUid: currentAuth,
        currentStoreUid: currentStore,
      });
      if (!result.success) {
        throw new Error(result.error);
      }
      setComposerState(s => ({ ...s, text: '' }));
      clearChatDraft(sendingUid, activeChatId);
      cleanupLegacyChatDraft(activeChatId);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    } catch (err: any) {
      console.warn('[NTK Chat] Send failed:', err);
      setActionError(err?.message?.includes('AUTH_TRANSITION_ABORT')
        ? 'Message not sent: account switched.'
        : 'Message failed to send. Check connection.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleLoadEarlier = async () => {
    if (!activeChatId || messages.length === 0 || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const oldest = messages[0].createdAt;
      const earlier = await loadEarlierMessages(activeChatId, oldest);
      if (earlier.length > 0) {
        setMessages(prev => [...earlier, ...prev]);
        setHasMoreEarlier(earlier.length >= DIRECT_MESSAGE_PAGE_SIZE);
      } else {
        setHasMoreEarlier(false);
      }
    } catch (err) {
      console.warn('[NTK Chat] Could not load earlier messages:', err);
    } finally {
      setLoadingEarlier(false);
    }
  };

  const handleAcceptRequest = async () => {
    if (!activeChatId) return;
    try {
      await acceptChatRequest(activeChatId);
    } catch (err) {
      console.warn('[NTK Chat] Accept failed:', err);
    }
  };

  const handleDeclineRequest = async () => {
    if (!activeChatId) return;
    try {
      await declineChatRequest(activeChatId);
      setActiveChatId(null);
    } catch (err) {
      console.warn('[NTK Chat] Decline failed:', err);
    }
  };

  const handleBlockUser = async () => {
    if (!activeChatId) return;
    try {
      await blockUserInChat(activeChatId);
      setOptionsMenuOpen(false);
    } catch (err) {
      console.warn('[NTK Chat] Block failed:', err);
    }
  };

  const isBlocked = activeChat?.status === 'blocked';
  const iBlockedThis = isBlocked && Boolean(activeChat?.blockedByUids?.includes(myUid));
  const isPendingRequestForMe = activeChat?.status === 'pending' && activeChat.requestedByUid !== myUid;
  const isPendingRequestByMe = activeChat?.status === 'pending' && activeChat.requestedByUid === myUid;

  const formatMessageTime = (rawTime: any) => {
    try {
      const millis = getTimestampMillis(rawTime);
      if (!millis) return '';
      const date = new Date(millis);
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return '';
    }
  };

  if (!currentUser) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <MessageSquare className="w-12 h-12 text-theme-tertiary mb-3" />
        <h2 className="text-lg font-bold text-theme-primary">Sign in to use Messages</h2>
        <p className="text-xs text-theme-secondary mt-1 max-w-sm">
          Private one-to-one messaging requires an authenticated account.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-[var(--app-bg)]">
      
      {/* LEFT COLUMN: Conversation List */}
      <div
        className={`w-full md:w-80 lg:w-96 border-r theme-border flex flex-col shrink-0 bg-[var(--card-bg)] ${
          activeChatId ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* Chat list header */}
        <div className="p-4 border-b theme-divider flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 accent-text" />
            <h2 className="text-base font-bold text-theme-primary">Messages</h2>
          </div>
          <button
            type="button"
            onClick={() => setIsNewMessageOpen(true)}
            className="p-2 rounded-xl accent-button text-xs font-semibold flex items-center gap-1 cursor-pointer"
            aria-label="New message"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">New message</span>
          </button>
        </div>

        {/* Chats list */}
        <div className="flex-1 overflow-y-auto divide-y theme-divider pb-24 md:pb-0">
          {loadingChats ? (
            <div className="p-8 flex flex-col items-center justify-center text-theme-tertiary">
              <LoaderCircle className="w-6 h-6 animate-spin mb-2" />
              <p className="text-xs">Loading conversations...</p>
            </div>
          ) : chats.length === 0 ? (
            <div className="p-8 text-center text-theme-tertiary">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-semibold">No messages yet</p>
              <p className="text-[11px] mt-1">Start a conversation with a collaborator.</p>
              <button
                type="button"
                onClick={() => setIsNewMessageOpen(true)}
                className="mt-4 px-3 py-1.5 rounded-lg accent-button text-xs font-bold"
              >
                Send a message
              </button>
            </div>
          ) : (
            chats.map(chat => {
              const otherUid = chat.participantUids.find(u => u !== myUid);
              const pData = otherUid ? chat.participantData?.[otherUid] : undefined;
              const otherEmail = chat.participantEmails.find(e => e !== currentUser.email) || '';
              const displayName = pData?.name || otherEmail.split('@')[0] || 'User';
              const unread = isChatUnread(chat, myUid);
              const isSelected = chat.id === activeChatId;

              return (
                <button
                  key={chat.id}
                  type="button"
                  onClick={() => setActiveChatId(chat.id)}
                  className={`w-full flex items-center gap-3 p-3.5 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--accent-primary)]/10 border-l-4 border-[var(--accent-primary)]'
                      : 'hover:bg-[var(--app-bg-subtle)]/40'
                  }`}
                >
                  <div className="relative shrink-0">
                    <UserAvatar profile={{ name: displayName, avatar: pData?.photoURL }} size="md" />
                    {unread && (
                      <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--accent-primary)] ring-2 ring-[var(--card-bg)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <p className={`text-xs font-bold truncate ${unread ? 'text-theme-primary font-black' : 'text-theme-primary'}`}>
                        {displayName}
                      </p>
                      {chat.lastMessageAt && (
                        <span className="text-[10px] text-theme-tertiary shrink-0">
                          {formatMessageTime(chat.lastMessageAt)}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs truncate ${unread ? 'font-semibold text-theme-primary' : 'text-theme-tertiary'}`}>
                      {chat.lastMessagePreview || (chat.status === 'pending' ? 'Message request...' : 'No messages yet')}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Active Conversation */}
      <div
        className={`flex-1 flex flex-col bg-[var(--app-bg)] ${
          !activeChatId ? 'hidden md:flex' : 'flex'
        }`}
      >
        {activeChatId && activeChat && otherParticipant ? (
          <>
            {/* Conversation header */}
            <div className="p-3.5 border-b theme-divider bg-[var(--card-bg)] flex items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveChatId(null)}
                  className="md:hidden p-1.5 rounded-lg theme-hover text-theme-secondary cursor-pointer"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <UserAvatar profile={{ name: otherParticipant.name, avatar: otherParticipant.photoURL }} size="sm" />
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-theme-primary truncate">
                    {otherParticipant.name}
                  </h3>
                  <p className="text-[10px] text-theme-tertiary font-mono truncate">
                    {otherParticipant.email}
                  </p>
                </div>
              </div>

              {/* Header options */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOptionsMenuOpen(prev => !prev)}
                  className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer"
                  aria-label="Chat options"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {optionsMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border theme-border bg-[var(--card-bg)] shadow-xl z-50 py-1">
                    <button
                      type="button"
                      onClick={() => void handleBlockUser()}
                      disabled={isBlocked}
                      className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-[var(--app-bg-subtle)] flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      {isBlocked ? 'Conversation blocked' : 'Block contact'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Status banners */}
            {isBlocked && (
              <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center gap-2 text-red-600 dark:text-red-400 text-xs">
                <Ban className="w-4 h-4 shrink-0" />
                <span>This conversation has been blocked. No new messages can be sent or received.</span>
              </div>
            )}

            {isPendingRequestForMe && (
              <div className="bg-amber-500/10 border-b border-amber-500/20 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex flex-col gap-1 text-amber-800 dark:text-amber-200">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500" />
                    <span><strong>{otherParticipant.name}</strong> would like to message you.</span>
                  </div>
                  {activeChat?.requestPreview && (
                    <p className="text-xs italic text-theme-secondary pl-6 border-l-2 border-amber-500/40 my-1 py-0.5">
                      “{activeChat.requestPreview}”
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleAcceptRequest()}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeclineRequest()}
                    className="px-3 py-1.5 rounded-lg border theme-border theme-hover text-xs font-semibold cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5 text-theme-tertiary" />
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleBlockUser()}
                    className="px-3 py-1.5 rounded-lg border border-red-500/30 text-red-600 hover:bg-red-500/10 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Block
                  </button>
                </div>
              </div>
            )}

            {isPendingRequestByMe && (
              <div className="bg-[var(--app-bg-subtle)] border-b theme-divider px-4 py-2 text-xs text-theme-secondary flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-theme-tertiary" />
                <span>Message request sent. Normal messages can be sent once accepted.</span>
              </div>
            )}

            {/* Messages bubbles area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {hasMoreEarlier && (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={() => void handleLoadEarlier()}
                    disabled={loadingEarlier}
                    className="text-xs font-semibold text-theme-secondary hover:text-theme-primary px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] cursor-pointer disabled:opacity-50"
                  >
                    {loadingEarlier ? 'Loading earlier messages...' : 'Load earlier messages'}
                  </button>
                </div>
              )}

              {loadingMessages ? (
                <div className="flex flex-col items-center justify-center p-8 text-theme-tertiary">
                  <LoaderCircle className="w-6 h-6 animate-spin mb-2" />
                  <p className="text-xs">Loading conversation...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-theme-tertiary">
                  <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-xs font-semibold text-theme-secondary">No messages yet</p>
                  <p className="text-[11px] mt-0.5">Say hello to start the conversation.</p>
                </div>
              ) : (
                messages.map(msg => {
                  const isMe = msg.senderUid === myUid;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-xs shadow-xs break-words leading-relaxed ${
                          isMe
                            ? 'accent-button text-white rounded-br-xs'
                            : 'bg-[var(--card-bg)] border theme-border text-theme-primary rounded-bl-xs'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      </div>
                      <span className="text-[10px] text-theme-tertiary mt-1 px-1">
                        {formatMessageTime(msg.createdAt)}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="p-3 border-t theme-divider bg-[var(--card-bg)]">
              {!online && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mb-2 px-1">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Waiting for connection... Draft is preserved locally.</span>
                </div>
              )}

              {actionError && (
                <p className="text-xs text-red-500 mb-2 px-1 font-medium" role="alert">
                  {actionError}
                </p>
              )}

              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={composerText}
                  onChange={e => handleComposerChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isBlocked || activeChat?.status === 'pending' || isSending}
                  placeholder={
                    isBlocked
                      ? (iBlockedThis ? 'You blocked this conversation' : 'This conversation is blocked')
                      : activeChat?.status === 'pending'
                      ? (isPendingRequestByMe ? 'Waiting for recipient to accept request...' : 'Accept the message request above to reply')
                      : 'Type a message... (Enter to send, Shift+Enter for new line)'
                  }
                  rows={1}
                  className="flex-1 max-h-36 min-h-[42px] px-3.5 py-2.5 rounded-xl border theme-input text-xs resize-none focus:outline-none accent-focus disabled:opacity-50"
                  style={{ height: 'auto', minHeight: '42px' }}
                />
                <button
                  type="button"
                  onClick={() => void handleSendMessage()}
                  disabled={isBlocked || activeChat?.status === 'pending' || isSending || !composerText.trim()}
                  className="p-2.5 rounded-xl accent-button text-white flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
                  aria-label="Send message"
                >
                  {isSending ? (
                    <LoaderCircle className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>

              {composerText.length > 3500 && (
                <p className="text-[10px] text-theme-tertiary text-right mt-1">
                  {composerText.length} / {DIRECT_MESSAGE_MAX_CHARS}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-theme-tertiary">
            <MessageSquare className="w-12 h-12 mb-3 opacity-30" />
            <h3 className="text-sm font-bold text-theme-secondary">Private Messages</h3>
            <p className="text-xs max-w-sm mt-1">
              Select a conversation from the list or start a new message to collaborate securely.
            </p>
            <button
              type="button"
              onClick={() => setIsNewMessageOpen(true)}
              className="mt-4 px-4 py-2 rounded-xl accent-button text-xs font-bold cursor-pointer"
            >
              Start conversation
            </button>
          </div>
        )}
      </div>

      {/* New Message Dialog */}
      <NewMessageModal
        isOpen={isNewMessageOpen}
        onClose={() => setIsNewMessageOpen(false)}
        onChatSelected={chatId => {
          setActiveChatId(chatId);
          setIsNewMessageOpen(false);
        }}
      />
    </div>
  );
}
