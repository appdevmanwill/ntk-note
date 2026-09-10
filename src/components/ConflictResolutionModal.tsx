import { useState } from 'react';
import { ShieldCheck, CheckCircle2, Eye, FileText, X, ChevronRight, ChevronDown, Check } from 'lucide-react';
import type { SyncConflict, SyncConflictStrategy, ConflictRecoveryNotice } from '@/types';

export interface ConflictResolutionModalProps {
  isOpen: boolean;
  notice?: ConflictRecoveryNotice | null;
  conflict?: SyncConflict | null;
  onClose: () => void;
  onResolve?: (strategy: SyncConflictStrategy) => void;
  onViewCanonicalNote?: (noteId: string) => void;
}

export default function ConflictResolutionModal({
  isOpen,
  notice,
  conflict,
  onClose,
  onResolve,
  onViewCanonicalNote,
}: ConflictResolutionModalProps) {
  const [showReview, setShowReview] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!isOpen || (!notice && !conflict)) return null;

  const isDeletedRemotely = notice?.type === 'remote_deletion' || Boolean(conflict?.deletedRemotely);
  const title = notice?.title || 'Your edits are safe';
  const message = isDeletedRemotely
    ? (notice?.message || 'This note was deleted on another device, so we saved your unsynced edits as a new note.')
    : (notice?.message || 'This note also changed on another device, so NTK Note saved your edits as a separate copy. Nothing was lost.');

  const localNote = notice?.recoveredNote || conflict?.local;
  const remoteNote = notice?.canonicalNote || conflict?.remote;
  const canonicalNoteId = notice?.canonicalNoteId || conflict?.remote?.id || null;

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return isNaN(d.getTime()) ? isoStr : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString();
    } catch {
      return isoStr;
    }
  };

  return (
    <>
      {/* Screen Reader Live Announcement */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        Your edits were safely saved as a recovered copy.
      </div>

      {/* Main Novice-First Recovery Card (Non-blocking toast/banner) */}
      {!showReview && (
        <aside
          className="fixed bottom-4 right-4 left-4 sm:left-auto sm:right-6 sm:bottom-6 z-50 sm:max-w-md w-auto rounded-2xl border border-emerald-500/30 theme-card shadow-2xl p-4 sm:p-5 overflow-hidden backdrop-blur-md bg-[var(--app-card-bg)]/95 animate-slide-up transition-all"
          role="status"
          aria-labelledby="recovery-card-title"
          aria-describedby="recovery-card-desc"
        >
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true">
              <ShieldCheck className="w-5 h-5" />
            </div>

            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center justify-between gap-2">
                <h3 id="recovery-card-title" className="text-sm sm:text-base font-bold text-theme-primary">
                  {title}
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 rounded-lg theme-hover text-theme-tertiary hover:text-theme-primary cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center -mr-1 -mt-1"
                  aria-label="Dismiss notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p id="recovery-card-desc" className="text-xs text-theme-secondary mt-1 leading-relaxed">
                {message}
              </p>

              {/* Novice Actions */}
              <div className="pt-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                {remoteNote && (
                  <button
                    type="button"
                    onClick={() => setShowReview(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border theme-border text-xs font-semibold text-theme-secondary theme-hover cursor-pointer min-h-[44px]"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Review changes
                  </button>
                )}

                {canonicalNoteId && onViewCanonicalNote && (
                  <button
                    type="button"
                    onClick={() => {
                      onViewCanonicalNote(canonicalNoteId);
                      onClose();
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border theme-border text-xs font-semibold text-theme-secondary theme-hover cursor-pointer min-h-[44px]"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    View latest note
                  </button>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl accent-button text-xs font-semibold cursor-pointer shadow-md min-h-[44px]"
                >
                  <Check className="w-3.5 h-3.5" />
                  Continue editing
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Optional Informational Review Modal */}
      {showReview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-modal-title"
        >
          <div className="relative w-full max-w-2xl rounded-2xl border theme-border theme-card shadow-2xl p-5 sm:p-6 overflow-hidden space-y-5 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b theme-divider pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 id="review-modal-title" className="text-lg font-bold text-theme-primary">
                    Review Note Changes
                  </h3>
                  <p className="text-xs text-theme-tertiary mt-0.5">
                    Your edits are safe and were saved as a separate copy. This preview compares your edits with the latest saved note.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowReview(false)}
                className="p-1.5 rounded-lg theme-hover text-theme-tertiary hover:text-theme-primary cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close review"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Preview Columns (Responsive: 1 column on mobile, 2 columns on tablet/desktop) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto pr-1">
              {/* My Edits */}
              <div className="rounded-xl border theme-border p-4 bg-[var(--app-bg-subtle)]/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    My edits
                  </span>
                  {localNote?.updatedAt && (
                    <span className="text-[11px] text-theme-tertiary">
                      {formatDate(localNote.updatedAt)}
                    </span>
                  )}
                </div>
                <h4 className="font-semibold text-theme-primary text-sm truncate">
                  {localNote?.title || 'Untitled note'}
                </h4>
                <div className="text-xs text-theme-secondary line-clamp-6 font-mono bg-[var(--app-bg)]/40 p-2.5 rounded-lg border theme-border min-h-[5rem] whitespace-pre-wrap">
                  {localNote?.content || '(Empty content)'}
                </div>
                <div className="text-[11px] text-theme-tertiary pt-1">
                  {localNote?.wordCount || 0} words • {localNote?.charCount || 0} characters
                </div>
              </div>

              {/* Latest Saved Note */}
              <div className="rounded-xl border theme-border p-4 bg-[var(--app-bg-subtle)]/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                    Latest saved note
                  </span>
                  {remoteNote?.updatedAt && (
                    <span className="text-[11px] text-theme-tertiary">
                      {formatDate(remoteNote.updatedAt)}
                    </span>
                  )}
                </div>
                <h4 className="font-semibold text-theme-primary text-sm truncate">
                  {remoteNote?.title || 'Untitled note'}
                </h4>
                <div className="text-xs text-theme-secondary line-clamp-6 font-mono bg-[var(--app-bg)]/40 p-2.5 rounded-lg border theme-border min-h-[5rem] whitespace-pre-wrap">
                  {remoteNote?.content || '(Empty content)'}
                </div>
                <div className="text-[11px] text-theme-tertiary pt-1">
                  {remoteNote?.wordCount || 0} words • {remoteNote?.charCount || 0} characters
                </div>
              </div>
            </div>

            {/* Optional Collapsible Advanced Options */}
            {onResolve && conflict && (
              <div className="border-t theme-divider pt-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between text-xs font-semibold text-theme-tertiary hover:text-theme-secondary py-1 cursor-pointer"
                >
                  <span>Advanced options</span>
                  {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>

                {showAdvanced && (
                  <div className="mt-2.5 p-3 rounded-xl bg-[var(--app-bg-subtle)]/40 border theme-border flex flex-wrap items-center justify-end gap-2 text-xs">
                    <span className="text-[11px] text-theme-tertiary mr-auto">
                      Both versions are already saved. Use these only if you want to overwrite one note.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onResolve('use_remote');
                        setShowReview(false);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-lg border theme-border text-theme-secondary hover:text-theme-primary cursor-pointer min-h-[36px]"
                    >
                      Use latest saved note only
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onResolve('keep_local');
                        setShowReview(false);
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-lg border theme-border text-theme-secondary hover:text-theme-primary cursor-pointer min-h-[36px]"
                    >
                      Keep my edits only
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Modal Bottom Action: Informational Close */}
            <div className="pt-3 border-t theme-divider flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowReview(false);
                  onClose();
                }}
                className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl accent-button text-xs sm:text-sm font-semibold cursor-pointer shadow-md min-h-[44px]"
              >
                Done reviewing
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
