import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { Bell, CheckSquare, FileText, FolderInput, FolderPlus, LayoutTemplate, X } from 'lucide-react';
import CreateReminderModal from './CreateReminderModal';
import NewNotebookModal from './NewNotebookModal';

interface CreateSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

const createOptions = [
  { icon: FileText, label: 'New Note', hint: 'Write anything', action: 'note', colorClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-300' },
  { icon: CheckSquare, label: 'New Checklist', hint: 'Tasks you can tick off', action: 'checklist', colorClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' },
  { icon: FolderPlus, label: 'New Notebook', hint: 'Create a notebook to group notes', action: 'notebook', colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-300' },
  { icon: Bell, label: 'Reminder', hint: 'Set a date and time to be reminded', action: 'reminder', colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-300' },
  { icon: LayoutTemplate, label: 'Template', hint: 'Start with guided prompts', action: 'templates', colorClass: 'bg-pink-500/10 text-pink-600 dark:text-pink-300' },
  { icon: FileText, label: 'Markdown note', hint: 'Advanced writing with formatting codes', action: 'markdown', colorClass: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' },
] as const;

/**
 * Mobile create action sheet.
 * Native iOS/Android bottom sheet with drag indicator, focus trap, and touch-sized targets.
 */
export default function CreateSheet({ isOpen, onClose }: CreateSheetProps) {
  const { createNote, setCurrentView, openSettings, currentView, selectedNotebookId } = useStore();
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [showNotebookModal, setShowNotebookModal] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Preserve the active notebook so items created from inside a folder land there.
  const activeNotebookId = currentView === 'notebooks' ? selectedNotebookId : undefined;

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

  if (!isOpen && !showReminderModal && !showNotebookModal) return null;

  const handleSelect = async (action: (typeof createOptions)[number]['action']) => {
    if (action === 'templates') {
      setCurrentView('templates');
      onClose();
    } else if (action === 'reminder') {
      setShowReminderModal(true);
    } else if (action === 'notebook') {
      setShowNotebookModal(true);
    } else {
      await createNote({ type: action, notebookId: activeNotebookId ?? undefined });
      onClose();
    }
  };

  return (
    <>
      {isOpen && !showReminderModal && !showNotebookModal && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="Create new item"
            tabIndex={-1}
            className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border theme-border bg-[var(--card-bg)] shadow-2xl outline-none animate-slide-in max-h-[85dvh] flex flex-col"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            {/* Visual Drag Handle for Mobile Native Feel */}
            <div className="pt-3 pb-1 flex justify-center sm:hidden" aria-hidden="true">
              <div className="w-12 h-1.5 rounded-full bg-[var(--text-tertiary)]/30" />
            </div>

            <div className="flex items-center justify-between px-5 py-2">
              <h2 className="text-base font-bold text-theme-primary">Create</h2>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl theme-hover text-theme-tertiary min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close create menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-3 pb-2 space-y-1 overflow-y-auto">
              {createOptions.map(option => (
                <button
                  key={option.action}
                  type="button"
                  onClick={() => void handleSelect(option.action)}
                  className="w-full min-h-[52px] flex items-center gap-3.5 px-3 py-2.5 rounded-2xl theme-hover text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 active:scale-[0.99]"
                >
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${option.colorClass} shrink-0`}>
                    <option.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-theme-primary">{option.label}</span>
                    <span className="block text-xs text-theme-tertiary truncate">{option.hint}</span>
                  </span>
                </button>
              ))}

              <button
                type="button"
                onClick={() => { openSettings('data'); onClose(); }}
                className="w-full min-h-[52px] flex items-center gap-3.5 px-3 py-2.5 rounded-2xl theme-hover text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 active:scale-[0.99]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 shrink-0">
                  <FolderInput className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-theme-primary">Import notes</span>
                  <span className="block text-xs text-theme-tertiary truncate">From Evernote, Keep, Notion and files</span>
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

      {showNotebookModal && (
        <NewNotebookModal
          isOpen={showNotebookModal}
          onClose={() => {
            setShowNotebookModal(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
