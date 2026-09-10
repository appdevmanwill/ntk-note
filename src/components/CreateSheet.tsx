import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Bell, CheckSquare, FileText, FolderInput, LayoutTemplate, X } from 'lucide-react';
import CreateReminderModal from './CreateReminderModal';

interface CreateSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const createOptions = [
  { icon: FileText, label: 'New Note', hint: 'Write anything', action: 'note' },
  { icon: CheckSquare, label: 'Checklist', hint: 'Tasks you can tick off', action: 'checklist' },
  { icon: Bell, label: 'Reminder', hint: 'Remember something at a date and time', action: 'reminder' },
  { icon: LayoutTemplate, label: 'Template', hint: 'Start with friendly guided prompts', action: 'templates' },
  { icon: FileText, label: 'Markdown note', hint: 'Advanced writing format', action: 'markdown' },
] as const;

/** Mobile create sheet — opens from the center "+" in the bottom navigation. */
export default function CreateSheet({ isOpen, onClose }: CreateSheetProps) {
  const { createNote, setCurrentView, openSettings, currentView, selectedNotebookId } = useStore();
  const [showReminderModal, setShowReminderModal] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Preserve the active notebook so items created from inside a folder land there.
  const activeNotebookId = currentView === 'notebooks' ? selectedNotebookId : undefined;

  // Keep a stable ref to the latest onClose so the effect below only runs on
  // open/close transitions and never re-captures the "opener" mid-session.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      // Focus trap: keep Tab cycling inside the sheet.
      const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.documentElement.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen && !showReminderModal) return null;

  const handleSelect = async (action: (typeof createOptions)[number]['action']) => {
    if (action === 'templates') {
      setCurrentView('templates');
      onClose();
    } else if (action === 'reminder') {
      setShowReminderModal(true);
    } else {
      await createNote({ type: action, notebookId: activeNotebookId ?? undefined });
      onClose();
    }
  };

  return (
    <>
      {isOpen && !showReminderModal && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Create new note"
            tabIndex={-1}
            className="relative w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl border theme-border bg-[var(--card-bg)] shadow-2xl outline-none animate-slide-in"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-base font-bold text-theme-primary">Create</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg theme-hover text-theme-tertiary"
                aria-label="Close create menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-3 pb-2 space-y-1">
              {createOptions.map(option => (
                <button
                  key={option.action}
                  type="button"
                  onClick={() => void handleSelect(option.action)}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl theme-hover text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 dark:text-purple-300">
                    <option.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-theme-primary">{option.label}</span>
                    <span className="block text-xs text-theme-tertiary">{option.hint}</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => { openSettings('data'); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl theme-hover text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
                  <FolderInput className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-theme-primary">Import notes</span>
                  <span className="block text-xs text-theme-tertiary">From Evernote, Keep, Notion and more</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showReminderModal && (
        <CreateReminderModal
          isOpen={showReminderModal}
          onClose={() => {
            setShowReminderModal(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
