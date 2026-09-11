import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '@/store';
import type { ChecklistItem, NoteColor, Notebook, Priority } from '@/types';
import { noteColors, priorityConfig } from '@/utils/colors';
import {
  exportToPDF,
  copyAsPlainText,
  copyAsMarkdown,
  copyAsHTML,
  shareViaEmail,
  printNote,
  loadNoteExportOptions,
  saveNoteExportOptions,
  loadLastExportFormat,
  saveLastExportFormat,
  type NoteExportFormat,
  type NoteExportOptions,
} from '@/utils/export';
import { getBacklinks, noteDisplayTitle } from '@/utils/links';
import { compressImageDataUrl, compressImageFile } from '@/utils/imageCompression';
import { canEditRole, getEntityRole, roleLabels } from '@/utils/collaboration';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { v4 as uuid } from 'uuid';
import {
  ArrowLeft, Bold, Italic, Underline, Strikethrough, List,
  ListOrdered, Heading1, Heading2, Heading3, Quote, Code,
  Minus, Link, Pin, Star, MoreHorizontal, Palette,
  Tag, Bell, CheckSquare, Trash2, Archive, Copy,
  Download, Share2, Mail, FileText, Type, Hash,
  X, Plus, Clock, AlertCircle, Eye, Edit3,
  Maximize2, Minimize2, Sparkles, PanelRightClose,
  Lock, Unlock, ShieldCheck, Link2, Mic, PenTool, FileCode,
  Undo2, Redo2, History, Cloud, Search, Check, Paperclip, File as FileIcon, Loader2,
  Image as ImageIcon, Play, Pause, Volume2, Square, ChevronDown, MessageSquare,
  type LucideIcon
} from 'lucide-react';
import { format } from 'date-fns';
import { noteThemes } from '@/utils/noteThemes';
import type { NoteAttachment, NoteImage, NoteVoiceNote } from '@/types';
import { uploadStorageFile, openOrDownloadStorageFile, deleteStorageFile, downloadStorageFile, getAudioExtensionFromMime, compressImage } from '@/utils/cloudStorage';
import { enqueueOfflineMedia, resolveOfflineMediaObjectUrl, removeOfflineMedia } from '@/utils/offlineMediaQueue';
import { saveCrashJournal } from '@/utils/durableOutbox';
import { transcribeAudio } from '@/utils/ntkAi';
import SketchModal from './SketchModal';
import ShareModal from './ShareModal';
import NoteCollaborationPanel from './NoteCollaborationPanel';
import VersionHistory, { saveCloudNoteCheckpoint, saveLocalNoteSnapshot, useVersionHistory, type NoteVersion } from './VersionHistory';
import NtkAiPanel from './NtkAiPanel';
import ListenPlayer from './ListenPlayer';
import TranscriptReviewModal from './TranscriptReviewModal';

const isMarkdown = (text: string): boolean => {
  if (!text) return false;
  const headingPattern = /^#+\s+.+/m;
  const boldPattern = /\*\*([^*]+)\*\*/;
  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/;
  const codeBlockPattern = /```[\s\S]*?```/;
  return (
    headingPattern.test(text) ||
    boldPattern.test(text) ||
    linkPattern.test(text) ||
    codeBlockPattern.test(text)
  );
};

const convertMarkdownToPlainText = (md: string): string => {
  let text = md;

  // Convert headers: e.g. # Header -> HEADER, ## Subheader -> SUBHEADER
  text = text.replace(/^#\s+(.+)$/gm, (_, p1) => {
    return `${p1.toUpperCase()}\n${'='.repeat(Math.max(p1.length, 10))}`;
  });
  text = text.replace(/^##\s+(.+)$/gm, (_, p1) => {
    return `${p1.toUpperCase()}\n${'-'.repeat(Math.max(p1.length, 10))}`;
  });
  text = text.replace(/^###\s+(.+)$/gm, (_, p1) => {
    return `${p1.toUpperCase()}`;
  });
  text = text.replace(/^####+\s+(.+)$/gm, (_, p1) => {
    return `${p1}`;
  });

  // Convert Bold / Italic / Bold+Italic
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/___([^_]+)___/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');

  // Convert Strikethrough
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Convert Inline Code
  text = text.replace(/`([^`]+)`/g, '$1');

  // Convert Links: [text](url) -> text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Convert Images: ![alt](url) -> [Image: alt]
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[Image: $1]');

  // Convert Lists: bullets - / * -> •
  text = text.replace(/^[-*]\s+(.+)$/gm, '• $1');

  // Convert Blockquotes: remove > prefix
  text = text.replace(/^>\s+(.+)$/gm, '  $1');

  // Strip table delimiters
  text = text.replace(/^[|]/gm, '');
  text = text.replace(/[|]$/gm, '');
  text = text.replace(/[|]/g, '  ');
  text = text.replace(/^\s*[:-|-]+\s*$/gm, '');

  return text;
};

const convertMarkdownToHTML = (md: string): string => {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headings
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^####+\s+(.+)$/gm, '<h4>$1</h4>');

  // Bold / Italic
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Code Blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline Code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // Lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');

  // Paragraphs
  html = html.replace(/^(?!<(h\d|li|pre|code|del|a|img|ul|ol))(.+)$/gm, '<p>$2</p>');

  return html;
};

type NoteDraft = {
  title: string;
  content: string;
};

type NotebookMoveRow = {
  notebook: Notebook;
  depth: number;
};

type ActionToast = {
  id: number;
  message: string;
  undo?: () => void;
};

export default function NoteEditor({ onCollapsePanel }: { onCollapsePanel?: () => void }) {
  const {
    uid, selectedNoteId, notes, updateNote, createNote, selectNote, trashNote, restoreNote,
    archiveNote, unarchiveNote, pinNote, starNote, duplicateNote,
    setNoteColor, setNotePriority, addNoteTag, removeNoteTag,
    addChecklistItem, updateChecklistItem, removeChecklistItem,
    setNoteReminder, settings, toggleZenMode, notebooks, moveNote,
    setEditingNote, setNoteTheme,
    lockNote, unlockNote, relockNote, updateUnlockedNote, unlockedNotes,
    profile,
  } = useStore();

  const note = notes.find(n => n.id === selectedNoteId);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [showToolbar] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [showReminder, setShowReminder] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [showPriority, setShowPriority] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showMovePanel, setShowMovePanel] = useState(false);
  const [notebookSearch, setNotebookSearch] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [isPreview, setIsPreview] = useState(false);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [showLockDialog, setShowLockDialog] = useState(false);
  const [lockPassword, setLockPassword] = useState('');
  const [lockHint, setLockHint] = useState('');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [lockBusy, setLockBusy] = useState(false);

  const SpeechRecognition = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const isSpeechSupported = !!SpeechRecognition;

  const [isListening, setIsListening] = useState(false);
  const [showSketchModal, setShowSketchModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiSelection, setAiSelection] = useState<{ start: number; end: number; text: string }>({ start: 0, end: 0, text: '' });
  const [versionHistoryPresentation, setVersionHistoryPresentation] = useState<'modal' | 'panel'>('modal');
  const [versionStatus, setVersionStatus] = useState('');
  const [actionToast, setActionToast] = useState<ActionToast | null>(null);
  const [exportOptions, setExportOptions] = useState<NoteExportOptions>(() => loadNoteExportOptions());
  const [lastExportFormat, setLastExportFormat] = useState<NoteExportFormat | null>(() => loadLastExportFormat());
  const [showAdvancedFormats, setShowAdvancedFormats] = useState(false);
  const [activeFormat, setActiveFormat] = useState<'rich' | 'plain' | 'code' | 'html'>('plain');
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedLightboxImage, setSelectedLightboxImage] = useState<{ id: string; name: string; url: string; caption?: string } | null>(null);

  // Audio Intelligence & UX state
  const [listenPlayerOpen, setListenPlayerOpen] = useState(false);
  const [listenText, setListenText] = useState('');
  const [isListenSelection, setIsListenSelection] = useState(false);
  const [transcribingVoiceId, setTranscribingVoiceId] = useState<string | null>(null);
  const [transcribingFile, setTranscribingFile] = useState(false);
  const [reviewTranscript, setReviewTranscript] = useState<{ text: string; audioName: string; voiceNoteId?: string } | null>(null);
  const [isMediaExpanded, setIsMediaExpanded] = useState(true);
  const [showAddMediaMenu, setShowAddMediaMenu] = useState(false);
  const [isCollaborationExpanded, setIsCollaborationExpanded] = useState(false);
  const [showMoreFormatting, setShowMoreFormatting] = useState(false);
  const [showMobileFormatSheet, setShowMobileFormatSheet] = useState(false);

  // Voice Note Recorder & Player State
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isVoicePaused, setIsVoicePaused] = useState(false);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [_voiceUploading, setVoiceUploading] = useState(false);
  const [activeVoicePlayerId, setActiveVoicePlayerId] = useState<string | null>(null);
  const [voicePlaybackRate, setVoicePlaybackRate] = useState<number>(1);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [resolvedImageUrls, setResolvedImageUrls] = useState<Record<string, string>>({});
  const [resolvedVoiceUrls, setResolvedVoiceUrls] = useState<Record<string, string>>({});

  const contentRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const movePanelRef = useRef<HTMLDivElement>(null);
  const exportPanelRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const undoStackRef = useRef<NoteDraft[]>([]);
  const redoStackRef = useRef<NoteDraft[]>([]);
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false });
  const unlockedNote = note ? unlockedNotes[note.id] : undefined;
  const isLocked = !!note?.encrypted && !unlockedNote;
  const activeChecklist = note?.encrypted && unlockedNote ? unlockedNote.checklist : note?.checklist || [];
  const accessRole = note ? getEntityRole(note, profile.email, uid) : 'owner';
  const canEditNote = canEditRole(accessRole);
  useVersionHistory(note?.id || null, title, content, uid);

  const autoResizeTextarea = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const minH = Math.max(window.innerHeight - 280, 320);
    el.style.height = `${Math.max(minH, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    autoResizeTextarea();
  }, [content, activeFormat, autoResizeTextarea]);

  useEffect(() => {
    const handleFocusKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && settings.zenMode) {
        toggleZenMode();
      }
    };
    window.addEventListener('keydown', handleFocusKey);
    return () => window.removeEventListener('keydown', handleFocusKey);
  }, [settings.zenMode, toggleZenMode]);

  const showActionToast = useCallback((message: string, undo?: () => void) => {
    const id = Date.now();
    setActionToast({ id, message, undo });
    window.setTimeout(() => {
      setActionToast(current => current?.id === id ? null : current);
    }, 5000);
  }, []);

  // Lazy-resolve images into Blob URLs (with IndexedDB fallback for offline items)
  useEffect(() => {
    if (!note?.images || note.images.length === 0) return;
    let active = true;
    const currentUid = uid || 'guest';
    note.images.forEach(img => {
      if (resolvedImageUrls[img.id]) return;
      if (img.objectId && img.objectId.startsWith('local-')) {
        resolveOfflineMediaObjectUrl(img.id, currentUid)
          .then(url => {
            if (active && url) {
              setResolvedImageUrls(prev => ({ ...prev, [img.id]: url }));
            }
          })
          .catch(() => undefined);
      } else if (img.objectId) {
        downloadStorageFile('images', img.objectId, img.name)
          .then(blob => {
            if (!active) return;
            const url = URL.createObjectURL(blob);
            setResolvedImageUrls(prev => ({ ...prev, [img.id]: url }));
          })
          .catch(() => {
            // Try IndexedDB as fallback
            resolveOfflineMediaObjectUrl(img.id, currentUid).then(url => {
              if (active && url) setResolvedImageUrls(prev => ({ ...prev, [img.id]: url }));
            }).catch(() => undefined);
          });
      }
    });
    return () => {
      active = false;
    };
  }, [note?.images, uid, resolvedImageUrls]);

  // Lazy-resolve offline voice notes into in-memory Blob URLs
  useEffect(() => {
    if (!note?.voiceNotes || note.voiceNotes.length === 0) return;
    let active = true;
    const currentUid = uid || 'guest';
    note.voiceNotes.forEach(vn => {
      if (resolvedVoiceUrls[vn.id]) return;
      if (vn.objectId && vn.objectId.startsWith('local-')) {
        resolveOfflineMediaObjectUrl(vn.id, currentUid)
          .then(url => {
            if (active && url) {
              setResolvedVoiceUrls(prev => ({ ...prev, [vn.id]: url }));
            }
          })
          .catch(() => undefined);
      }
    });
    return () => {
      active = false;
    };
  }, [note?.voiceNotes, uid, resolvedVoiceUrls]);

  const updateExportOption = useCallback((key: keyof NoteExportOptions, value: boolean) => {
    const next = { ...exportOptions, [key]: value };
    setExportOptions(next);
    saveNoteExportOptions(next);
  }, [exportOptions]);

  const runSyncedAction = useCallback((action: () => void | Promise<void>, message: string, undo?: () => void) => {
    void Promise.resolve(action()).then(() => showActionToast(message, undo));
  }, [showActionToast]);

  const refreshHistoryStatus = useCallback(() => {
    setHistoryStatus({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);

  const pushHistory = useCallback((draft: NoteDraft) => {
    const last = undoStackRef.current[undoStackRef.current.length - 1];
    if (last?.title === draft.title && last.content === draft.content) return;
    undoStackRef.current = [...undoStackRef.current.slice(-99), draft];
    redoStackRef.current = [];
    refreshHistoryStatus();
  }, [refreshHistoryStatus]);

  // Auto-save
  const saveNote = useCallback((t: string, c: string, immediate = false) => {
    if (!note || !canEditNote) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!settings.autoSave && !immediate) return;
    if (immediate) {
      if (note.encrypted && unlockedNote) {
        updateUnlockedNote(note.id, { title: t, content: c }, true);
      } else {
        updateNote(note.id, { title: t, content: c }, true);
      }
      return;
    }
    saveTimerRef.current = setTimeout(() => {
      if (note.encrypted && unlockedNote) {
        updateUnlockedNote(note.id, { title: t, content: c });
      } else {
        updateNote(note.id, { title: t, content: c });
      }
    }, 300);
  }, [canEditNote, note?.id, note?.encrypted, unlockedNote, updateNote, updateUnlockedNote, settings.autoSave]);

  const undoNoteChange = useCallback(() => {
    const previous = undoStackRef.current[undoStackRef.current.length - 1];
    if (!previous) return;

    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current.slice(-99), { title, content }];
    setTitle(previous.title);
    setContent(previous.content);
    saveNote(previous.title, previous.content, true);
    refreshHistoryStatus();
  }, [content, refreshHistoryStatus, saveNote, title]);

  const redoNoteChange = useCallback(() => {
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    if (!next) return;

    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-99), { title, content }];
    setTitle(next.title);
    setContent(next.content);
    saveNote(next.title, next.content, true);
    refreshHistoryStatus();
  }, [content, refreshHistoryStatus, saveNote, title]);

  const updateContentWithHistory = useCallback((nextContent: string) => {
    if (!canEditNote) return;
    pushHistory({ title, content });
    setContent(nextContent);
    saveNote(title, nextContent);
  }, [canEditNote, content, pushHistory, saveNote, title]);

  const noteIdRef = useRef<string | null>(null);
  const stateRef = useRef({ title, content, notes, unlockedNotes });

  // Update ref with latest values to keep useEffect clean
  useEffect(() => {
    stateRef.current = { title, content, notes, unlockedNotes };
  }, [title, content, notes, unlockedNotes]);

  // Load note data and flush previous note changes
  useEffect(() => {
    const { title: currentTitle, content: currentContent, notes: currentNotes, unlockedNotes: currentUnlockedNotes } = stateRef.current;

    // Flush any unsaved changes for the previous note immediately
    if (noteIdRef.current && noteIdRef.current !== note?.id) {
      const prevNote = currentNotes.find(n => n.id === noteIdRef.current);
      if (prevNote) {
        const isEncrypted = !!prevNote.encrypted;
        const prevUnlocked = currentUnlockedNotes[prevNote.id];
        const currentStoredTitle = isEncrypted && prevUnlocked ? prevUnlocked.title : prevNote.title;
        const currentStoredContent = isEncrypted && prevUnlocked ? prevUnlocked.content : prevNote.content;

        if (currentTitle !== currentStoredTitle || currentContent !== currentStoredContent) {
          if (isEncrypted && prevUnlocked) {
            updateUnlockedNote(prevNote.id, { title: currentTitle, content: currentContent }, true);
          } else {
            updateNote(prevNote.id, { title: currentTitle, content: currentContent }, true);
          }
        }
      }
    }

    noteIdRef.current = note?.id || null;

    if (note) {
      setTitle(unlockedNote?.title ?? note.title);
      setContent(unlockedNote?.content ?? note.content);
      undoStackRef.current = [];
      redoStackRef.current = [];
      refreshHistoryStatus();
      setIsPreview(false);
      if (note.reminder?.time) {
        const d = new Date(note.reminder.time);
        if (Number.isFinite(d.getTime())) {
          setReminderDate(format(d, 'yyyy-MM-dd'));
          setReminderTime(format(d, 'HH:mm'));
        }
      } else {
        const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
        setReminderDate(format(d, 'yyyy-MM-dd'));
        setReminderTime('09:00');
      }
      if (note.type === 'markdown') {
        setActiveFormat('rich');
      } else {
        setActiveFormat('plain');
      }
    }
  }, [note?.id, unlockedNote?.title, unlockedNote?.content, refreshHistoryStatus, updateNote, updateUnlockedNote]);

  // Flush any pending changes when component unmounts
  useEffect(() => {
    const flushCurrentEdits = () => {
      if (noteIdRef.current) {
        const { title: currentTitle, content: currentContent, notes: currentNotes, unlockedNotes: currentUnlockedNotes } = stateRef.current;
        const prevNote = currentNotes.find(n => n.id === noteIdRef.current);
        if (prevNote) {
          const isEncrypted = !!prevNote.encrypted;
          const prevUnlocked = currentUnlockedNotes[prevNote.id];
          const currentStoredTitle = isEncrypted && prevUnlocked ? prevUnlocked.title : prevNote.title;
          const currentStoredContent = isEncrypted && prevUnlocked ? prevUnlocked.content : prevNote.content;

          if (currentTitle !== currentStoredTitle || currentContent !== currentStoredContent) {
            if (isEncrypted && prevUnlocked) {
              updateUnlockedNote(prevNote.id, { title: currentTitle, content: currentContent }, true);
            } else {
              updateNote(prevNote.id, { title: currentTitle, content: currentContent }, true);
            }
            saveCrashJournal(uid || 'guest', prevNote.id, {
              title: currentTitle,
              content: currentContent,
              updatedAt: new Date().toISOString(),
              baseUpdatedAt: prevNote.updatedAt,
            });
          }
        }
      }
    };

    window.addEventListener('beforeunload', flushCurrentEdits);
    window.addEventListener('pagehide', flushCurrentEdits);

    return () => {
      flushCurrentEdits();
      window.removeEventListener('beforeunload', flushCurrentEdits);
      window.removeEventListener('pagehide', flushCurrentEdits);
    };
  }, [updateNote, updateUnlockedNote]);

  const appendDictationText = useCallback((textToAppend: string) => {
    if (!canEditNote) return;
    const el = contentRef.current;
    const spacing = textToAppend.startsWith(' ') ? '' : ' ';
    const formattedText = spacing + textToAppend.trim();
    
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.slice(0, start) + formattedText + content.slice(end);
      updateContentWithHistory(newContent);
      const newCursorPos = start + formattedText.length;
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    } else {
      const newContent = content ? content + formattedText : textToAppend.trim();
      updateContentWithHistory(newContent);
    }
  }, [canEditNote, content, updateContentWithHistory]);

  const toggleListening = () => {
    if (!isSpeechSupported || !canEditNote) return;
    
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
    } else {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';
      
      rec.onstart = () => {
        setIsListening(true);
      };
      
      rec.onresult = (event: any) => {
        const transcript = event.results[event.resultIndex][0].transcript;
        if (transcript) {
          appendDictationText(transcript);
        }
      };
      
      rec.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };
      
      rec.onend = () => {
        setIsListening(false);
      };
      
      recognitionRef.current = rec;
      rec.start();
    }
  };

  const insertImageMarkdown = useCallback((dataUrl: string, alt = 'Image') => {
    if (!canEditNote) return;
    const el = contentRef.current;
    const imgMarkdown = `\n![${alt}](${dataUrl})\n`;
    if (el) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.slice(0, start) + imgMarkdown + content.slice(end);
      updateContentWithHistory(newContent);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + imgMarkdown.length, start + imgMarkdown.length);
      }, 0);
    } else {
      const newContent = content ? content + imgMarkdown : imgMarkdown;
      updateContentWithHistory(newContent);
    }
  }, [canEditNote, content, updateContentWithHistory]);

  const handleInsertDrawing = (dataUrl: string) => {
    if (!canEditNote) return;
    void compressImageDataUrl(dataUrl)
      .then(compressed => insertImageMarkdown(compressed, 'Sketch'))
      .catch(() => insertImageMarkdown(dataUrl, 'Sketch'));
  };

  const handleInsertImageFile = (file: File) => {
    if (!canEditNote) return;
    void compressImageFile(file)
      .then(compressed => {
        if (compressed.length > 700000) {
          showActionToast('Image is still large after compression. Keep it in cloud storage and paste the link.');
          return;
        }
        insertImageMarkdown(compressed, file.name || 'Image');
      })
      .catch(error => {
        console.error('Image compression failed', error);
        setVersionStatus('Image compression failed. Try a smaller image.');
        window.setTimeout(() => setVersionStatus(''), 3000);
      });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!note || !canEditNote) return;

    const imageFile = Array.from(e.clipboardData.files).find(file => file.type.startsWith('image/'));
    if (imageFile) {
      e.preventDefault();
      handleInsertImageFile(imageFile);
      return;
    }

    if (note.type !== 'note') return; // only for regular notes

    const pastedData = e.clipboardData.getData('text/plain');
    if (isMarkdown(pastedData)) {
      e.preventDefault();
      const converted = convertMarkdownToPlainText(pastedData);
      
      // Insert at selection
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const newContent = content.slice(0, start) + converted + content.slice(end);
      updateContentWithHistory(newContent);
      
      const newCursorPos = start + converted.length;
      setTimeout(() => {
        el.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);
    }
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const handleTitleChange = (val: string) => {
    if (!canEditNote) return;
    pushHistory({ title, content });
    setTitle(val);
    saveNote(val, content);
  };

  const handleAddAttachmentClick = () => {
    fileInputRef.current?.click();
  };

  const handleAttachmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !note || !canEditNote) return;
    const file = files[0];
    setUploadingAttachment(true);
    const tempId = uuid();
    const currentUid = uid || 'guest';
    try {
      const res = await uploadStorageFile(file, 'attachments', file.name, note.id);
      const newAttachment: NoteAttachment = {
        id: tempId,
        name: res.fileName,
        size: res.size,
        mimeType: res.mimeType,
        objectId: res.objectId,
        url: res.url,
        createdAt: res.createdAt,
      };
      const nextAttachments = [...(note.attachments || []), newAttachment];
      updateNote(note.id, { attachments: nextAttachments });
      showActionToast(`Added attachment "${file.name}"`);
    } catch {
      // Durable offline persistence
      await enqueueOfflineMedia({
        id: tempId,
        uid: currentUid,
        noteId: note.id,
        purpose: 'attachments',
        blob: file,
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name,
      });
      const offlineAtt: NoteAttachment = {
        id: tempId,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        objectId: 'local-' + tempId,
        url: '',
        createdAt: new Date().toISOString(),
        pendingUpload: true,
      };
      const nextAttachments = [...(note.attachments || []), offlineAtt];
      updateNote(note.id, { attachments: nextAttachments });
      showActionToast("Saved on this device. I'll upload it when you're back online.");
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenAttachment = async (att: NoteAttachment) => {
    if (!att.objectId) {
      showActionToast('Attachment reference is unavailable.');
      return;
    }
    const currentUid = uid || 'guest';
    if (att.objectId.startsWith('local-')) {
      const localUrl = await resolveOfflineMediaObjectUrl(att.id, currentUid);
      if (localUrl) {
        window.open(localUrl, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    void openOrDownloadStorageFile('attachments', att.objectId, att.name).catch(error => {
      showActionToast(error instanceof Error ? error.message : 'Failed to download file.');
    });
  };

  const handleRemoveAttachment = async (att: NoteAttachment) => {
    if (!note || !canEditNote) return;
    const currentUid = uid || 'guest';
    if (att.objectId && !att.objectId.startsWith('local-')) {
      void deleteStorageFile('attachments', att.objectId).catch(() => undefined);
    } else {
      void removeOfflineMedia(att.id, currentUid);
    }
    const nextAttachments = (note.attachments || []).filter(a => a.id !== att.id);
    updateNote(note.id, { attachments: nextAttachments });
    showActionToast(`Removed "${att.name}"`);
  };

  // --- Image Handlers ---
  const handleAddImageClick = () => {
    imageInputRef.current?.click();
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !note || !canEditNote) return;
    const file = files[0];
    setUploadingImage(true);
    const tempId = uuid();
    const currentUid = uid || 'guest';
    try {
      const { blob, width, height, mimeType } = await compressImage(file);
      const res = await uploadStorageFile(blob, 'images', file.name, note.id);
      const newImage: NoteImage = {
        id: tempId,
        name: res.fileName,
        size: res.size,
        mimeType: res.mimeType || mimeType || 'image/webp',
        objectId: res.objectId,
        storageKey: res.path,
        width,
        height,
        createdAt: res.createdAt,
      };
      const nextImages = [...(note.images || []), newImage];
      updateNote(note.id, { images: nextImages });
      showActionToast(`Added photo "${file.name}"`);
    } catch {
      // Durable offline persistence
      try {
        const { blob, width, height, mimeType } = await compressImage(file);
        await enqueueOfflineMedia({
          id: tempId,
          uid: currentUid,
          noteId: note.id,
          purpose: 'images',
          blob,
          mimeType: mimeType || 'image/webp',
          fileName: file.name,
          metadata: { width, height },
        });
        const localBlobUrl = URL.createObjectURL(blob);
        setResolvedImageUrls(prev => ({ ...prev, [tempId]: localBlobUrl }));
        const offlineImage: NoteImage = {
          id: tempId,
          name: file.name,
          size: blob.size,
          mimeType: mimeType || 'image/webp',
          objectId: 'local-' + tempId,
          width,
          height,
          createdAt: new Date().toISOString(),
          pendingUpload: true,
        };
        const nextImages = [...(note.images || []), offlineImage];
        updateNote(note.id, { images: nextImages });
        showActionToast("Saved on this device. I'll upload it when you're back online.");
      } catch (innerErr) {
        showActionToast(innerErr instanceof Error ? innerErr.message : 'Could not save image.');
      }
    } finally {
      setUploadingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (img: NoteImage) => {
    if (!note || !canEditNote) return;
    const currentUid = uid || 'guest';
    if (img.objectId && !img.objectId.startsWith('local-')) {
      void deleteStorageFile('images', img.objectId).catch(() => undefined);
    } else {
      void removeOfflineMedia(img.id, currentUid);
    }
    const nextImages = (note.images || []).filter(i => i.id !== img.id);
    updateNote(note.id, { images: nextImages });
    showActionToast(`Removed photo "${img.name}"`);
  };

  const handleUpdateImageCaption = (imgId: string, caption: string) => {
    if (!note || !canEditNote) return;
    const nextImages = (note.images || []).map(img => img.id === imgId ? { ...img, caption } : img);
    updateNote(note.id, { images: nextImages });
  };

  // --- Voice Note Handlers ---
  const voiceDurationTick = useCallback(() => {
    setVoiceDuration(prev => {
      const maxSec = (settings.voiceNoteMaxDurationMinutes || 15) * 60;
      if (prev + 1 >= maxSec) {
        stopVoiceRecording();
        return prev + 1;
      }
      return prev + 1;
    });
  }, [settings.voiceNoteMaxDurationMinutes]);

  const startVoiceRecording = async () => {
    if (!canEditNote) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        stream.getTracks().forEach(track => track.stop());
        const durationSec = voiceDuration;
        const noteId = note?.id;
        if (!noteId) return;

        setVoiceUploading(true);
        const ext = getAudioExtensionFromMime(mimeType);
        const baseTitle = `Voice Note ${format(new Date(), 'MMM d, h.mm a')}`;
        const fileName = `${baseTitle}${ext}`;
        const tempId = uuid();
        const currentUid = uid || 'guest';

        try {
          const res = await uploadStorageFile(audioBlob, 'voiceNotes', fileName, noteId);
          const newVoiceNote: NoteVoiceNote = {
            id: tempId,
            title: baseTitle,
            durationSeconds: durationSec || 1,
            size: res.size,
            mimeType: res.mimeType || mimeType,
            objectId: res.objectId,
            storageKey: res.path,
            createdAt: res.createdAt,
          };
          const currentNote = useStore.getState().notes.find(n => n.id === noteId);
          const nextVoiceNotes = [...(currentNote?.voiceNotes || []), newVoiceNote];
          updateNote(noteId, { voiceNotes: nextVoiceNotes });
          showActionToast(`Voice note saved.`);
        } catch {
          // Durable offline persistence in IndexedDB
          await enqueueOfflineMedia({
            id: tempId,
            uid: currentUid,
            noteId,
            purpose: 'voiceNotes',
            blob: audioBlob,
            mimeType,
            fileName,
            metadata: { durationSeconds: durationSec || 1, title: baseTitle },
          });
          const localBlobUrl = URL.createObjectURL(audioBlob);
          setResolvedVoiceUrls(prev => ({ ...prev, [tempId]: localBlobUrl }));
          const offlineVoiceNote: NoteVoiceNote = {
            id: tempId,
            title: baseTitle,
            durationSeconds: durationSec || 1,
            size: audioBlob.size,
            mimeType,
            objectId: 'local-' + tempId,
            createdAt: new Date().toISOString(),
            pendingUpload: true,
          };
          const currentNote = useStore.getState().notes.find(n => n.id === noteId);
          const nextVoiceNotes = [...(currentNote?.voiceNotes || []), offlineVoiceNote];
          updateNote(noteId, { voiceNotes: nextVoiceNotes });
          showActionToast("Saved on this device. I'll upload it when you're back online.");
        } finally {
          setVoiceUploading(false);
          setIsRecordingVoice(false);
          setIsVoicePaused(false);
          setVoiceDuration(0);
        }
      };

      recorder.start(1000);
      setIsRecordingVoice(true);
      setIsVoicePaused(false);
      setVoiceDuration(0);

      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = setInterval(voiceDurationTick, 1000);
    } catch {
      showActionToast('Could not access microphone. Please check permissions.');
    }
  };

  const pauseVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsVoicePaused(true);
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
    }
  };

  const resumeVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsVoicePaused(false);
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = setInterval(voiceDurationTick, 1000);
    }
  };

  const stopVoiceRecording = () => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const cancelVoiceRecording = () => {
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    setIsRecordingVoice(false);
    setIsVoicePaused(false);
    setVoiceDuration(0);
    showActionToast('Voice recording discarded.');
  };

  const handleRemoveVoiceNote = (voiceNote: NoteVoiceNote) => {
    if (!note || !canEditNote) return;
    const currentUid = uid || 'guest';
    if (voiceNote.objectId && !voiceNote.objectId.startsWith('local-')) {
      void deleteStorageFile('voiceNotes', voiceNote.objectId).catch(() => undefined);
    } else {
      void removeOfflineMedia(voiceNote.id, currentUid);
    }
    const nextVoiceNotes = (note.voiceNotes || []).filter(v => v.id !== voiceNote.id);
    updateNote(note.id, { voiceNotes: nextVoiceNotes });
    showActionToast(`Removed voice note "${voiceNote.title}"`);
  };

  const handleRenameVoiceNote = (voiceNoteId: string, newTitle: string) => {
    if (!note || !canEditNote || !newTitle.trim()) return;
    const nextVoiceNotes = (note.voiceNotes || []).map(v => v.id === voiceNoteId ? { ...v, title: newTitle.trim() } : v);
    updateNote(note.id, { voiceNotes: nextVoiceNotes });
  };

  const togglePlayVoiceNote = async (voiceNote: NoteVoiceNote) => {
    if (activeVoicePlayerId === voiceNote.id) {
      const existing = voiceAudioElementsRef.current.get(voiceNote.id);
      if (existing) {
        existing.pause();
        existing.currentTime = 0;
      }
      setActiveVoicePlayerId(null);
      return;
    }

    // Stop any existing playing audio
    voiceAudioElementsRef.current.forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });

    let src = resolvedVoiceUrls[voiceNote.id];
    const currentUid = uid || 'guest';
    if (!src && voiceNote.id) {
      const localUrl = await resolveOfflineMediaObjectUrl(voiceNote.id, currentUid);
      if (localUrl) {
        src = localUrl;
        setResolvedVoiceUrls(prev => ({ ...prev, [voiceNote.id]: src }));
      }
    }
    if (!src && voiceNote.objectId && !voiceNote.objectId.startsWith('local-')) {
      try {
        const ext = getAudioExtensionFromMime(voiceNote.mimeType || 'audio/webm');
        const blob = await downloadStorageFile('voiceNotes', voiceNote.objectId, `${voiceNote.title}${ext}`);
        src = URL.createObjectURL(blob);
        setResolvedVoiceUrls(prev => ({ ...prev, [voiceNote.id]: src }));
      } catch {
        showActionToast('Could not load voice recording audio.');
        return;
      }
    }

    if (!src) return;

    let audio = voiceAudioElementsRef.current.get(voiceNote.id);
    if (!audio) {
      audio = new Audio(src);
      audio.playbackRate = voicePlaybackRate;
      audio.onended = () => setActiveVoicePlayerId(null);
      voiceAudioElementsRef.current.set(voiceNote.id, audio);
    } else {
      audio.src = src;
      audio.playbackRate = voicePlaybackRate;
    }

    try {
      await audio.play();
      setActiveVoicePlayerId(voiceNote.id);
    } catch {
      showActionToast('Could not play audio.');
    }
  };

  const cyclePlaybackRate = (voiceNoteId: string) => {
    const rates = [1, 1.5, 2];
    const nextRate = rates[(rates.indexOf(voicePlaybackRate) + 1) % rates.length];
    setVoicePlaybackRate(nextRate);
    const audio = voiceAudioElementsRef.current.get(voiceNoteId);
    if (audio) audio.playbackRate = nextRate;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleContentChange = (val: string) => {
    if (!canEditNote) return;
    updateContentWithHistory(val);
  };

  const openAiPanel = () => {
    if (!settings.aiEnabled || isLocked) return;
    const el = contentRef.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    setAiSelection({ start, end, text: content.slice(start, end) });
    setShowAiPanel(true);
  };

  const replaceAiSelection = (value: string) => {
    if (!canEditNote) return;
    const before = content.slice(0, aiSelection.start);
    const after = content.slice(aiSelection.end);
    updateContentWithHistory(`${before}${value}${after}`);
  };

  const insertAiBelow = (value: string) => {
    if (!canEditNote) return;
    const suffix = content.trim() ? `\n\n${value}` : value;
    updateContentWithHistory(`${content}${suffix}`);
  };

  const handleListenClick = () => {
    if (isLocked) return;
    const el = contentRef.current;
    const start = el?.selectionStart ?? 0;
    const end = el?.selectionEnd ?? 0;
    const selected = (end > start) ? content.slice(start, end).trim() : '';
    const textToListen = selected || content.trim() || title;
    if (!textToListen) {
      alert('There is no text in this note to listen to.');
      return;
    }
    setListenText(textToListen);
    setIsListenSelection(!!selected);
    setListenPlayerOpen(true);
  };

  const handleSaveListenAudio = async (blob: Blob, durationSeconds: number) => {
    if (!note) return;
    const fileName = `listen-${Date.now()}.mp3`;
    const voiceId = uuid();
    let objectId: string | undefined;
    let pendingUpload = false;

    try {
      const res = await uploadStorageFile(blob, 'voiceNotes', fileName, note.id);
      objectId = res.objectId;
    } catch {
      await enqueueOfflineMedia({
        id: voiceId,
        noteId: note.id,
        uid: uid || 'guest',
        purpose: 'voiceNotes',
        fileName,
        blob,
        mimeType: 'audio/mp3',
      });
      objectId = `local-${voiceId}`;
      pendingUpload = true;
    }

    const newVoiceNote: NoteVoiceNote = {
      id: voiceId,
      title: `Spoken: ${(title || 'Note').slice(0, 25)}`,
      durationSeconds: Math.round(durationSeconds),
      createdAt: new Date().toISOString(),
      size: blob.size,
      mimeType: 'audio/mp3',
      objectId: objectId || `local-${voiceId}`,
      pendingUpload,
      source: 'generated-tts',
    };

    const nextVoiceNotes = [...(note.voiceNotes || []), newVoiceNote];
    updateNote(note.id, { voiceNotes: nextVoiceNotes });
  };

  const handleTranscribeVoiceNote = async (vn: NoteVoiceNote) => {
    if (!note) return;
    setTranscribingVoiceId(vn.id);
    try {
      let result;
      if (vn.objectId && !vn.objectId.startsWith('local-')) {
        result = await transcribeAudio({ objectId: vn.objectId, purpose: 'voiceNotes' });
      } else {
        const localUrl = resolvedVoiceUrls[vn.id] || vn.localBlobUrl;
        if (localUrl) {
          const resp = await fetch(localUrl);
          const blob = await resp.blob();
          result = await transcribeAudio({ file: blob });
        } else {
          throw new Error('Local audio file could not be read.');
        }
      }
      setReviewTranscript({
        text: result.text,
        audioName: vn.title,
        voiceNoteId: vn.id,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Transcription could not be completed.');
    } finally {
      setTranscribingVoiceId(null);
    }
  };

  const handleTranscribeAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setTranscribingFile(true);
    try {
      const result = await transcribeAudio({ file });
      setReviewTranscript({
        text: result.text,
        audioName: file.name,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Transcription could not be completed.');
    } finally {
      setTranscribingFile(false);
    }
  };

  const handleSaveTranscriptToVoiceNote = (transcriptText: string, voiceNoteId?: string) => {
    if (!note || !voiceNoteId || !note.voiceNotes) return;
    const updated = note.voiceNotes.map(vn =>
      vn.id === voiceNoteId
        ? { ...vn, transcript: transcriptText, transcribedAt: Date.now() }
        : vn
    );
    updateNote(note.id, { voiceNotes: updated });
  };

  const handleCreateNoteFromTranscript = async (transcriptText: string) => {
    if (!note) return;
    const newNote = await createNote({
      notebookId: note.notebookId || 'default',
      title: `Transcript: ${(reviewTranscript?.audioName || 'Audio').slice(0, 30)}`,
      content: transcriptText,
      type: 'note',
    });
    selectNote(newNote.id);
  };

  // Toolbar actions for rich text in textarea
  const insertFormatting = (before: string, after: string = '') => {
    if (!canEditNote) return;
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    let wrapStart = start;
    let wrapEnd = end;
    let selected = content.slice(start, end);

    if (!selected && after) {
      const beforeCursor = content.slice(0, start);
      const afterCursor = content.slice(start);
      wrapStart = beforeCursor.search(/\S+$/);
      if (wrapStart === -1) wrapStart = start;
      const nextSpace = afterCursor.search(/\s/);
      wrapEnd = nextSpace === -1 ? content.length : start + nextSpace;
      selected = content.slice(wrapStart, wrapEnd);
    }

    const newContent = content.slice(0, wrapStart) + before + selected + after + content.slice(wrapEnd);
    updateContentWithHistory(newContent);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(wrapStart + before.length, wrapStart + before.length + selected.length);
    }, 0);
  };

  const insertAtLineStart = (prefix: string) => {
    if (!canEditNote) return;
    const el = contentRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const newContent = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    updateContentWithHistory(newContent);
  };

  const handleAddTag = () => {
    if (!canEditNote) return;
    const nextTag = tagInput.trim();
    if (nextTag && note) {
      void addNoteTag(note.id, nextTag).then(() => {
        showActionToast(`Added #${nextTag}.`, () => void removeNoteTag(note.id, nextTag));
      });
      setTagInput('');
    }
  };

  const handleSetReminder = async () => {
    if (!canEditNote) return;
    if (note) {
      const targetDate = reminderDate || format(new Date(Date.now() + 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
      const targetTime = reminderTime || '09:00';
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission().catch(() => undefined);
      }
      const time = new Date(`${targetDate}T${targetTime}`).toISOString();
      await setNoteReminder(note.id, {
        id: note.reminder?.id || uuid(),
        noteId: note.id,
        time,
        title: note.title || 'Reminder',
        triggered: false,
      });
      setShowReminder(false);
    }
  };

  const handleAddChecklistItem = () => {
    if (!canEditNote) return;
    if (note && newChecklistItem.trim()) {
      if (note.encrypted && unlockedNote) {
        const item: ChecklistItem = {
          id: uuid(),
          text: newChecklistItem.trim(),
          checked: false,
          order: unlockedNote.checklist.length,
        };
        updateUnlockedNote(note.id, { checklist: [...unlockedNote.checklist, item] });
      } else {
        addChecklistItem(note.id, newChecklistItem.trim());
      }
      setNewChecklistItem('');
    }
  };

  const handleChecklistUpdate = (itemId: string, updates: Partial<ChecklistItem>) => {
    if (!note || !canEditNote) return;
    if (note.encrypted && unlockedNote) {
      updateUnlockedNote(note.id, {
        checklist: unlockedNote.checklist.map(item => item.id === itemId ? { ...item, ...updates } : item),
      });
      return;
    }
    updateChecklistItem(note.id, itemId, updates);
  };

  const handleChecklistRemove = (itemId: string) => {
    if (!note || !canEditNote) return;
    if (note.encrypted && unlockedNote) {
      updateUnlockedNote(note.id, {
        checklist: unlockedNote.checklist.filter(item => item.id !== itemId),
      });
      return;
    }
    removeChecklistItem(note.id, itemId);
  };

  const handleChecklistReorder = (targetItemId: string, draggedItemId: string) => {
    if (!note || !canEditNote || draggedItemId === targetItemId) return;
    const items = [...activeChecklist].sort((a, b) => a.order - b.order);
    const draggedIdx = items.findIndex(item => item.id === draggedItemId);
    if (draggedIdx < 0) return;
    const [draggedItem] = items.splice(draggedIdx, 1);
    const targetIdx = items.findIndex(item => item.id === targetItemId);
    if (targetIdx < 0) return;
    items.splice(targetIdx, 0, draggedItem);
    const reordered = items.map((item, order) => ({ ...item, order }));
    if (note.encrypted && unlockedNote) {
      updateUnlockedNote(note.id, { checklist: reordered });
      return;
    }
    useStore.getState().reorderChecklist(note.id, reordered.map(item => item.id));
  };

  const handleSaveLocalSnapshot = (source: 'manual' | 'cloud-checkpoint' = 'manual') => {
    if (!note) return;
    saveLocalNoteSnapshot(note.id, title, content, source, uid);
    setVersionStatus(source === 'cloud-checkpoint' ? 'Cloud checkpoint saved.' : 'Local snapshot saved.');
    if (source === 'manual') showActionToast('Local snapshot saved on this device.');
    window.setTimeout(() => setVersionStatus(''), 3000);
  };

  const handleCloudCheckpoint = async () => {
    if (!note || !canEditNote) return;
    saveNote(title, content, true);
    if (note.encrypted) {
      handleSaveLocalSnapshot('cloud-checkpoint');
      showActionToast('Encrypted note checkpoint kept on this device.');
      return;
    }
    try {
      await saveCloudNoteCheckpoint(uid, note.id, title, content);
      setVersionStatus('Cloud checkpoint saved.');
      showActionToast(uid ? 'Cloud checkpoint synced.' : 'Cloud checkpoint saved locally. Sign in to sync it.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud checkpoint failed.';
      setVersionStatus(message);
      showActionToast(message);
    }
    window.setTimeout(() => setVersionStatus(''), 3000);
  };

  const openVersionHistory = () => {
    const useDesktopPanel = typeof window !== 'undefined' && window.innerWidth >= 1280;
    setVersionHistoryPresentation(useDesktopPanel ? 'panel' : 'modal');
    setShowVersionHistory(true);
    setShowMenu(false);
    setShowMoveMenu(false);
    setShowMovePanel(false);
    setShowExportMenu(false);
    setShowExportPanel(false);
  };

  const handlePinToggle = () => {
    if (!note || !canEditNote) return;
    const wasPinned = note.pinned;
    runSyncedAction(
      () => pinNote(note.id),
      wasPinned ? 'Note unpinned.' : 'Note pinned.',
      () => void pinNote(note.id)
    );
  };

  const handleStarToggle = () => {
    if (!note || !canEditNote) return;
    const wasStarred = note.starred;
    runSyncedAction(
      () => starNote(note.id),
      wasStarred ? 'Note removed from starred.' : 'Note starred.',
      () => void starNote(note.id)
    );
  };

  const handleArchiveToggle = () => {
    if (!note || !canEditNote) return;
    const noteId = note.id;
    if (note.archived) {
      runSyncedAction(
        () => unarchiveNote(noteId),
        'Note unarchived.',
        () => void archiveNote(noteId)
      );
    } else {
      runSyncedAction(
        () => archiveNote(noteId),
        'Note archived.',
        () => void unarchiveNote(noteId)
      );
    }
    setShowMenu(false);
  };

  const handleTrashNote = () => {
    if (!note || !canEditNote) return;
    const noteId = note.id;
    runSyncedAction(
      () => trashNote(noteId),
      'Note moved to Recycle Bin.',
      () => {
        void restoreNote(noteId);
        selectNote(noteId);
        setEditingNote(true);
      }
    );
    setShowMenu(false);
  };

  const handleDuplicateNote = () => {
    if (!note || !canEditNote) return;
    const sourceId = note.id;
    void duplicateNote(sourceId).then(duplicate => {
      if (!duplicate) return;
      showActionToast('Note duplicated.', () => void trashNote(duplicate.id));
    });
    setShowMenu(false);
  };

  const closeMoveSurface = () => {
    setShowMoveMenu(false);
    setShowMovePanel(false);
    setNotebookSearch('');
  };

  const openMoveDialog = () => {
    if (!canEditNote) return;
    const useDesktopPanel = typeof window !== 'undefined' && window.innerWidth >= 1280;
    setNotebookSearch('');
    setShowMenu(false);
    setShowColorPicker(false);
    setShowThemePicker(false);
    setShowPriority(false);
    setShowExportMenu(false);
    setShowExportPanel(false);

    if (useDesktopPanel) {
      setShowMovePanel(true);
      setShowMoveMenu(false);
      return;
    }

    setShowMoveMenu(true);
    setShowMovePanel(false);
  };

  const closeExportSurface = () => {
    setShowExportMenu(false);
    setShowExportPanel(false);
    setShowMenu(false);
  };

  const exportFormatLabels: Record<NoteExportFormat, string> = {
    pdf: 'PDF',
    print: 'print view',
    plain: 'plain text',
    markdown: 'Markdown',
    html: 'HTML',
    email: 'email draft',
  };

  const runExportAction = (format: NoteExportFormat, action: () => void | Promise<void>) => {
    saveLastExportFormat(format);
    setLastExportFormat(format);
    void Promise.resolve(action()).then(() => {
      showActionToast(`Exported ${exportFormatLabels[format]}.`);
    });
    closeExportSurface();
  };

  const openExportSurface = () => {
    const useDesktopPanel = typeof window !== 'undefined' && window.innerWidth >= 1280;
    setShowColorPicker(false);
    setShowThemePicker(false);
    setShowPriority(false);

    if (useDesktopPanel) {
      setShowExportPanel(true);
      setShowExportMenu(false);
      setShowMovePanel(false);
      setShowMoveMenu(false);
      setShowMenu(false);
      return;
    }

    setShowExportMenu(previous => !previous);
  };

  const handleMoveToNotebook = (notebookId: string) => {
    if (!note) return;
    const previousNotebookId = note.notebookId;
    if (note.notebookId !== notebookId) {
      const targetNotebook = notebooks.find(nb => nb.id === notebookId);
      void moveNote(note.id, notebookId).then(() => {
        showActionToast(
          `Moved to ${targetNotebook?.name || 'notebook'}.`,
          () => void moveNote(note.id, previousNotebookId)
        );
      });
    }
    closeMoveSurface();
  };

  const handleRestoreVersion = (version: NoteVersion) => {
    setTitle(version.title);
    setContent(version.content);
    saveNote(version.title, version.content, true);
    setVersionStatus('Version restored.');
    window.setTimeout(() => setVersionStatus(''), 3000);
  };

  const handleLockNote = async () => {
    if (!note || !lockPassword.trim()) return;
    setLockBusy(true);
    setLockError('');
    const ok = await lockNote(note.id, lockPassword, lockHint);
    setLockBusy(false);
    if (!ok) {
      setLockError('Enter a password to lock this note.');
      return;
    }
    setShowLockDialog(false);
    setLockPassword('');
    setLockHint('');
    setShowMenu(false);
  };

  const handleUnlockNote = async () => {
    if (!note || !unlockPassword.trim()) return;
    setLockBusy(true);
    setLockError('');
    const ok = await unlockNote(note.id, unlockPassword);
    setLockBusy(false);
    if (!ok) {
      setLockError('That password did not unlock this note.');
      return;
    }
    setUnlockPassword('');
  };

  // Close menus on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideMenu = menuRef.current?.contains(target);
      const insideMovePanel = movePanelRef.current?.contains(target);
      const insideExportPanel = exportPanelRef.current?.contains(target);

      if (!insideMenu && !insideMovePanel && !insideExportPanel) {
        setShowMenu(false);
        setShowColorPicker(false);
        setShowThemePicker(false);
        setShowPriority(false);
        setShowMovePanel(false);
        setShowExportMenu(false);
        setShowExportPanel(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!note) return;
      if (e.key === 'Escape') {
        setShowMenu(false);
        setShowColorPicker(false);
        setShowThemePicker(false);
        setShowPriority(false);
        setShowMoveMenu(false);
        setShowMovePanel(false);
        setShowExportMenu(false);
        setShowExportPanel(false);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redoNoteChange();
          else undoNoteChange();
          return;
        }
        if (key === 'y') {
          e.preventDefault();
          redoNoteChange();
          return;
        }
        if (key === 'b') { e.preventDefault(); insertFormatting('**', '**'); }
        if (key === 'i') { e.preventDefault(); insertFormatting('*', '*'); }
        if (key === 'u') { e.preventDefault(); insertFormatting('<u>', '</u>'); }
        if (key === 'k') { e.preventDefault(); insertFormatting('[', '](url)'); }
        if (key === 's') { e.preventDefault(); saveNote(title, content, true); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [note, content, title, saveNote, undoNoteChange, redoNoteChange]);

  if (!note) {
    return (
      <div className="relative flex-1 flex items-center justify-center" style={{ backgroundColor: 'var(--app-bg)' }}>
        {onCollapsePanel && (
          <button
            type="button"
            onClick={onCollapsePanel}
            className="hidden xl:inline-flex absolute right-4 top-4 p-2 rounded-xl theme-hover text-theme-tertiary"
            title="Collapse editor panel"
            aria-label="Collapse editor panel"
          >
            <PanelRightClose className="w-5 h-5 no-transition" />
          </button>
        )}
        <div className="text-center">
          <FileText className="w-16 h-16 mx-auto mb-4 no-transition" style={{ color: 'var(--text-muted)' }} />
          <h3 className="text-lg font-medium text-theme-secondary">Select a note to edit</h3>
          <p className="text-sm text-theme-tertiary mt-1">Or create a new one to get started</p>
        </div>
        <ActionToastView toast={actionToast} onClose={() => setActionToast(null)} />
      </div>
    );
  }

  const notebook = notebooks.find(nb => nb.id === note.notebookId);
  const activeNoteTheme = note.theme || settings.defaultNoteTheme || 'canvas';
  const backlinks = getBacklinks(note.id, notes);
  const notebookQuery = notebookSearch.trim().toLowerCase();
  const visibleNotebooks = notebooks.filter(nb => !nb.trashed);
  const notebookRows: NotebookMoveRow[] = [];
  const visitedNotebookIds = new Set<string>();
  const sortNotebookRows = (items: typeof visibleNotebooks) =>
    [...items].sort((a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      a.name.localeCompare(b.name)
    );
  const pushNotebookRows = (parentId: string | null, depth: number) => {
    sortNotebookRows(visibleNotebooks.filter(nb => nb.parentId === parentId)).forEach(nb => {
      if (visitedNotebookIds.has(nb.id)) return;
      visitedNotebookIds.add(nb.id);
      notebookRows.push({ notebook: nb, depth });
      pushNotebookRows(nb.id, depth + 1);
    });
  };
  pushNotebookRows(null, 0);
  sortNotebookRows(visibleNotebooks.filter(nb => !visitedNotebookIds.has(nb.id))).forEach(nb => {
    notebookRows.push({ notebook: nb, depth: 0 });
  });
  const filteredNotebookRows = notebookQuery
    ? notebookRows.filter(({ notebook }) => notebook.name.toLowerCase().includes(notebookQuery))
    : notebookRows;
  const getNotebookNoteCount = (notebookId: string) =>
    notes.filter(item => item.notebookId === notebookId && !item.trashed).length;
  const getNotebookRecentTime = (notebookId: string) =>
    Math.max(
      0,
      ...notes
        .filter(item => item.notebookId === notebookId && !item.trashed)
        .map(item => new Date(item.updatedAt).getTime())
    );
  const recentNotebookRows = notebookRows
    .filter(({ notebook: nb }) => nb.id !== note.notebookId && getNotebookRecentTime(nb.id) > 0)
    .sort((a, b) => getNotebookRecentTime(b.notebook.id) - getNotebookRecentTime(a.notebook.id))
    .slice(0, 3);

  return (
    <div
      className={`note-theme-editor flex-1 min-w-0 overflow-hidden flex flex-col h-full ${settings.zenMode ? 'zen-mode' : ''}`}
      data-note-theme={activeNoteTheme}
      style={{ backgroundColor: 'var(--note-theme-bg, var(--editor-bg))' }}
    >
      {/* Top bar */}
      {settings.zenMode ? (
        <div className="flex items-center justify-between px-4 py-2.5 border-b theme-divider shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={toggleZenMode}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border theme-border theme-hover text-xs font-bold text-theme-secondary"
              title="Exit Focus Mode (Esc)"
              aria-label="Exit Focus Mode"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Exit Focus</span>
            </button>
            <h2 className="text-sm font-bold text-theme-primary truncate max-w-sm">
              {title || 'Untitled Note'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {!isLocked && (
              <button
                type="button"
                onClick={handleListenClick}
                className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 border theme-border theme-hover text-xs font-bold text-theme-secondary shadow-sm"
                title="Listen to note"
                aria-label="Listen"
              >
                <Volume2 className="h-3.5 w-3.5 accent-text" />
                <span>Listen</span>
              </button>
            )}
            {settings.aiEnabled && !isLocked && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={openAiPanel}
                  className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ai-button text-xs font-bold text-white shadow-sm"
                  title="Open NTK AI note tools"
                  aria-label="Open NTK AI note tools"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>NTK AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    useStore.getState().setAiNoteContext({
                      noteId: note.id,
                      noteTitle: title,
                      noteContent: content.slice(0, 4000),
                    });
                    useStore.getState().setCurrentView('ai');
                  }}
                  className="hidden sm:inline-flex items-center gap-1 rounded-xl px-2 py-1.5 border theme-border theme-hover text-xs font-semibold text-theme-secondary"
                  title="Chat about this note with conversational NTK AI"
                  aria-label="Chat about this note with conversational NTK AI"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Chat</span>
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="p-1.5 rounded-lg theme-hover text-theme-tertiary"
              title="More actions"
              aria-label="More actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <>
        <div className="hidden sm:flex min-w-0 flex-col gap-2 px-4 py-2.5 border-b theme-divider shrink-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              onClick={() => { selectNote(null); setEditingNote(false); }}
              className="p-1.5 rounded-lg theme-hover 2xl:hidden" style={{ color: 'var(--text-tertiary)' }}
              aria-label="Close editor"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            {onCollapsePanel && (
              <button
                type="button"
                onClick={onCollapsePanel}
                className="hidden 2xl:inline-flex p-1.5 rounded-lg theme-hover text-theme-tertiary"
                title="Collapse editor panel"
                aria-label="Collapse editor panel"
              >
                <PanelRightClose className="w-5 h-5 no-transition" />
              </button>
            )}
          
          {notebook && (
            <button
              type="button"
              onClick={openMoveDialog}
              disabled={!canEditNote}
              className="inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-theme-tertiary theme-hover"
              title={canEditNote ? 'Move note to another notebook' : 'Only owners and editors can move this note'}
              aria-label="Move note to another notebook"
            >
              <span className="shrink-0">{notebook.icon}</span>
              <span className="truncate">{notebook.name}</span>
              <span className="hidden text-[10px] uppercase tracking-wide accent-text sm:inline">Move</span>
            </button>
          )}
          
          <span className="text-xs text-theme-tertiary">
            <Clock className="w-3 h-3 inline mr-1" />
            {format(new Date(note.updatedAt), 'MMM d, h:mm a')}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-1 sm:justify-end sm:pb-0" ref={menuRef}>
          {/* Preview toggle for markdown */}
          {note.type === 'markdown' && (
            <button
              onClick={() => setIsPreview(!isPreview)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ backgroundColor: isPreview ? 'var(--active-bg)' : 'transparent', color: isPreview ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
              title={isPreview ? 'Edit' : 'Preview'}
              aria-label={isPreview ? 'Edit markdown' : 'Preview markdown'}
            >
              {isPreview ? <Edit3 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}

          {!isLocked && canEditNote && (
            <>
              <button
                onClick={undoNoteChange}
                disabled={!historyStatus.canUndo}
                className="p-1.5 rounded-lg theme-hover disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: 'var(--text-tertiary)' }}
                title="Undo (Ctrl+Z)"
                aria-label="Undo note edit"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={redoNoteChange}
                disabled={!historyStatus.canRedo}
                className="p-1.5 rounded-lg theme-hover disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: 'var(--text-tertiary)' }}
                title="Redo (Ctrl+Y)"
                aria-label="Redo note edit"
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--divider)' }} />
            </>
          )}

          <button
            onClick={handlePinToggle}
            disabled={!canEditNote}
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: note.pinned ? 'var(--active-bg)' : 'transparent', color: note.pinned ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            title={canEditNote ? undefined : 'Only owners and editors can pin shared notes'}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={handleStarToggle}
            disabled={!canEditNote}
            className="p-1.5 rounded-lg transition-colors theme-hover"
            style={{ color: note.starred ? '#f59e0b' : 'var(--text-tertiary)' }}
            aria-label={note.starred ? 'Unstar note' : 'Star note'}
            title={canEditNote ? undefined : 'Only owners and editors can star shared notes'}
          >
            <Star className={`w-4 h-4 ${note.starred ? 'fill-amber-500' : ''}`} />
          </button>

          {!isLocked && (
            <button
              type="button"
              onClick={handleListenClick}
              className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 border theme-border theme-hover text-xs font-bold text-theme-secondary shadow-sm"
              title="Listen to note or selected text"
              aria-label="Listen"
            >
              <Volume2 className="h-3.5 w-3.5 accent-text" />
              <span className="hidden sm:inline">Listen</span>
            </button>
          )}

          {settings.aiEnabled && !isLocked && (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={openAiPanel}
                className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ai-button text-xs font-bold text-white shadow-sm"
                title="Ask NTK AI to help with this note"
                aria-label="Open NTK AI"
              >
                <Sparkles className="h-4 w-4 no-transition" />
                <span className="hidden sm:inline">NTK AI</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  useStore.getState().setAiNoteContext({
                    noteId: note.id,
                    noteTitle: title,
                    noteContent: content.slice(0, 4000),
                  });
                  useStore.getState().setCurrentView('ai');
                }}
                className="inline-flex items-center gap-1 rounded-xl px-2 py-1.5 border theme-border theme-hover text-xs font-semibold text-theme-secondary"
                title="Chat about this note with conversational NTK AI"
                aria-label="Chat about this note with conversational NTK AI"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Chat</span>
              </button>
            </div>
          )}

          {/* Focus mode */}
          <button
            onClick={toggleZenMode}
            className="p-1.5 rounded-lg theme-hover" style={{ color: 'var(--text-tertiary)' }}
            title={settings.zenMode ? 'Exit Focus Mode (Esc)' : 'Focus Mode'}
            aria-label={settings.zenMode ? 'Exit Focus Mode' : 'Focus Mode'}
          >
            {settings.zenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {/* More menu */}
          <button
            onClick={() => {
              setShowMenu(!showMenu);
              setShowMovePanel(false);
              setShowMoveMenu(false);
              setShowExportMenu(false);
              setShowExportPanel(false);
            }}
            className="p-1.5 rounded-lg theme-hover" style={{ color: 'var(--text-tertiary)' }}
            aria-label="More note actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-4 top-12 z-40 w-56 rounded-xl py-1.5 animate-scale-in theme-menu border">
              {!canEditNote && (
                <div className="mx-2 mb-1 rounded-lg border theme-border bg-[var(--input-bg)] px-3 py-2">
                  <p className="text-xs font-semibold text-theme-primary">{roleLabels[accessRole]} access</p>
                  <p className="mt-1 text-[11px] leading-4 text-theme-tertiary">
                    You can read{accessRole === 'commenter' ? ' and comment on' : ''} this shared note.
                  </p>
                </div>
              )}
              {canEditNote && (
                <>
                  <MenuSectionLabel label="Organize" />
                  <MenuBtn icon={Palette} label="Note color" onClick={() => { setShowColorPicker(!showColorPicker); }} />
                  <MenuBtn icon={Sparkles} label="Note theme" onClick={() => { setShowThemePicker(!showThemePicker); }} />
                  <MenuBtn icon={AlertCircle} label="Priority" onClick={() => { setShowPriority(!showPriority); }} />
                  <MenuBtn icon={Tag} label="Add tag" onClick={() => { setShowTagInput(!showTagInput); setShowMenu(false); }} />
                  <MenuBtn icon={Bell} label={note.reminder ? 'Update reminder' : 'Set reminder'} onClick={() => { setShowReminder(!showReminder); setShowMenu(false); }} />
                  <MenuBtn icon={Hash} label="Move to notebook" onClick={openMoveDialog} />
                  <MenuBtn icon={Copy} label="Duplicate" onClick={handleDuplicateNote} />
                  <div className="my-1 border-t theme-divider" />
                  <MenuSectionLabel label="Protect" />
                  {note.encrypted && unlockedNote ? (
                    <MenuBtn icon={Lock} label="Lock now" onClick={() => { relockNote(note.id); setShowMenu(false); }} />
                  ) : (
                    <MenuBtn icon={ShieldCheck} label={note.encrypted ? 'Unlock note' : 'Encrypt / lock note'} onClick={() => { setShowLockDialog(true); setShowMenu(false); }} />
                  )}
                  <div className="my-1 border-t theme-divider" />
                </>
              )}
              <MenuSectionLabel label="History" />
              <MenuBtn icon={History} label="Version history" onClick={openVersionHistory} />
              <MenuBtn icon={History} label="Save local snapshot" onClick={() => { handleSaveLocalSnapshot(); setShowMenu(false); }} />
              {canEditNote && <MenuBtn icon={Cloud} label="Cloud checkpoint" onClick={() => { handleCloudCheckpoint(); setShowMenu(false); }} />}
              <div className="my-1 border-t theme-divider" />
              <MenuSectionLabel label="Share" />
              {accessRole === 'owner' && <MenuBtn icon={Share2} label="Share / Publish" onClick={() => { setShowShareModal(true); setShowMenu(false); }} />}
              <MenuBtn icon={Share2} label="Export / Share" onClick={openExportSurface} />
              {showExportMenu && (
                <div className="px-3 py-2 border-t theme-divider xl:hidden">
                  <p className="text-xs text-theme-tertiary mb-2">Export & Share</p>
                  <div className="mb-2 rounded-lg border theme-border p-2" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <ExportOptionToggle
                      label="Include title"
                      checked={exportOptions.includeTitle}
                      onChange={() => updateExportOption('includeTitle', !exportOptions.includeTitle)}
                    />
                    <ExportOptionToggle
                      label="Include dates"
                      checked={exportOptions.includeDates}
                      onChange={() => updateExportOption('includeDates', !exportOptions.includeDates)}
                    />
                    <ExportOptionToggle
                      label="Include tags"
                      checked={exportOptions.includeTags}
                      onChange={() => updateExportOption('includeTags', !exportOptions.includeTags)}
                    />
                  </div>
                  <div className="space-y-1">
                    <ExportBtn icon={Download} label="Export as PDF" onClick={() => runExportAction('pdf', () => exportToPDF(note, exportOptions))} />
                    <ExportBtn icon={FileText} label="Copy as plain text" onClick={() => runExportAction('plain', () => copyAsPlainText(note, exportOptions))} />
                    <ExportBtn icon={Code} label="Copy as Markdown" onClick={() => runExportAction('markdown', () => copyAsMarkdown(note, exportOptions))} />
                    <ExportBtn icon={Type} label="Copy as HTML" onClick={() => runExportAction('html', () => copyAsHTML(note, exportOptions))} />
                    <ExportBtn icon={Mail} label="Share via email" onClick={() => runExportAction('email', () => shareViaEmail(note, exportOptions))} />
                    <ExportBtn icon={FileText} label="Print note" onClick={() => runExportAction('print', () => printNote(note, exportOptions))} />
                  </div>
                </div>
              )}
              {canEditNote && (
                <>
                  <div className="my-1 border-t theme-divider" />
                  <MenuSectionLabel label="Cleanup" />
                  <MenuBtn icon={Archive} label={note.archived ? 'Unarchive' : 'Archive'} onClick={handleArchiveToggle} />
                  <MenuBtn icon={Trash2} label="Move to Recycle Bin" onClick={handleTrashNote} danger />
                </>
              )}
              
              {/* Color picker submenu */}
              {showColorPicker && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Note color</p>
                  <div className="grid grid-cols-6 gap-1.5">
                    {(Object.keys(noteColors) as NoteColor[]).map(c => (
                      <button
                        key={c}
                        onClick={() => { setNoteColor(note.id, c); setShowColorPicker(false); setShowMenu(false); }}
                        className={`w-6 h-6 rounded-full ${noteColors[c].dot} ${note.color === c ? 'ring-2 ring-offset-2' : ''} hover:scale-110 transition-transform`}
                        style={note.color === c ? { '--tw-ring-offset-color': 'var(--card-bg)', '--tw-ring-color': 'var(--accent-primary)' } as React.CSSProperties : undefined}
                        title={noteColors[c].label}
                        aria-label={`Set note color to ${noteColors[c].label}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Theme picker submenu */}
              {showThemePicker && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Premium note theme</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(noteThemes) as [keyof typeof noteThemes, typeof noteThemes.canvas][]).map(([key, theme]) => (
                      <button
                        key={key}
                        onClick={() => { setNoteTheme(note.id, key); setShowThemePicker(false); setShowMenu(false); }}
                        className="text-left rounded-lg border p-2 theme-hover"
                        aria-label={`Apply note theme ${theme.label}`}
                        style={{
                          borderColor: activeNoteTheme === key ? 'var(--accent-primary)' : 'var(--card-border)',
                          backgroundColor: activeNoteTheme === key ? 'var(--active-bg)' : 'transparent',
                        }}
                      >
                        <span className="block h-7 rounded-md mb-1.5" style={{ background: theme.preview }} />
                        <span className="block text-xs font-semibold text-theme-primary">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Priority submenu */}
              {showPriority && (
                <div className="px-3 py-2 border-t theme-divider">
                  <p className="text-xs text-theme-tertiary mb-2">Priority</p>
                  <div className="space-y-1">
                    {(Object.entries(priorityConfig) as [Priority, typeof priorityConfig.urgent][]).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => { setNotePriority(note.id, note.priority === key ? null : key); setShowPriority(false); setShowMenu(false); }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${note.priority === key ? cfg.bg : 'theme-hover'} ${cfg.color}`}
                      >
                        <span>{cfg.icon}</span> {cfg.label}
                      </button>
                    ))}
                    {note.priority && (
                      <button
                        onClick={() => { setNotePriority(note.id, null); setShowPriority(false); setShowMenu(false); }}
                        className="w-full text-left px-2 py-1.5 rounded-lg text-sm text-theme-tertiary theme-hover"
                      >
                        Clear priority
                      </button>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}

          {showMovePanel && (
            <div
              ref={movePanelRef}
              className="fixed right-4 top-20 bottom-4 z-50 hidden w-[420px] flex-col overflow-hidden rounded-2xl border theme-menu shadow-2xl xl:flex"
              role="dialog"
              aria-modal="false"
              aria-labelledby="move-note-panel-title"
            >
              <div className="flex items-start justify-between gap-4 border-b theme-divider px-5 py-4">
                <div className="min-w-0">
                  <p id="move-note-panel-title" className="text-lg font-bold text-theme-primary">Move note</p>
                  <p className="mt-1 truncate text-sm text-theme-tertiary">{title || noteDisplayTitle(note)}</p>
                </div>
                <button
                  type="button"
                  onClick={closeMoveSurface}
                  className="rounded-lg p-2 text-theme-tertiary theme-hover"
                  aria-label="Close move note panel"
                >
                  <X className="h-5 w-5 no-transition" />
                </button>
              </div>

              <div className="border-b theme-divider px-5 py-4">
                <label className="flex items-center gap-2 rounded-xl border theme-border theme-input px-3 py-2.5">
                  <Search className="h-4 w-4 shrink-0 text-theme-tertiary no-transition" />
                  <input
                    value={notebookSearch}
                    onChange={e => setNotebookSearch(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-theme-primary outline-none"
                    placeholder="Search notebooks..."
                    autoFocus
                  />
                </label>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
                {notebook && (
                  <section>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-theme-tertiary">Current location</h3>
                    <div className="flex items-center gap-3 rounded-xl border theme-border px-3 py-3 theme-active">
                      <span className="text-lg">{notebook.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold accent-text">{notebook.name}</span>
                        <span className="block text-xs text-theme-tertiary">
                          {getNotebookNoteCount(notebook.id)} note{getNotebookNoteCount(notebook.id) === 1 ? '' : 's'}
                        </span>
                      </span>
                      <Check className="h-4 w-4 shrink-0 accent-text no-transition" />
                    </div>
                  </section>
                )}

                {!notebookQuery && recentNotebookRows.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-theme-tertiary">Recently used</h3>
                    <MoveNotebookList
                      rows={recentNotebookRows}
                      currentNotebookId={note.notebookId}
                      getNoteCount={getNotebookNoteCount}
                      onMove={handleMoveToNotebook}
                      emptyTitle="No recent notebooks"
                      emptyHint="Your used notebooks will appear here."
                      compact
                    />
                  </section>
                )}

                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-theme-tertiary">
                    {notebookQuery ? 'Search results' : 'All notebooks'}
                  </h3>
                  <MoveNotebookList
                    rows={filteredNotebookRows}
                    currentNotebookId={note.notebookId}
                    getNoteCount={getNotebookNoteCount}
                    onMove={handleMoveToNotebook}
                    emptyTitle="No notebook matches your search."
                    emptyHint="Try a shorter name or clear the search field."
                  />
                </section>
              </div>
            </div>
          )}

          {showExportPanel && (
            <div
              ref={exportPanelRef}
              className="fixed right-4 top-20 bottom-4 z-50 hidden w-[360px] flex-col overflow-hidden rounded-2xl border theme-menu shadow-2xl xl:flex"
              role="dialog"
              aria-modal="false"
              aria-labelledby="export-share-panel-title"
            >
              <div className="flex items-start justify-between gap-4 border-b theme-divider px-5 py-4">
                <div className="min-w-0">
                  <p id="export-share-panel-title" className="text-lg font-bold text-theme-primary">Export & Share</p>
                  <p className="mt-1 truncate text-sm text-theme-tertiary">{title || noteDisplayTitle(note)}</p>
                </div>
                <button
                  type="button"
                  onClick={closeExportSurface}
                  className="rounded-lg p-2 text-theme-tertiary theme-hover"
                  aria-label="Close export panel"
                >
                  <X className="h-5 w-5 no-transition" />
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
                <ExportPanelSection title="Preset">
                  <div className="rounded-xl border theme-border p-3" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <div className="grid gap-2">
                      <ExportOptionToggle
                        label="Include title"
                        checked={exportOptions.includeTitle}
                        onChange={() => updateExportOption('includeTitle', !exportOptions.includeTitle)}
                      />
                      <ExportOptionToggle
                        label="Include dates"
                        checked={exportOptions.includeDates}
                        onChange={() => updateExportOption('includeDates', !exportOptions.includeDates)}
                      />
                      <ExportOptionToggle
                        label="Include tags"
                        checked={exportOptions.includeTags}
                        onChange={() => updateExportOption('includeTags', !exportOptions.includeTags)}
                      />
                    </div>
                    {lastExportFormat && (
                      <p className="mt-3 text-xs text-theme-tertiary">Last export: {exportFormatLabels[lastExportFormat]}</p>
                    )}
                  </div>
                </ExportPanelSection>

                <ExportPanelSection title="File">
                  <ExportPanelBtn icon={Download} title="PDF" meta="Export note" onClick={() => runExportAction('pdf', () => exportToPDF(note, exportOptions))} />
                  <ExportPanelBtn icon={FileText} title="Print" meta="Printer-ready view" onClick={() => runExportAction('print', () => printNote(note, exportOptions))} />
                </ExportPanelSection>

                <ExportPanelSection title="Copy">
                  <ExportPanelBtn icon={FileText} title="Plain text" meta="Clean text" onClick={() => runExportAction('plain', () => copyAsPlainText(note, exportOptions))} />
                  <ExportPanelBtn icon={Code} title="Markdown" meta="Portable source" onClick={() => runExportAction('markdown', () => copyAsMarkdown(note, exportOptions))} />
                  <ExportPanelBtn icon={Type} title="HTML" meta="Formatted markup" onClick={() => runExportAction('html', () => copyAsHTML(note, exportOptions))} />
                </ExportPanelSection>

                <ExportPanelSection title="Send">
                  <ExportPanelBtn icon={Mail} title="Email" meta="Open mail draft" onClick={() => runExportAction('email', () => shareViaEmail(note, exportOptions))} />
                </ExportPanelSection>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile-Native Top Header (phone viewports) */}
      <div className="sm:hidden flex min-h-[52px] items-center justify-between px-3 py-1 border-b theme-divider shrink-0 bg-[var(--card-bg)] select-none">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => { selectNote(null); setEditingNote(false); }}
            className="flex h-11 w-11 items-center justify-center rounded-xl theme-hover text-theme-primary shrink-0 -ml-1"
            aria-label="Back to notes list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-theme-primary truncate max-w-[170px]">
              {title || noteDisplayTitle(note)}
            </h2>
            {notebook && (
              <button
                type="button"
                onClick={openMoveDialog}
                disabled={!canEditNote}
                className="text-[10px] text-theme-tertiary truncate flex items-center gap-1 hover:underline text-left"
                aria-label={`Notebook: ${notebook.name}`}
              >
                <span>{notebook.icon}</span>
                <span className="truncate max-w-[140px]">{notebook.name}</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleStarToggle}
            disabled={!canEditNote}
            className="flex h-10 w-10 items-center justify-center rounded-xl theme-hover text-theme-tertiary"
            aria-label={note.starred ? 'Unstar note' : 'Star note'}
          >
            <Star className={`w-4 h-4 ${note.starred ? 'fill-amber-500 text-amber-500' : ''}`} />
          </button>
          {!isLocked && (
            <button
              type="button"
              onClick={handleListenClick}
              className="flex h-10 w-10 items-center justify-center rounded-xl theme-hover text-theme-secondary"
              aria-label="Listen to note"
            >
              <Volume2 className="w-4 h-4 accent-text" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="flex h-10 w-10 items-center justify-center rounded-xl theme-hover text-theme-tertiary"
            aria-label="More note actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
      </>
      )}

      {/* Beginner-friendly writing mode switcher — desktop only */}
      {!isLocked && (
        <div className="hidden sm:flex min-w-0 items-center justify-between gap-2 border-b theme-divider bg-[var(--app-bg-subtle)]/30 px-4 py-1.5 shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex shrink-0 items-center gap-1 rounded-lg border theme-border bg-[var(--card-bg)] p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => setActiveFormat('plain')}
                title="Write and edit your note"
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  activeFormat === 'plain'
                    ? 'accent-soft text-[var(--accent-primary)]'
                    : 'text-theme-secondary hover:text-theme-primary'
                }`}
              >
                <Edit3 className="h-3.5 w-3.5 no-transition" />
                Write
              </button>
              <button
                type="button"
                onClick={() => setActiveFormat('rich')}
                title="Preview how formatted text will read"
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  activeFormat === 'rich'
                    ? 'accent-soft text-[var(--accent-primary)]'
                    : 'text-theme-secondary hover:text-theme-primary'
                }`}
              >
                <Eye className="h-3.5 w-3.5 no-transition" />
                Preview
              </button>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAdvancedFormats(value => !value)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  activeFormat === 'code' || activeFormat === 'html' ? 'accent-soft accent-text' : 'text-theme-tertiary theme-hover'
                }`}
                aria-expanded={showAdvancedFormats}
              >
                Advanced
              </button>
              {showAdvancedFormats && (
                <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-xl border theme-card p-1.5 shadow-xl" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
                  <p className="px-2 py-1 text-[10px] leading-4 text-theme-muted">For users who need the note's underlying markup.</p>
                  <button
                    type="button"
                    onClick={() => { setActiveFormat('code'); setShowAdvancedFormats(false); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-theme-secondary theme-hover"
                  >
                    <Code className="h-3.5 w-3.5 no-transition" />
                    Source
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveFormat('html'); setShowAdvancedFormats(false); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-theme-secondary theme-hover"
                  >
                    <FileCode className="h-3.5 w-3.5 no-transition" />
                    HTML preview
                  </button>
                </div>
              )}
            </div>
          </div>

          <span className="hidden text-[10px] text-theme-muted md:block">Write is the normal editing mode</span>
        </div>
      )}

      {/* Tag input */}
      {showTagInput && (
        <div className="flex items-center gap-2 px-4 py-2 border-b theme-divider theme-bg-subtle animate-fade-in">
          <Tag className="w-4 h-4 text-theme-tertiary" />
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddTag(); if (e.key === 'Escape') setShowTagInput(false); }}
            placeholder="Add a tag..."
            className="flex-1 bg-transparent text-sm text-theme-primary focus:outline-none"
            autoFocus
          />
          <button onClick={handleAddTag} className="text-xs accent-text font-medium">Add</button>
          <button onClick={() => setShowTagInput(false)} className="text-theme-tertiary"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Reminder input */}
      {showReminder && (
        <div className="flex items-center gap-2 px-4 py-2 border-b theme-divider animate-fade-in" style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
          <Bell className="w-4 h-4 text-orange-500" />
          <input type="date" value={reminderDate} onChange={e => setReminderDate(e.target.value)} className="bg-transparent text-sm text-theme-primary focus:outline-none" />
          <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)} className="bg-transparent text-sm text-theme-primary focus:outline-none" />
          <button onClick={handleSetReminder} className="text-xs text-orange-600 font-medium">Set</button>
          {note.reminder && canEditNote && (
            <button onClick={() => { setNoteReminder(note.id, undefined); setShowReminder(false); }} className="text-xs text-red-500">Remove</button>
          )}
          <button onClick={() => setShowReminder(false)} className="text-theme-tertiary ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {versionStatus && (
        <div className="px-4 py-1.5 border-b theme-divider text-xs accent-text" style={{ backgroundColor: 'var(--active-bg)' }}>
          {versionStatus}
        </div>
      )}

      {note.isShared && (
        <div className="border-b theme-divider px-4 py-2" style={{ backgroundColor: 'var(--input-bg)' }}>
          <div className="mx-auto flex max-w-3xl items-start gap-2 text-xs text-theme-tertiary">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 accent-text no-transition" />
            <p>
              Shared note - <span className="font-semibold text-theme-secondary">{roleLabels[accessRole]}</span>
              {!canEditNote && (
                <span> - Content is read-only{accessRole === 'commenter' ? ', but comments are enabled' : ''}.</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Tags display */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b theme-divider">
          {note.tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}>
              <Tag className="w-3 h-3" />{tag}
              {canEditNote && (
                <button
                  onClick={() => {
                    void removeNoteTag(note.id, tag).then(() => {
                      showActionToast(`Removed #${tag}.`, () => void addNoteTag(note.id, tag));
                    });
                  }}
                  className="hover:text-red-500 ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
          {canEditNote && (
            <button
              onClick={() => setShowTagInput(true)}
              className="text-xs text-theme-tertiary flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          )}
        </div>
      )}

      {/* Reminder display */}
      {note.reminder && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b theme-divider" style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
          <Bell className="w-3.5 h-3.5 text-orange-500" />
          <span className="text-xs text-orange-600 dark:text-orange-400">
            Reminder: {format(new Date(note.reminder.time), 'MMM d, yyyy h:mm a')}
          </span>
        </div>
      )}

      {(showLockDialog || isLocked) && (
        <div className="px-4 py-3 border-b theme-divider" style={{ backgroundColor: 'var(--input-bg)' }}>
          <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-9 h-9 rounded-lg accent-soft flex items-center justify-center shrink-0">
                {isLocked ? <Lock className="w-4 h-4 no-transition" /> : <ShieldCheck className="w-4 h-4 no-transition" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-theme-primary">{isLocked ? 'Locked note' : 'Encrypt this note'}</p>
                <p className="text-xs text-theme-tertiary">
                  {isLocked ? (note.lockHint ? `Hint: ${note.lockHint}` : 'Enter the password to edit this note.') : 'Content and checklist items stay encrypted at rest.'}
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 md:min-w-[360px]">
              {isLocked ? (
                <>
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={event => setUnlockPassword(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') void handleUnlockNote(); }}
                    placeholder="Password"
                    className="flex-1 px-3 py-2 rounded-lg theme-input border text-sm focus:outline-none accent-focus"
                  />
                  <button
                    onClick={() => void handleUnlockNote()}
                    disabled={lockBusy || !unlockPassword.trim()}
                    className="px-3 py-2 rounded-lg accent-button text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    <Unlock className="w-4 h-4 no-transition" />
                    Unlock
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="password"
                    value={lockPassword}
                    onChange={event => setLockPassword(event.target.value)}
                    placeholder="Password"
                    className="flex-1 px-3 py-2 rounded-lg theme-input border text-sm focus:outline-none accent-focus"
                  />
                  <input
                    type="text"
                    value={lockHint}
                    onChange={event => setLockHint(event.target.value)}
                    placeholder="Hint"
                    className="flex-1 px-3 py-2 rounded-lg theme-input border text-sm focus:outline-none accent-focus"
                  />
                  <button
                    onClick={() => void handleLockNote()}
                    disabled={lockBusy || !lockPassword.trim()}
                    className="px-3 py-2 rounded-lg accent-button text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    <Lock className="w-4 h-4 no-transition" />
                    Lock
                  </button>
                </>
              )}
              {!isLocked && (
                <button
                  onClick={() => { setShowLockDialog(false); setLockPassword(''); setLockHint(''); setLockError(''); }}
                  className="px-3 py-2 rounded-lg theme-hover text-sm font-medium text-theme-tertiary"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          {lockError && <p className="max-w-3xl mx-auto mt-2 text-xs text-red-500">{lockError}</p>}
        </div>
      )}

      {/* Formatting Toolbar — desktop only */}
      {showToolbar && canEditNote && !isPreview && !isLocked && note.type !== 'checklist' && (
        <div className="hidden sm:flex items-center gap-1 px-3 py-1.5 border-b theme-divider overflow-x-auto shrink-0">
          <button
            type="button"
            onClick={() => insertFormatting('**', '**')}
            title="Bold (Ctrl+B)"
            aria-label="Bold"
            className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('*', '*')}
            title="Italic (Ctrl+I)"
            aria-label="Italic"
            className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('# ')}
            title="Heading 1"
            aria-label="Heading"
            className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
          >
            <Heading1 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('- ')}
            title="Bullet list"
            aria-label="Bullet list"
            className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('- [ ] ')}
            title="Task checklist"
            aria-label="Task checklist"
            className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('[', '](url)')}
            title="Link (Ctrl+K)"
            aria-label="Link"
            className="p-1.5 rounded-md theme-hover text-theme-tertiary transition-colors shrink-0"
          >
            <Link className="w-4 h-4" />
          </button>

          {/* More formatting dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMoreFormatting(!showMoreFormatting)}
              title="More formatting"
              aria-label="More formatting"
              className={`p-1.5 rounded-md transition-colors shrink-0 ${showMoreFormatting ? 'accent-soft accent-text' : 'theme-hover text-theme-tertiary'}`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMoreFormatting && (
              <div
                className="absolute left-0 top-full mt-1 w-48 rounded-xl border theme-card shadow-xl p-1.5 z-50 animate-scale-in"
                style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
              >
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertAtLineStart('## '); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <Heading2 className="w-3.5 h-3.5" /> Heading 2
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertAtLineStart('### '); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <Heading3 className="w-3.5 h-3.5" /> Heading 3
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertFormatting('<u>', '</u>'); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <Underline className="w-3.5 h-3.5" /> Underline
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertFormatting('~~', '~~'); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <Strikethrough className="w-3.5 h-3.5" /> Strikethrough
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertAtLineStart('> '); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <Quote className="w-3.5 h-3.5" /> Quote
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertFormatting('`', '`'); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <Code className="w-3.5 h-3.5" /> Inline code
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertAtLineStart('1. '); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <ListOrdered className="w-3.5 h-3.5" /> Numbered list
                </button>
                <button
                  type="button"
                  onClick={() => { setShowMoreFormatting(false); insertFormatting('\n---\n'); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-theme-secondary theme-hover"
                >
                  <Minus className="w-3.5 h-3.5" /> Divider
                </button>
              </div>
            )}
          </div>

          <div className="w-px h-5 mx-1" style={{ backgroundColor: 'var(--divider)' }} />

          {/* Voice Dictation (lightweight live browser dictation) */}
          {isSpeechSupported ? (
            <button
              onClick={toggleListening}
              title={isListening ? 'Stop Voice Dictation' : 'Start Voice Dictation'}
              aria-label={isListening ? 'Stop voice dictation' : 'Start voice dictation'}
              className={`p-1.5 rounded-md transition-colors shrink-0 relative ${
                isListening 
                  ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20' 
                  : 'theme-hover text-theme-tertiary'
              }`}
            >
              <Mic className={`w-4 h-4 ${isListening ? 'animate-pulse' : ''}`} />
              {isListening && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-ping" />
              )}
            </button>
          ) : null}

          {/* Compact + Add menu in toolbar */}
          <div className="relative ml-auto sm:ml-0">
            <button
              type="button"
              onClick={() => setShowAddMediaMenu(!showAddMediaMenu)}
              title="Add photo, audio, file or sketch"
              aria-label="Add item"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border theme-border theme-hover text-xs font-bold text-theme-secondary"
            >
              <Plus className="w-3.5 h-3.5 accent-text" />
              <span>Add</span>
            </button>
            {showAddMediaMenu && (
              <div
                className="absolute right-0 top-full mt-1 w-52 rounded-2xl border theme-card shadow-xl p-1.5 z-50 animate-scale-in"
                style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
              >
                <button
                  type="button"
                  onClick={() => { setShowAddMediaMenu(false); handleAddImageClick(); }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                >
                  <ImageIcon className="w-4 h-4 accent-text" /> Photo
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddMediaMenu(false); void (isRecordingVoice ? stopVoiceRecording() : startVoiceRecording()); }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                >
                  <Volume2 className="w-4 h-4 accent-text" /> Record memo
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddMediaMenu(false); handleAddAttachmentClick(); }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                >
                  <Paperclip className="w-4 h-4 accent-text" /> Attach file
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddMediaMenu(false); audioFileInputRef.current?.click(); }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                >
                  <Sparkles className="w-4 h-4 accent-text" /> Transcribe audio
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddMediaMenu(false); setShowSketchModal(true); }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                >
                  <PenTool className="w-4 h-4 accent-text" /> Sketch
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Editor Area */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="w-full max-w-3xl min-w-0 mx-auto px-4 md:px-8 py-4">
          {isLocked ? (
            <div className="min-h-[45vh] flex items-center justify-center text-center">
              <div>
                <Lock className="w-14 h-14 mx-auto mb-4 text-theme-muted no-transition" />
                <h3 className="text-lg font-semibold text-theme-primary">{noteDisplayTitle(note)}</h3>
                <p className="text-sm text-theme-tertiary mt-1">This note is encrypted and locked.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Listen Player if active */}
              {listenPlayerOpen && (
                <div className="mb-4">
                  <ListenPlayer
                    text={listenText}
                    isSelection={isListenSelection}
                    title={title || noteDisplayTitle(note)}
                    onClose={() => setListenPlayerOpen(false)}
                    onSaveAudio={handleSaveListenAudio}
                  />
                </div>
              )}

              {/* Transcribing file banner if active */}
              {transcribingFile && (
                <div className="mb-4 flex items-center gap-3 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400 animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Transcribing audio file… please wait a moment.</span>
                </div>
              )}

              {/* Title */}
              <input
                type="text"
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                onBlur={() => saveNote(title, content, true)}
                readOnly={!canEditNote}
                placeholder="Untitled"
                className="w-full min-w-0 text-2xl md:text-3xl font-bold bg-transparent focus:outline-none mb-4 read-only:cursor-default"
                spellCheck={settings.spellCheck}
                style={{
                  color: 'var(--text-primary)',
                  fontSize: `${Math.max(settings.editorFontSize + 8, 24)}px`,
                  fontFamily: settings.editorFontFamily,
                }}

              />

              {/* Content area based on type */}
              {note.type === 'checklist' && activeFormat === 'plain' ? (
                <div className="min-w-0 space-y-1">
                  {[...activeChecklist].sort((a, b) => a.order - b.order).map((item) => (
                    <div
                      key={item.id}
                      draggable={canEditNote}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('checklistItemId', item.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.backgroundColor = 'var(--active-bg)';
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '';
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.style.backgroundColor = '';
                        const draggedId = e.dataTransfer.getData('checklistItemId');
                        handleChecklistReorder(item.id, draggedId);
                      }}
                      className="flex items-start gap-3 group py-1 rounded-lg transition-colors cursor-move"
                    >
                      <div className="flex items-center gap-1 cursor-move opacity-0 group-hover:opacity-50">
                        <svg className="w-3 h-3 text-theme-tertiary" viewBox="0 0 6 10" fill="currentColor">
                          <circle cx="1" cy="1" r="1"/><circle cx="5" cy="1" r="1"/>
                          <circle cx="1" cy="5" r="1"/><circle cx="5" cy="5" r="1"/>
                          <circle cx="1" cy="9" r="1"/><circle cx="5" cy="9" r="1"/>
                        </svg>
                      </div>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={e => handleChecklistUpdate(item.id, { checked: e.target.checked })}
                        disabled={!canEditNote}
                        className="mt-0.5 accent-range w-[18px] h-[18px] cursor-pointer"
                      />
                      <input
                        type="text"
                        value={item.text}
                        onChange={e => handleChecklistUpdate(item.id, { text: e.target.value })}
                        readOnly={!canEditNote}
                        className={`min-w-0 flex-1 bg-transparent text-sm focus:outline-none ${item.checked ? 'line-through text-theme-tertiary' : 'text-theme-primary'}`}
                        spellCheck={settings.spellCheck}
                        style={{ fontSize: `${settings.editorFontSize}px`, fontFamily: settings.editorFontFamily }}
                      />
                      <button
                        onClick={() => handleChecklistRemove(item.id)}
                        disabled={!canEditNote}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded theme-hover text-theme-tertiary transition-all disabled:hidden"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 pt-2">
                    <Plus className="w-[18px] h-[18px] text-theme-tertiary" />
                    <input
                      type="text"
                      value={newChecklistItem}
                      onChange={e => setNewChecklistItem(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddChecklistItem(); }}
                      readOnly={!canEditNote}
                      placeholder="Add item..."
                      className="min-w-0 flex-1 bg-transparent text-sm text-theme-primary placeholder:text-theme-muted focus:outline-none"
                      spellCheck={settings.spellCheck}
                      style={{ fontSize: `${settings.editorFontSize}px`, fontFamily: settings.editorFontFamily }}
                    />
                  </div>
                  <div className="mt-6 pt-4 border-t theme-divider">
                    <textarea
                      value={content}
                      onChange={e => handleContentChange(e.target.value)}
                      onBlur={() => saveNote(title, content, true)}
                      onPaste={handlePaste}
                      readOnly={!canEditNote}
                      placeholder="Add notes..."
                      className="w-full min-w-0 max-w-full min-h-[100px] overflow-x-hidden bg-transparent text-theme-primary placeholder:text-theme-muted resize-none focus:outline-none"
                      spellCheck={settings.spellCheck}
                      style={{ fontSize: `${settings.editorFontSize}px`, lineHeight: '1.7', fontFamily: settings.editorFontFamily, overflowWrap: 'break-word' }}
                    />
                  </div>
                </div>
              ) : activeFormat === 'rich' ? (
                <div className="note-content prose dark:prose-invert max-w-none min-w-0 overflow-x-hidden break-words" style={{ fontSize: `${settings.editorFontSize}px`, fontFamily: settings.editorFontFamily }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || '*No content yet*'}</ReactMarkdown>
                </div>
              ) : activeFormat === 'code' ? (
                <textarea
                  ref={contentRef}
                  value={content}
                  onChange={e => handleContentChange(e.target.value)}
                  onBlur={() => saveNote(title, content, true)}
                  onPaste={handlePaste}
                  readOnly={!canEditNote}
                  placeholder="Raw note source code..."
                  className="w-full min-w-0 max-w-full overflow-x-auto overflow-y-hidden bg-transparent resize-none focus:outline-none editor-area font-mono text-sm border-l-2 border-amber-500/30 pl-3 focus:border-amber-500"
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: `${settings.editorFontSize}px`,
                    lineHeight: '1.8',
                    overflowWrap: 'normal',
                  }}
                  spellCheck={false}
                />
              ) : activeFormat === 'html' ? (
                <div className="max-w-full min-w-0 font-mono text-xs overflow-x-auto bg-[var(--app-bg-subtle)] p-4 rounded-xl border theme-border select-all max-h-[60vh] overflow-y-auto">
                  <pre className="text-theme-secondary whitespace-pre-wrap break-words">{convertMarkdownToHTML(content)}</pre>
                </div>
              ) : (
                <textarea
                  ref={contentRef}
                  value={content}
                  onChange={e => handleContentChange(e.target.value)}
                  onBlur={() => saveNote(title, content, true)}
                  onPaste={handlePaste}
                  readOnly={!canEditNote}
                  placeholder={note.type === 'markdown' ? 'Write in Markdown...' : 'Start writing...'}
                  className="w-full min-w-0 max-w-full overflow-hidden bg-transparent resize-none focus:outline-none editor-area"
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: `${settings.editorFontSize}px`,
                    lineHeight: '1.8',
                    fontFamily: settings.editorFontFamily,
                    overflowWrap: 'break-word',
                  }}
                  spellCheck={settings.spellCheck}
                />
              )}

              {backlinks.length > 0 && (
                <div className="mt-8 pt-4 border-t theme-divider">
                  <h3 className="text-sm font-semibold text-theme-primary mb-3 flex items-center gap-2">
                    <Link2 className="w-4 h-4 no-transition accent-text" />
                    Backlinks
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {backlinks.map(backlink => (
                      <button
                        key={backlink.id}
                        onClick={() => selectNote(backlink.id)}
                        className="px-3 py-1.5 rounded-full text-sm theme-hover"
                        style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}
                      >
                        {noteDisplayTitle(backlink)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Voice Recording Bar */}
              {isRecordingVoice && (
                <div className="mt-6 p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 backdrop-blur-sm animate-pulse-subtle">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3.5 w-3.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500"></span>
                      </span>
                      <div>
                        <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
                          {isVoicePaused ? 'Recording Paused' : 'Recording Voice Note…'}
                        </p>
                        <p className="text-[11px] font-mono text-theme-tertiary">
                          {Math.floor(voiceDuration / 60).toString().padStart(2, '0')}:{(voiceDuration % 60).toString().padStart(2, '0')} / {settings.voiceNoteMaxDurationMinutes || 15}:00 max
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isVoicePaused ? (
                        <button
                          type="button"
                          onClick={resumeVoiceRecording}
                          className="px-3 py-1.5 rounded-lg border theme-border theme-hover text-xs font-bold text-theme-primary inline-flex items-center gap-1"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" /> Resume
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={pauseVoiceRecording}
                          className="px-3 py-1.5 rounded-lg border theme-border theme-hover text-xs font-bold text-theme-secondary inline-flex items-center gap-1"
                        >
                          <Pause className="w-3.5 h-3.5" /> Pause
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={stopVoiceRecording}
                        className="px-3.5 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-bold shadow-sm hover:bg-rose-600 inline-flex items-center gap-1"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" /> Stop & Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelVoiceRecording}
                        className="p-1.5 rounded-lg theme-hover text-theme-tertiary hover:text-rose-500"
                        title="Discard recording"
                        aria-label="Discard recording"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Hidden file inputs for media & transcriptions */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageFileChange}
                disabled={uploadingImage}
              />
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleAttachmentFileChange}
                disabled={uploadingAttachment}
              />
              <input
                ref={audioFileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleTranscribeAudioFileChange}
                disabled={transcribingFile}
              />

              {/* Zero Media Empty State: Compact Add row without 3 permanent empty blocks */}
              {canEditNote && ((note.images?.length || 0) + (note.voiceNotes?.length || 0) + (note.attachments?.length || 0)) === 0 && (
                <div className="mt-8 pt-4 border-t theme-divider flex flex-wrap items-center justify-between gap-2" data-testid="empty-media-compact-row">
                  <span className="text-xs text-theme-tertiary">No photos, voice memos or files attached yet.</span>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowAddMediaMenu(!showAddMediaMenu)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border theme-border theme-hover text-xs font-bold text-theme-secondary"
                    >
                      <Plus className="w-3.5 h-3.5 accent-text" /> Add
                    </button>
                    {showAddMediaMenu && (
                      <div
                        className="absolute right-0 bottom-full mb-1 w-52 rounded-2xl border theme-card shadow-2xl p-1.5 z-50 animate-scale-in"
                        style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
                      >
                        <button
                          type="button"
                          onClick={() => { setShowAddMediaMenu(false); handleAddImageClick(); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                        >
                          <ImageIcon className="w-4 h-4 accent-text" /> Photo
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowAddMediaMenu(false); void (isRecordingVoice ? stopVoiceRecording() : startVoiceRecording()); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                        >
                          <Volume2 className="w-4 h-4 accent-text" /> Record voice memo
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowAddMediaMenu(false); handleAddAttachmentClick(); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                        >
                          <Paperclip className="w-4 h-4 accent-text" /> Attach file
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowAddMediaMenu(false); audioFileInputRef.current?.click(); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                        >
                          <Sparkles className="w-4 h-4 accent-text" /> Transcribe audio
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowAddMediaMenu(false); setShowSketchModal(true); }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                        >
                          <PenTool className="w-4 h-4 accent-text" /> Sketch
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Consolidated Media & Files (N) Section when media exists */}
              {((note.images?.length || 0) + (note.voiceNotes?.length || 0) + (note.attachments?.length || 0)) > 0 && (
                <div className="mt-8 pt-4 border-t theme-divider" data-testid="note-media-files-section">
                  <div className="flex items-center justify-between mb-4">
                    <button
                      type="button"
                      onClick={() => setIsMediaExpanded(!isMediaExpanded)}
                      className="inline-flex items-center gap-2 text-sm font-bold text-theme-primary theme-hover p-1.5 -ml-1.5 rounded-xl"
                    >
                      <Paperclip className="w-4 h-4 accent-text" />
                      <span>Media & Files ({(note.images?.length || 0) + (note.voiceNotes?.length || 0) + (note.attachments?.length || 0)})</span>
                      <ChevronDown className={`w-4 h-4 text-theme-tertiary transition-transform ${isMediaExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {canEditNote && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowAddMediaMenu(!showAddMediaMenu)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold accent-button"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add
                        </button>
                        {showAddMediaMenu && (
                          <div
                            className="absolute right-0 top-full mt-1 w-52 rounded-2xl border theme-card shadow-2xl p-1.5 z-50 animate-scale-in"
                            style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
                          >
                            <button
                              type="button"
                              onClick={() => { setShowAddMediaMenu(false); handleAddImageClick(); }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                            >
                              <ImageIcon className="w-4 h-4 accent-text" /> Photo
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShowAddMediaMenu(false); void (isRecordingVoice ? stopVoiceRecording() : startVoiceRecording()); }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                            >
                              <Volume2 className="w-4 h-4 accent-text" /> Record voice memo
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShowAddMediaMenu(false); handleAddAttachmentClick(); }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                            >
                              <Paperclip className="w-4 h-4 accent-text" /> Attach file
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShowAddMediaMenu(false); audioFileInputRef.current?.click(); }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                            >
                              <Sparkles className="w-4 h-4 accent-text" /> Transcribe audio
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShowAddMediaMenu(false); setShowSketchModal(true); }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-theme-primary theme-hover"
                            >
                              <PenTool className="w-4 h-4 accent-text" /> Sketch
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isMediaExpanded && (
                    <div className="space-y-6 pt-1 animate-in fade-in duration-150">
                      {/* Photos Gallery */}
                      {note.images && note.images.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-theme-tertiary flex items-center gap-1.5">
                              <ImageIcon className="w-3.5 h-3.5 accent-text" />
                              Photos ({note.images.length})
                            </h4>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                            {note.images.map(img => {
                              const src = resolvedImageUrls[img.id] || img.localDataUrl;
                              return (
                                <div
                                  key={img.id}
                                  className="group relative rounded-xl border theme-border overflow-hidden theme-card transition-shadow hover:shadow-md flex flex-col"
                                >
                                  <div
                                    onClick={() => {
                                      if (src) setSelectedLightboxImage({ id: img.id, name: img.name, url: src, caption: img.caption });
                                    }}
                                    className="relative aspect-video w-full bg-[var(--app-bg-subtle)] overflow-hidden cursor-zoom-in flex items-center justify-center"
                                  >
                                    {src ? (
                                      <img
                                        src={src}
                                        alt={img.name}
                                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <Loader2 className="w-5 h-5 animate-spin text-theme-tertiary" />
                                    )}
                                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                      <Maximize2 className="w-5 h-5 text-white drop-shadow" />
                                    </div>
                                  </div>
                                  <div className="p-2 flex-1 flex flex-col justify-between gap-1">
                                    <input
                                      type="text"
                                      defaultValue={img.caption || ''}
                                      placeholder="Add caption…"
                                      disabled={!canEditNote}
                                      onBlur={e => handleUpdateImageCaption(img.id, e.target.value)}
                                      className="w-full bg-transparent text-[11px] text-theme-primary placeholder:text-theme-tertiary outline-none border-b border-transparent focus:border-purple-400/50 truncate"
                                    />
                                    <div className="flex items-center justify-between text-[10px] text-theme-tertiary">
                                      <span>{formatFileSize(img.size)}</span>
                                      {canEditNote && (
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveImage(img)}
                                          className="p-1 rounded text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
                                          title="Remove photo"
                                          aria-label={`Remove photo ${img.name}`}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Voice Notes Section */}
                      {note.voiceNotes && note.voiceNotes.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-theme-tertiary flex items-center gap-1.5">
                              <Volume2 className="w-3.5 h-3.5 accent-text" />
                              Voice Notes ({note.voiceNotes.length})
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {note.voiceNotes.map(vn => {
                              const isPlaying = activeVoicePlayerId === vn.id;
                              return (
                                <div
                                  key={vn.id}
                                  className={`flex flex-col p-3 rounded-xl border transition-all ${
                                    isPlaying ? 'border-purple-500/50 bg-purple-500/5 shadow-sm' : 'theme-border theme-card'
                                  } gap-2`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <button
                                      type="button"
                                      onClick={() => void togglePlayVoiceNote(vn)}
                                      className={`p-2.5 rounded-xl shrink-0 transition-transform active:scale-95 ${
                                        isPlaying ? 'bg-purple-600 text-white shadow-md' : 'accent-soft accent-text theme-hover'
                                      }`}
                                      title={isPlaying ? 'Pause' : 'Play voice note'}
                                      aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
                                    >
                                      {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                                    </button>
                                    <div className="min-w-0 flex-1">
                                      <input
                                        type="text"
                                        defaultValue={vn.title}
                                        disabled={!canEditNote}
                                        onBlur={e => handleRenameVoiceNote(vn.id, e.target.value)}
                                        className="w-full bg-transparent text-xs font-semibold text-theme-primary outline-none border-b border-transparent focus:border-purple-400/50 truncate"
                                      />
                                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-theme-tertiary">
                                        <span>
                                          {Math.floor((vn.durationSeconds || 0) / 60)}:{(vn.durationSeconds % 60).toString().padStart(2, '0')}
                                        </span>
                                        <span>•</span>
                                        <span>{formatFileSize(vn.size)}</span>
                                        {vn.source === 'generated-tts' && (
                                          <span className="rounded bg-indigo-500/10 px-1 py-0.5 text-[9px] font-bold text-indigo-600">Spoken</span>
                                        )}
                                        {vn.pendingUpload && (
                                          <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] font-bold text-amber-600">On device</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => void handleTranscribeVoiceNote(vn)}
                                        disabled={transcribingVoiceId === vn.id}
                                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold accent-soft accent-text theme-hover disabled:opacity-50"
                                        title="Transcribe voice note to text"
                                        aria-label={`Transcribe ${vn.title}`}
                                      >
                                        {transcribingVoiceId === vn.id ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                          <Sparkles className="w-3.5 h-3.5" />
                                        )}
                                        <span className="hidden sm:inline">Transcribe</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => cyclePlaybackRate(vn.id)}
                                        className="px-1.5 py-1 rounded text-[10px] font-bold theme-hover text-theme-secondary"
                                        title="Playback speed"
                                      >
                                        {voicePlaybackRate}x
                                      </button>
                                      {vn.objectId && !vn.objectId.startsWith('local-') && (
                                        <button
                                          type="button"
                                          onClick={() => void openOrDownloadStorageFile('voiceNotes', vn.objectId, `${vn.title}.webm`, true)}
                                          className="p-1.5 rounded-lg theme-hover text-theme-secondary"
                                          title="Download audio"
                                          aria-label={`Download ${vn.title}`}
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      {canEditNote && (
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveVoiceNote(vn)}
                                          className="p-1.5 rounded-lg text-red-500/70 hover:text-red-500 hover:bg-red-500/10"
                                          title="Delete voice note"
                                          aria-label={`Delete voice note ${vn.title}`}
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {vn.transcript && (
                                    <div className="mt-1 rounded-lg bg-[var(--app-bg-subtle)] p-2 text-[11px] text-theme-secondary border theme-border">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="font-bold text-[10px] uppercase text-theme-tertiary">Transcript</span>
                                        <button
                                          type="button"
                                          onClick={() => setReviewTranscript({ text: vn.transcript!, audioName: vn.title, voiceNoteId: vn.id })}
                                          className="text-[10px] font-bold accent-text hover:underline"
                                        >
                                          Review & Insert
                                        </button>
                                      </div>
                                      <p className="line-clamp-2 italic text-theme-primary">“{vn.transcript}”</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Attachments Section */}
                      {note.attachments && note.attachments.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-theme-tertiary flex items-center gap-1.5">
                              <Paperclip className="w-3.5 h-3.5 accent-text" />
                              Attachments ({note.attachments.length})
                            </h4>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {note.attachments.map(att => (
                              <div
                                key={att.id}
                                className="flex items-center justify-between p-2.5 rounded-xl border theme-border theme-card gap-3 transition-colors"
                              >
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                  <div className="p-2 rounded-lg bg-[var(--app-bg-subtle)] text-theme-secondary shrink-0">
                                    <FileIcon className="w-4 h-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium text-theme-primary truncate" title={att.name}>
                                      {att.name}
                                    </p>
                                    <p className="text-[10px] text-theme-tertiary">
                                      {formatFileSize(att.size)} • {format(new Date(att.createdAt), 'MMM d, yyyy')}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAttachment(att)}
                                    className="p-1.5 rounded-lg theme-hover text-theme-secondary hover:text-theme-primary"
                                    title="Open or download file"
                                    aria-label={`Open or download ${att.name}`}
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  {canEditNote && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveAttachment(att)}
                                      className="p-1.5 rounded-lg text-red-500/80 hover:text-red-500 hover:bg-red-500/10"
                                      title="Remove attachment"
                                      aria-label={`Remove attachment ${att.name}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Collapsible Sharing & Activity Section */}
              <div className="mt-8 pt-4 border-t theme-divider" data-testid="collaboration-summary-section">
                <button
                  type="button"
                  onClick={() => setIsCollaborationExpanded(!isCollaborationExpanded)}
                  className="w-full flex items-center justify-between p-3.5 rounded-2xl border theme-border theme-hover text-left transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl theme-muted-surface text-theme-secondary">
                      <Share2 className="w-4 h-4" />
                    </span>
                    <div>
                      <p className="text-xs font-bold text-theme-primary">Sharing & Activity</p>
                      <p className="text-[11px] text-theme-tertiary">
                        {note.isShared ? `${roleLabels[accessRole]} access` : 'Private note'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-theme-tertiary transition-transform ${isCollaborationExpanded ? 'rotate-180' : ''}`} />
                </button>
                {isCollaborationExpanded && (
                  <div className="mt-3 animate-in fade-in duration-150">
                    <NoteCollaborationPanel note={note} accessRole={accessRole} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile-Native Bottom Keyboard-Adjacent Action Bar (phone viewports) */}
      {!isLocked && canEditNote && (
        <div
          className="sm:hidden flex items-center justify-between px-3 py-1.5 border-t theme-divider bg-[var(--card-bg)] shrink-0 z-20"
          style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-1">
            {/* Quick formatting trigger */}
            {note.type !== 'checklist' && (
              <button
                type="button"
                onClick={() => setShowMobileFormatSheet(v => !v)}
                className={`p-2 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
                  showMobileFormatSheet ? 'accent-soft accent-text' : 'theme-hover text-theme-secondary'
                }`}
                aria-label="Text formatting"
                title="Format text"
              >
                <Type className="w-5 h-5" />
              </button>
            )}

            {/* Checkbox toggle */}
            <button
              type="button"
              onClick={() => insertAtLineStart('- [ ] ')}
              className="p-2 rounded-xl theme-hover text-theme-secondary min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Add task checklist"
              title="Add task checklist"
            >
              <CheckSquare className="w-5 h-5" />
            </button>

            {/* Attach media */}
            <button
              type="button"
              onClick={() => setShowAddMediaMenu(v => !v)}
              className="p-2 rounded-xl theme-hover text-theme-secondary min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Attach photo or audio"
              title="Add media"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* NTK AI Assist */}
            {settings.aiEnabled && (
              <button
                type="button"
                onClick={openAiPanel}
                className="p-2 rounded-xl theme-hover text-[var(--accent-primary)] min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="NTK AI writing assistant"
                title="NTK AI"
              >
                <Sparkles className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Right side of mobile bar: Undo / Redo */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={undoNoteChange}
              disabled={!historyStatus.canUndo}
              className="p-2 rounded-xl theme-hover text-theme-secondary disabled:opacity-30 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Undo note edit"
            >
              <Undo2 className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={redoNoteChange}
              disabled={!historyStatus.canRedo}
              className="p-2 rounded-xl theme-hover text-theme-secondary disabled:opacity-30 min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Redo note edit"
            >
              <Redo2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Quick Mobile Formatting Sheet (slides up directly above keyboard) */}
      {showMobileFormatSheet && !isLocked && canEditNote && (
        <div className="sm:hidden border-t theme-divider bg-[var(--app-bg-subtle)] px-3 py-2 flex items-center gap-2 overflow-x-auto shrink-0 animate-slide-in">
          <button
            type="button"
            onClick={() => insertFormatting('**', '**')}
            className="px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] text-xs font-bold text-theme-primary min-h-[38px] shrink-0"
            aria-label="Bold"
          >
            Bold
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('*', '*')}
            className="px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] text-xs font-bold italic text-theme-primary min-h-[38px] shrink-0"
            aria-label="Italic"
          >
            Italic
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('# ')}
            className="px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] text-xs font-bold text-theme-primary min-h-[38px] shrink-0"
            aria-label="Heading"
          >
            H1
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('## ')}
            className="px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] text-xs font-bold text-theme-primary min-h-[38px] shrink-0"
            aria-label="Subheading"
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('- ')}
            className="px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] text-xs font-bold text-theme-primary min-h-[38px] shrink-0"
            aria-label="Bullet list"
          >
            Bullet
          </button>
          <button
            type="button"
            onClick={() => insertFormatting('[', '](url)')}
            className="px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] text-xs font-bold text-theme-primary min-h-[38px] shrink-0"
            aria-label="Insert link"
          >
            Link
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('> ')}
            className="px-3 py-1.5 rounded-lg border theme-border bg-[var(--card-bg)] text-xs font-bold text-theme-primary min-h-[38px] shrink-0"
            aria-label="Quote"
          >
            Quote
          </button>
        </div>
      )}

      {/* Status bar — desktop only */}
      {settings.showWordCount && (
        <div className="hidden sm:flex items-center justify-between px-4 py-1.5 border-t theme-divider text-xs text-theme-tertiary shrink-0">
          <div className="flex items-center gap-4">
            <span>{note.wordCount} words</span>
            <span>{note.charCount} characters</span>
            {note.type === 'checklist' && (
              <span>{activeChecklist.filter(c => c.checked).length}/{activeChecklist.length} tasks</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="capitalize">{note.type}</span>
            {note.priority && (
              <span className={priorityConfig[note.priority].color}>
                {priorityConfig[note.priority].icon} {priorityConfig[note.priority].label}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Sketch Modal */}
      <SketchModal
        isOpen={showSketchModal}
        onClose={() => setShowSketchModal(false)}
        onSave={handleInsertDrawing}
      />

      {/* Share Modal */}
      <ShareModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        entityType="note"
        entityId={note.id}
      />
      <NtkAiPanel
        open={showAiPanel}
        onClose={() => setShowAiPanel(false)}
        noteTitle={title}
        noteContent={content}
        selectedText={aiSelection.text}
        writingStyle={settings.aiWritingStyle}
        onReplaceSelection={replaceAiSelection}
        onInsertBelow={insertAiBelow}
        onReplaceNote={value => updateContentWithHistory(value)}
      />

      {showMoveMenu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="move-note-dialog-title"
          onMouseDown={closeMoveSurface}
        >
          <div
            className="flex max-h-[82dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border theme-menu shadow-2xl"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b theme-divider px-5 py-4">
              <div className="min-w-0">
                <p id="move-note-dialog-title" className="text-lg font-bold text-theme-primary">Move note</p>
                <p className="mt-1 truncate text-sm text-theme-tertiary">
                  {title || noteDisplayTitle(note)} is in {notebook?.name || 'a notebook'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeMoveSurface}
                className="rounded-lg p-2 text-theme-tertiary theme-hover"
                aria-label="Close move note dialog"
              >
                <X className="h-5 w-5 no-transition" />
              </button>
            </div>

            <div className="border-b theme-divider px-5 py-4">
              <label className="flex items-center gap-2 rounded-xl border theme-border theme-input px-3 py-2.5">
                <Search className="h-4 w-4 shrink-0 text-theme-tertiary no-transition" />
                <input
                  value={notebookSearch}
                  onChange={e => setNotebookSearch(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm text-theme-primary outline-none"
                  placeholder="Search notebooks..."
                  autoFocus
                />
              </label>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
              <MoveNotebookList
                rows={filteredNotebookRows}
                currentNotebookId={note.notebookId}
                getNoteCount={getNotebookNoteCount}
                onMove={handleMoveToNotebook}
                emptyTitle="No notebook matches your search."
                emptyHint="Try a shorter name or clear the search field."
              />
            </div>
          </div>
        </div>
      )}
      {showVersionHistory && (
        <VersionHistory
          noteId={note.id}
          onClose={() => setShowVersionHistory(false)}
          onRestore={handleRestoreVersion}
          presentation={versionHistoryPresentation}
        />
      )}
      {/* Image Lightbox Modal */}
      {selectedLightboxImage && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedLightboxImage(null)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <a
              href={selectedLightboxImage.url}
              download={selectedLightboxImage.name}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Download image"
              aria-label="Download image"
            >
              <Download className="w-5 h-5" />
            </a>
            <button
              type="button"
              onClick={() => setSelectedLightboxImage(null)}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="Close photo preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="max-w-4xl max-h-[80vh] flex flex-col items-center justify-center" onClick={e => e.stopPropagation()}>
            <img
              src={selectedLightboxImage.url}
              alt={selectedLightboxImage.name}
              className="max-h-[75vh] max-w-full rounded-2xl object-contain shadow-2xl"
            />
            {selectedLightboxImage.caption && (
              <p className="mt-3 text-sm text-white/80 text-center font-medium">
                {selectedLightboxImage.caption}
              </p>
            )}
          </div>
        </div>
      )}


      {/* Transcription Review Flow */}
      {reviewTranscript && (
        <TranscriptReviewModal
          isOpen={true}
          transcript={reviewTranscript.text}
          audioName={reviewTranscript.audioName}
          hasSelection={aiSelection.end > aiSelection.start}
          onClose={() => setReviewTranscript(null)}
          onInsertBelow={(t) => {
            insertAiBelow(t);
            setReviewTranscript(null);
            showActionToast('Transcript inserted below.');
          }}
          onReplaceSelection={aiSelection.end > aiSelection.start ? (t) => {
            replaceAiSelection(t);
            setReviewTranscript(null);
            showActionToast('Selection replaced with transcript.');
          } : undefined}
          onCreateNewNote={async (t) => {
            await handleCreateNoteFromTranscript(t);
            setReviewTranscript(null);
            showActionToast('Created new note from transcript.');
          }}
          onKeepWithAudio={reviewTranscript.voiceNoteId ? (t) => {
            handleSaveTranscriptToVoiceNote(t, reviewTranscript.voiceNoteId);
            setReviewTranscript(null);
            showActionToast('Transcript attached to audio recording.');
          } : undefined}
        />
      )}

      <ActionToastView toast={actionToast} onClose={() => setActionToast(null)} />
    </div>
  );
}

function MenuBtn({ icon: Icon, label, onClick, danger }: {
  icon: LucideIcon; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
        danger ? 'text-red-600 hover:bg-red-500/10' : 'theme-hover'
      }`}
      style={!danger ? { color: 'var(--text-secondary)' } : {}}
    >
      <Icon className="w-4 h-4 no-transition" /> {label}
    </button>
  );
}

function MenuSectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-theme-tertiary">
      {label}
    </p>
  );
}

function ExportBtn({ icon: Icon, label, onClick }: {
  icon: LucideIcon; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm theme-hover transition-colors"
      style={{ color: 'var(--text-secondary)' }}
    >
      <Icon className="w-3.5 h-3.5 no-transition" /> {label}
    </button>
  );
}

function ExportOptionToggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left theme-hover"
    >
      <span className="text-sm font-medium text-theme-secondary">{label}</span>
      <span
        className="relative h-5 w-9 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--accent-primary)' : 'var(--card-border)' }}
        aria-hidden="true"
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function ExportPanelSection({ title, children }: {
  title: string; children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-theme-tertiary">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function ExportPanelBtn({ icon: Icon, title, meta, onClick }: {
  icon: LucideIcon; title: string; meta: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border theme-border px-3 py-3 text-left transition-colors theme-hover"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg accent-soft">
        <Icon className="h-4 w-4 no-transition" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-theme-primary">{title}</span>
        <span className="block truncate text-xs text-theme-tertiary">{meta}</span>
      </span>
    </button>
  );
}

function ActionToastView({ toast, onClose }: {
  toast: ActionToast | null;
  onClose: () => void;
}) {
  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border theme-menu px-4 py-3 shadow-2xl">
        <span className="min-w-0 flex-1 text-sm font-medium text-theme-primary">{toast.message}</span>
        {toast.undo && (
          <button
            type="button"
            onClick={() => {
              toast.undo?.();
              onClose();
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-bold accent-button"
          >
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-theme-tertiary theme-hover"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4 no-transition" />
        </button>
      </div>
    </div>
  );
}

function MoveNotebookList({
  rows,
  currentNotebookId,
  getNoteCount,
  onMove,
  emptyTitle,
  emptyHint,
  compact = false,
}: {
  rows: NotebookMoveRow[];
  currentNotebookId: string;
  getNoteCount: (notebookId: string) => number;
  onMove: (notebookId: string) => void;
  emptyTitle: string;
  emptyHint: string;
  compact?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed theme-divider px-4 py-6 text-center">
        <p className="text-sm font-medium text-theme-secondary">{emptyTitle}</p>
        <p className="mt-1 text-xs text-theme-tertiary">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map(({ notebook: nb, depth }) => {
        const isCurrent = currentNotebookId === nb.id;
        const noteCount = getNoteCount(nb.id);
        return (
          <button
            type="button"
            key={nb.id}
            onClick={() => {
              if (!isCurrent) onMove(nb.id);
            }}
            disabled={isCurrent}
            className={`flex w-full items-center gap-3 rounded-xl text-left transition-colors disabled:cursor-default ${
              compact ? 'px-3 py-2.5' : 'px-3 py-3'
            } ${isCurrent ? 'theme-active' : 'theme-hover'}`}
            style={{ paddingLeft: `${12 + depth * 18}px` }}
          >
            <span className="text-lg">{nb.icon}</span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-semibold ${isCurrent ? 'accent-text' : 'text-theme-primary'}`}>
                {nb.name}
              </span>
              <span className="block text-xs text-theme-tertiary">
                {noteCount} note{noteCount === 1 ? '' : 's'}{isCurrent ? ' - Current location' : ''}
              </span>
            </span>
            {isCurrent ? (
              <Check className="h-4 w-4 shrink-0 accent-text no-transition" />
            ) : (
              <span className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold accent-soft">
                Move here
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
