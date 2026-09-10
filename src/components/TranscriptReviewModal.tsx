import { useState } from 'react';
import {
  Check,
  Copy,
  FilePlus2,
  FileText,
  Replace,
  Save,
  Sparkles,
  X,
} from 'lucide-react';

export interface TranscriptReviewModalProps {
  isOpen: boolean;
  transcript: string;
  audioName: string;
  hasSelection?: boolean;
  onClose: () => void;
  onInsertBelow: (text: string) => void;
  onReplaceSelection?: (text: string) => void;
  onCreateNewNote: (text: string) => void;
  onKeepWithAudio?: (text: string) => void;
}

export default function TranscriptReviewModal({
  isOpen,
  transcript: initialTranscript,
  audioName,
  hasSelection = false,
  onClose,
  onInsertBelow,
  onReplaceSelection,
  onCreateNewNote,
  onKeepWithAudio,
}: TranscriptReviewModalProps) {
  const [text, setText] = useState(initialTranscript);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transcript-review-title"
    >
      <div className="theme-card max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-3xl border theme-border p-5 shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b theme-border pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl accent-soft accent-text">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h3 id="transcript-review-title" className="text-base font-bold text-theme-primary">
                Review Transcription
              </h3>
              <p className="truncate text-xs text-theme-tertiary max-w-[280px] sm:max-w-md">
                From: {audioName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-theme-tertiary theme-hover"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Editable Transcript Body */}
        <div className="mt-4">
          <label className="block text-xs font-bold text-theme-secondary mb-1.5">
            Transcript text — you can edit before applying
          </label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={7}
            className="w-full rounded-xl border theme-input p-3 text-sm leading-relaxed outline-none accent-focus"
            placeholder="No transcript content…"
          />
        </div>

        {/* Actions */}
        <div className="mt-5 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                onInsertBelow(text);
                onClose();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl accent-button px-3.5 py-2.5 text-xs font-bold shadow-sm"
            >
              <FileText className="h-4 w-4" />
              <span>Insert below</span>
            </button>

            {hasSelection && onReplaceSelection && (
              <button
                type="button"
                onClick={() => {
                  onReplaceSelection(text);
                  onClose();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border theme-border theme-hover px-3.5 py-2.5 text-xs font-bold text-theme-primary"
              >
                <Replace className="h-4 w-4" />
                <span>Replace selected text</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onCreateNewNote(text);
                onClose();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border theme-border theme-hover px-3.5 py-2.5 text-xs font-bold text-theme-primary"
            >
              <FilePlus2 className="h-4 w-4" />
              <span>Create new note</span>
            </button>

            {onKeepWithAudio && (
              <button
                type="button"
                onClick={() => {
                  onKeepWithAudio(text);
                  onClose();
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border theme-border theme-hover px-3.5 py-2.5 text-xs font-bold text-theme-primary"
              >
                <Save className="h-4 w-4" />
                <span>Keep with audio</span>
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-t theme-border pt-3 mt-3">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded-lg border theme-border theme-hover px-3 py-1.5 text-xs font-semibold text-theme-secondary"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy transcript</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-theme-tertiary theme-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
