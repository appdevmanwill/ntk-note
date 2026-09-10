import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '@/store';
import { auth } from '@/utils/firebase';
import {
  Sparkles,
  Send,
  Square,
  Copy,
  Check,
  FilePlus2,
  RotateCcw,
  MessageSquare,
  Plus,
  Trash2,
  User,
  X,
  FileText,
  History,
  LoaderCircle,
  WifiOff,
  Wand2,
  Lightbulb,
  ArrowDown,
} from 'lucide-react';
import { requestNtkAi } from '@/utils/ntkAi';
import FriendlyAiOutput, { sanitizeAiText } from './FriendlyAiOutput';
import type { AiThread, AiTurn } from '@/types';
import {
  createAiThread,
  fetchAiThreads,
  fetchAiTurns,
  loadEarlierAiTurns,
  saveCompletedAiTurn,
  deleteAiThread,
} from '@/utils/aiChatService';
import {
  AI_CONTEXT_RECENT_TURNS,
  AI_PROMPT_MAX_CHARS,
  AI_TURN_PAGE_SIZE,
} from '@/utils/freeZoneConstants';

const defaultStarters = [
  { icon: Lightbulb, title: 'Help me plan something', prompt: 'Help me create a step-by-step plan for: ' },
  { icon: Wand2, title: 'Explain something simply', prompt: 'Explain this concept in simple, accessible language: ' },
  { icon: FileText, title: 'Improve my writing', prompt: 'Help me review and polish this writing for clarity and tone: ' },
  { icon: Sparkles, title: 'Brainstorm ideas', prompt: 'Brainstorm 5 creative and practical ideas for: ' },
];

export default function AiAssistantView() {
  const {
    createNote,
    notes,
    updateNote,
    settings,
    aiNoteContext,
    setAiNoteContext,
    online,
  } = useStore();

  const currentUser = auth.currentUser;
  const uid = currentUser?.uid || '';

  const [threads, setThreads] = useState<AiThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingTurns, setLoadingTurns] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMoreTurns, setHasMoreTurns] = useState(false);

  // Active generation state
  const [prompt, setPrompt] = useState('');
  const [streamingUserText, setStreamingUserText] = useState('');
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null);
  const [insertedTurnId, setInsertedTurnId] = useState<string | null>(null);

  // Mobile drawer for thread history
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load user threads on mount or auth change
  useEffect(() => {
    if (!uid) {
      setThreads([]);
      setActiveThreadId(null);
      return;
    }

    let isMounted = true;
    setLoadingThreads(true);
    fetchAiThreads(uid)
      .then(loaded => {
        if (!isMounted) return;
        setThreads(loaded);
        // If there's an existing thread and none selected, or if starting fresh
        if (loaded.length > 0 && !activeThreadId && !aiNoteContext) {
          setActiveThreadId(loaded[0].id);
        }
      })
      .catch(err => console.warn('[NTK AI] Threads fetch error:', err))
      .finally(() => {
        if (isMounted) setLoadingThreads(false);
      });

    return () => {
      isMounted = false;
    };
  }, [uid]);

  // Load turns when activeThreadId changes
  useEffect(() => {
    if (!uid || !activeThreadId) {
      setTurns([]);
      setLoadingTurns(false);
      return;
    }

    let isMounted = true;
    setLoadingTurns(true);
    setHasMoreTurns(false);

    fetchAiTurns(uid, activeThreadId)
      .then(loaded => {
        if (!isMounted) return;
        setTurns(loaded);
        setHasMoreTurns(loaded.length >= AI_TURN_PAGE_SIZE);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      })
      .catch(err => console.warn('[NTK AI] Turns fetch error:', err))
      .finally(() => {
        if (isMounted) setLoadingTurns(false);
      });

    return () => {
      isMounted = false;
    };
  }, [uid, activeThreadId]);

  const activeThread = useMemo(() => {
    return threads.find(t => t.id === activeThreadId) || null;
  }, [threads, activeThreadId]);

  const handleStartNewChat = () => {
    if (isGenerating) {
      abortControllerRef.current?.abort();
    }
    setActiveThreadId(null);
    setTurns([]);
    setPrompt('');
    setStreamingUserText('');
    setStreamingAnswer('');
    setStatusMessage('');
    setShowHistoryDrawer(false);
  };

  const handleSelectThread = (threadId: string) => {
    if (isGenerating) {
      abortControllerRef.current?.abort();
    }
    setActiveThreadId(threadId);
    setStreamingUserText('');
    setStreamingAnswer('');
    setStatusMessage('');
    setShowHistoryDrawer(false);
  };

  const handleDeleteThread = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    if (!uid) return;
    try {
      await deleteAiThread(uid, threadId);
      setThreads(prev => prev.filter(t => t.id !== threadId));
      if (activeThreadId === threadId) {
        handleStartNewChat();
      }
    } catch (err) {
      console.warn('[NTK AI] Delete thread failed:', err);
    }
  };

  const handleLoadEarlierTurns = async () => {
    if (!uid || !activeThreadId || turns.length === 0 || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const oldestTurn = turns[0];
      const earlier = await loadEarlierAiTurns(uid, activeThreadId, oldestTurn.createdAt);
      if (earlier.length > 0) {
        setTurns(prev => [...earlier, ...prev]);
        setHasMoreTurns(earlier.length >= AI_TURN_PAGE_SIZE);
      } else {
        setHasMoreTurns(false);
      }
    } catch (err) {
      console.warn('[NTK AI] Load earlier turns error:', err);
    } finally {
      setLoadingEarlier(false);
    }
  };

  // Stop current generation
  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Send turn (either from input or retry)
  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt ?? prompt).trim();
    if (!textToSend || isGenerating) return;

    if (!online) {
      setStatusMessage('NTK AI needs an internet connection. Your message is still here.');
      return;
    }

    setPrompt('');
    setIsGenerating(true);
    setStreamingUserText(textToSend);
    setStreamingAnswer('');
    setStatusMessage('Getting your answer ready…');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let targetThreadId = activeThreadId;

    try {
      // If no active thread yet, create one first
      if (!targetThreadId && uid) {
        const newThread = await createAiThread(uid, textToSend, {
          noteId: aiNoteContext?.noteId,
          noteTitle: aiNoteContext?.noteTitle,
        });
        targetThreadId = newThread.id;
        setActiveThreadId(newThread.id);
        setThreads(prev => [newThread, ...prev]);
      }

      // Build context messages from recent turns (up to AI_CONTEXT_RECENT_TURNS)
      const recentTurns = turns.slice(-AI_CONTEXT_RECENT_TURNS);
      const contextMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      recentTurns.forEach(turn => {
        if (turn.userText) {
          contextMessages.push({ role: 'user', content: turn.userText });
        }
        if (turn.assistantText) {
          contextMessages.push({ role: 'assistant', content: turn.assistantText });
        }
      });

      const historyContext = recentTurns
        .map(t => `User: ${t.userText}\nAssistant: ${t.assistantText}`)
        .join('\n\n');

      const fullPrompt = [
        historyContext ? `Previous conversation:\n${historyContext}` : null,
        `User: ${textToSend}`,
      ].filter(Boolean).join('\n\n');

      let accumulatedAnswer = '';

      // Stream exclusively in browser memory (CRITICAL SPARK LOCK: NO FIRESTORE TOKENS)
      await requestNtkAi(
        {
          task: 'ask',
          text: fullPrompt,
          messages: [
            ...contextMessages,
            { role: 'user', content: textToSend },
          ],
          noteTitle: aiNoteContext?.noteTitle,
          noteContext: aiNoteContext?.noteContent,
          writingStyle: settings.aiWritingStyle,
        },
        {
          onStatus: msg => setStatusMessage(msg),
          onDelta: delta => {
            accumulatedAnswer += delta;
            setStreamingAnswer(accumulatedAnswer);
          },
        },
        controller.signal
      );

      // Once finished streaming, persist ONE turn to Firestore
      if (uid && targetThreadId && accumulatedAnswer.trim()) {
        const savedTurn = await saveCompletedAiTurn(
          uid,
          targetThreadId,
          textToSend,
          accumulatedAnswer,
          'completed'
        );
        setTurns(prev => [...prev, savedTurn]);
        // Update thread preview in local list
        setThreads(prev =>
          prev.map(t =>
            t.id === targetThreadId
              ? { ...t, updatedAt: new Date().toISOString(), preview: accumulatedAnswer.slice(0, 80) }
              : t
          )
        );
      }

      setStreamingUserText('');
      setStreamingAnswer('');
      setStatusMessage('');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatusMessage('Stopped.');
        // If some text was accumulated before stop, persist it cleanly
        if (uid && targetThreadId && streamingAnswer.trim()) {
          const savedTurn = await saveCompletedAiTurn(
            uid,
            targetThreadId,
            textToSend,
            streamingAnswer,
            'stopped'
          );
          setTurns(prev => [...prev, savedTurn]);
        }
      } else {
        const msg = err instanceof Error ? err.message : 'NTK AI is temporarily unavailable.';
        setStatusMessage(msg);
      }
      setStreamingUserText('');
      setStreamingAnswer('');
    } finally {
      setIsGenerating(false);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }
  };

  const handleRetry = (turn: AiTurn) => {
    if (isGenerating) return;
    void handleSend(turn.userText);
  };

  const handleCopy = async (turnId: string, text: string) => {
    const clean = sanitizeAiText(text);
    await navigator.clipboard.writeText(clean);
    setCopiedTurnId(turnId);
    setTimeout(() => setCopiedTurnId(null), 1800);
  };

  const handleSaveAsNote = async (text: string) => {
    const clean = sanitizeAiText(text);
    const title = activeThread?.title || 'NTK AI Note';
    await createNote({
      title,
      content: clean,
      type: 'note',
    });
  };

  const handleInsertIntoNote = (turnId: string, text: string) => {
    const clean = sanitizeAiText(text);
    const noteIdToUse = aiNoteContext?.noteId || useStore.getState().selectedNoteId;
    if (!noteIdToUse) return;

    const targetNote = notes.find(n => n.id === noteIdToUse);
    if (!targetNote) return;

    const updatedContent = targetNote.content.trim()
      ? `${targetNote.content}\n\n${clean}`
      : clean;

    updateNote(targetNote.id, { content: updatedContent });
    setInsertedTurnId(turnId);
    setTimeout(() => setInsertedTurnId(null), 1800);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-[var(--app-bg)]">

      {/* LEFT COLUMN: Thread History (Desktop: always visible, Mobile: Drawer) */}
      <div
        className={`fixed inset-y-0 left-0 z-40 md:static md:z-auto w-72 lg:w-80 bg-[var(--card-bg)] border-r theme-border flex flex-col transition-transform duration-200 ${
          showHistoryDrawer ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Thread history header */}
        <div className="p-3.5 border-b theme-divider flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg ai-orb text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-xs font-bold text-theme-primary">Conversations</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleStartNewChat}
              className="p-1.5 rounded-lg accent-button text-xs font-semibold flex items-center gap-1 cursor-pointer"
              title="New Chat"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
            <button
              type="button"
              onClick={() => setShowHistoryDrawer(false)}
              className="md:hidden p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer"
              aria-label="Close history drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto divide-y theme-divider">
          {loadingThreads ? (
            <div className="p-8 flex flex-col items-center justify-center text-theme-tertiary">
              <LoaderCircle className="w-5 h-5 animate-spin mb-1.5" />
              <p className="text-xs">Loading history...</p>
            </div>
          ) : threads.length === 0 ? (
            <div className="p-6 text-center text-theme-tertiary">
              <MessageSquare className="w-7 h-7 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-semibold">No chats yet</p>
              <p className="text-[11px] mt-0.5">Start a new conversation with NTK AI.</p>
            </div>
          ) : (
            threads.map(t => {
              const isSelected = t.id === activeThreadId;
              return (
                <div
                  key={t.id}
                  onClick={() => handleSelectThread(t.id)}
                  className={`group flex items-center justify-between p-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--accent-primary)]/10 border-l-4 border-[var(--accent-primary)]'
                      : 'hover:bg-[var(--app-bg-subtle)]/40'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <p className={`text-xs font-bold truncate ${isSelected ? 'accent-text' : 'text-theme-primary'}`}>
                      {t.title}
                    </p>
                    <p className="text-[10px] text-theme-tertiary truncate mt-0.5">
                      {t.preview || 'No messages'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={e => void handleDeleteThread(e, t.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md theme-hover text-theme-tertiary hover:text-red-500 transition-opacity shrink-0"
                    title="Delete chat"
                    aria-label="Delete chat conversation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Backdrop for mobile drawer */}
      {showHistoryDrawer && (
        <div
          onClick={() => setShowHistoryDrawer(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-xs md:hidden"
        />
      )}

      {/* RIGHT COLUMN: Active Chat Conversation */}
      <div className="flex-1 flex flex-col bg-[var(--app-bg)] min-w-0">

        {/* Top Chat Bar */}
        <div className="p-3 border-b theme-divider bg-[var(--card-bg)] flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setShowHistoryDrawer(true)}
              className="md:hidden p-1.5 rounded-lg theme-hover text-theme-secondary cursor-pointer"
              aria-label="Open chat history"
            >
              <History className="w-4 h-4" />
            </button>

            <span className="flex h-7 w-7 items-center justify-center rounded-xl ai-orb text-white shadow-xs shrink-0">
              <Sparkles className="h-4 w-4" />
            </span>

            <div className="min-w-0">
              <h2 className="text-xs font-bold text-theme-primary truncate">
                {activeThread?.title || 'NTK AI Chat'}
              </h2>
            </div>
          </div>

          {/* Context Pill & Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {aiNoteContext?.noteTitle && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 text-[11px] font-semibold text-theme-primary">
                <FileText className="w-3 h-3 accent-text" />
                <span className="truncate max-w-[120px] sm:max-w-[180px]">
                  Using: {aiNoteContext.noteTitle}
                </span>
                <button
                  type="button"
                  onClick={() => setAiNoteContext(null)}
                  className="p-0.5 rounded-full hover:bg-[var(--accent-primary)]/20 cursor-pointer"
                  title="Remove note context"
                  aria-label="Remove note context"
                >
                  <X className="w-3 h-3 text-theme-tertiary" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleStartNewChat}
              className="px-3 py-1.5 rounded-xl border theme-border theme-hover text-xs font-semibold text-theme-secondary flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Chat</span>
            </button>
          </div>
        </div>

        {/* Chat turns scroll area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

          {/* Load Earlier button */}
          {hasMoreTurns && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void handleLoadEarlierTurns()}
                disabled={loadingEarlier}
                className="px-3 py-1.5 rounded-xl border theme-border bg-[var(--card-bg)] text-xs font-semibold text-theme-secondary cursor-pointer disabled:opacity-50"
              >
                {loadingEarlier ? 'Loading earlier turns...' : 'Load earlier messages'}
              </button>
            </div>
          )}

          {loadingTurns && (
            <div className="flex flex-col items-center justify-center p-8 text-theme-tertiary">
              <LoaderCircle className="w-5 h-5 animate-spin mb-1.5" />
              <p className="text-xs">Loading conversation...</p>
            </div>
          )}

          {/* Empty Conversation / Welcome screen */}
          {!loadingTurns && turns.length === 0 && !streamingUserText && !isGenerating && (
            <div className="max-w-2xl mx-auto py-8 text-center space-y-6">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl ai-orb text-white shadow-xl">
                <Sparkles className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-xl font-black text-theme-primary">How can NTK AI help you today?</h3>
                <p className="text-xs text-theme-tertiary mt-1.5 max-w-md mx-auto">
                  Conversational assistance for writing, organizing, simplifying, and thinking through notes.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left pt-2">
                {defaultStarters.map(starter => {
                  const Icon = starter.icon;
                  return (
                    <button
                      key={starter.title}
                      type="button"
                      onClick={() => void handleSend(starter.prompt)}
                      className="p-3.5 rounded-2xl border theme-border theme-card hover:border-[var(--accent-primary)] transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="w-4 h-4 accent-text" />
                        <span className="text-xs font-bold text-theme-primary">{starter.title}</span>
                      </div>
                      <p className="text-[11px] text-theme-tertiary truncate">{starter.prompt}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Existing Turns */}
          {turns.map(turn => (
            <div key={turn.id} className="space-y-4 max-w-3xl mx-auto">
              {/* User Message */}
              <div className="flex justify-end items-start gap-2.5">
                <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-xs shadow-xs accent-button text-white rounded-br-xs break-words leading-relaxed whitespace-pre-wrap">
                  {turn.userText}
                </div>
                <div className="w-7 h-7 rounded-full bg-[var(--app-bg-subtle)] border theme-border flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-theme-tertiary" />
                </div>
              </div>

              {/* Assistant Message */}
              <div className="flex justify-start items-start gap-2.5">
                <div className="w-7 h-7 rounded-xl ai-orb text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <div className="max-w-[85%] sm:max-w-[80%] flex flex-col gap-2">
                  <div className="rounded-2xl px-4 py-3.5 text-xs shadow-xs bg-[var(--card-bg)] border theme-border text-theme-primary rounded-bl-xs leading-relaxed">
                    <FriendlyAiOutput content={turn.assistantText} />
                  </div>

                  {/* Action buttons on response */}
                  <div className="flex flex-wrap items-center gap-1.5 px-1">
                    <button
                      type="button"
                      onClick={() => void handleCopy(turn.id, turn.assistantText)}
                      className="p-1.5 px-2 rounded-lg border theme-border theme-hover text-[11px] font-semibold text-theme-secondary flex items-center gap-1 cursor-pointer"
                      title="Copy response"
                    >
                      {copiedTurnId === turn.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-theme-tertiary" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRetry(turn)}
                      disabled={isGenerating}
                      className="p-1.5 px-2 rounded-lg border theme-border theme-hover text-[11px] font-semibold text-theme-secondary flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Retry this prompt"
                    >
                      <RotateCcw className="w-3 h-3 text-theme-tertiary" />
                      <span>Retry</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleSaveAsNote(turn.assistantText)}
                      className="p-1.5 px-2 rounded-lg border theme-border theme-hover text-[11px] font-semibold text-theme-secondary flex items-center gap-1 cursor-pointer"
                      title="Save as note"
                    >
                      <FilePlus2 className="w-3 h-3 text-theme-tertiary" />
                      <span>Save as note</span>
                    </button>

                    {aiNoteContext?.noteId && (
                      <button
                        type="button"
                        onClick={() => handleInsertIntoNote(turn.id, turn.assistantText)}
                        className="p-1.5 px-2 rounded-lg border theme-border theme-hover text-[11px] font-semibold text-theme-secondary flex items-center gap-1 cursor-pointer"
                        title="Insert response into current note"
                      >
                        {insertedTurnId === turn.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-500" />
                            <span className="text-emerald-600 dark:text-emerald-400">Inserted</span>
                          </>
                        ) : (
                          <>
                            <ArrowDown className="w-3 h-3 text-theme-tertiary" />
                            <span>Insert into note</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Currently Streaming Turn (Zero Firestore Writes until complete!) */}
          {isGenerating && streamingUserText && (
            <div className="space-y-4 max-w-3xl mx-auto animate-fade-in">
              {/* User text */}
              <div className="flex justify-end items-start gap-2.5">
                <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-xs shadow-xs accent-button text-white rounded-br-xs break-words leading-relaxed whitespace-pre-wrap">
                  {streamingUserText}
                </div>
                <div className="w-7 h-7 rounded-full bg-[var(--app-bg-subtle)] border theme-border flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-theme-tertiary" />
                </div>
              </div>

              {/* Streaming Assistant output */}
              <div className="flex justify-start items-start gap-2.5">
                <div className="w-7 h-7 rounded-xl ai-orb text-white flex items-center justify-center shrink-0 shadow-xs mt-0.5 animate-pulse">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <div className="max-w-[85%] sm:max-w-[80%] flex flex-col gap-2">
                  <div className="rounded-2xl px-4 py-3.5 text-xs shadow-xs bg-[var(--card-bg)] border theme-border text-theme-primary rounded-bl-xs leading-relaxed">
                    {streamingAnswer ? (
                      <FriendlyAiOutput content={streamingAnswer} />
                    ) : (
                      <div className="flex items-center gap-2 text-theme-tertiary py-1">
                        <LoaderCircle className="w-4 h-4 animate-spin text-[var(--accent-primary)]" />
                        <span>{statusMessage || 'Thinking...'}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Composer area */}
        <div className="p-3 sm:p-4 border-t theme-divider bg-[var(--card-bg)]">
          <div className="max-w-3xl mx-auto">
            {!online && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 mb-2 px-1">
                <WifiOff className="w-3.5 h-3.5" />
                <span>NTK AI needs an internet connection. Your message is still here.</span>
              </div>
            )}

            {statusMessage && !isGenerating && (
              <p className="text-xs text-theme-tertiary mb-2 px-1">{statusMessage}</p>
            )}

            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isGenerating}
                placeholder={isGenerating ? 'NTK AI is replying...' : 'Ask NTK AI anything... (Enter to send, Shift+Enter for new line)'}
                rows={1}
                className="flex-1 max-h-36 min-h-[44px] px-3.5 py-2.5 rounded-xl border theme-input text-xs resize-none focus:outline-none accent-focus disabled:opacity-50"
                style={{ height: 'auto', minHeight: '44px' }}
              />

              {isGenerating ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="px-3.5 py-2.5 rounded-xl border theme-border theme-hover text-xs font-bold text-red-500 flex items-center gap-1.5 cursor-pointer shrink-0"
                  aria-label="Stop generation"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!prompt.trim()}
                  className="p-2.5 rounded-xl ai-button text-white flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
                  aria-label="Send prompt"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>

            {prompt.length > 7000 && (
              <p className="text-[10px] text-theme-tertiary text-right mt-1">
                {prompt.length} / {AI_PROMPT_MAX_CHARS}
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
