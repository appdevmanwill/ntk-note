import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

export interface RecycleBinConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  notesCount?: number;
  notebooksCount?: number;
  itemName?: string;
  isSharedNote?: boolean;
  isNotebook?: boolean;
  activeNotesCountInNotebook?: number;
  isBusy?: boolean;
  progressText?: string;
}

export default function RecycleBinConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  notesCount = 0,
  notebooksCount = 0,
  itemName,
  isSharedNote = false,
  isNotebook = false,
  activeNotesCountInNotebook = 0,
  isBusy = false,
  progressText,
}: RecycleBinConfirmModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap and Escape key listener (Section 44)
  useEffect(() => {
    if (!isOpen) return;

    // Focus cancel button on open
    const focusTimer = window.setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isBusy) onClose();
        return;
      }
      if (e.key !== 'Tab' || !modalRef.current) return;

      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isBusy, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-description"
      onClick={e => {
        if (e.target === e.currentTarget && !isBusy) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-2xl border theme-card shadow-2xl overflow-hidden p-6 animate-scale-in"
        style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex-1">
            <h3 id="confirm-modal-title" className="text-lg font-bold text-theme-primary">
              {title}
            </h3>

            <div id="confirm-modal-description" className="mt-2 space-y-2 text-sm text-theme-secondary">
              {itemName && (
                <p className="font-semibold text-theme-primary truncate">
                  “{itemName}”
                </p>
              )}

              {notesCount > 0 || notebooksCount > 0 ? (
                <p>
                  This will permanently delete{' '}
                  <span className="font-semibold text-theme-primary">
                    {[
                      notesCount > 0 ? `${notesCount} note${notesCount === 1 ? '' : 's'}` : null,
                      notebooksCount > 0 ? `${notebooksCount} notebook${notebooksCount === 1 ? '' : 's'}` : null,
                    ].filter(Boolean).join(' and ')}
                  </span>.
                </p>
              ) : null}

              {isSharedNote && (
                <div className="rounded-lg p-2.5 border border-amber-500/20 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
                  This note is shared with other people. Permanently deleting it will also remove their access.
                </div>
              )}

              {isNotebook && (
                <p className="text-xs text-theme-tertiary">
                  {activeNotesCountInNotebook > 0
                    ? `Active notes inside this notebook (${activeNotesCountInNotebook}) will be safely moved to Default / All Notes.`
                    : 'Any trashed notes in this notebook will also be permanently deleted.'}
                </p>
              )}

              <p className="text-xs text-theme-tertiary">
                These items will be permanently removed from your live NTK Note workspace and cannot be restored from the Recycle Bin.
              </p>
            </div>

            {isBusy && progressText && (
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold accent-text">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{progressText}</span>
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="px-4 py-2 rounded-xl border theme-border theme-hover text-sm font-semibold text-theme-secondary disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void onConfirm()}
                disabled={isBusy}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2 transition-all shadow-md"
              >
                {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{isBusy ? 'Deleting...' : 'Delete permanently'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
