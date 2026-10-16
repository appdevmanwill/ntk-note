import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Check, X } from 'lucide-react';
import type { SyncConflict, SyncConflictStrategy } from '@/types';
import { useStore } from '@/store';

interface Props {
  conflict: SyncConflict;
  onResolve: (strategy: SyncConflictStrategy) => void;
}

/** Explicit, non-destructive decision UI for concurrent note edits/deletions. */
export default function PendingNoteConflict({ conflict, onResolve }: Props) {
  const [review, setReview] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const latestDraft = useStore(s => s.notes.find(note => note.id === conflict.noteId));
  const local = latestDraft || conflict.local;
  const remote = conflict.remote;
  const deleted = conflict.deletedRemotely || !remote;

  useEffect(() => {
    const openReview = (event: Event) => {
      if ((event as CustomEvent<{ conflictId: string }>).detail.conflictId === conflict.id) setReview(true);
    };
    window.addEventListener('ntk:review-note-conflict', openReview);
    return () => window.removeEventListener('ntk:review-note-conflict', openReview);
  }, [conflict.id]);

  useEffect(() => {
    if (!review) return;
    const previous = document.activeElement as HTMLElement | null;
    const buttons = () => [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    buttons()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReview(false);
      if (event.key !== 'Tab') return;
      const items = buttons();
      const target = event.shiftKey ? items[items.length - 1] : items[0];
      if (document.activeElement === (event.shiftKey ? items[0] : items[items.length - 1])) {
        event.preventDefault();
        target?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [review]);

  const decide = (strategy: SyncConflictStrategy) => {
    if (strategy === 'use_remote' || strategy === 'keep_deleted') {
      if (!window.confirm(deleted
        ? 'Discard this local draft and keep the remote deletion? This cannot be undone from this screen.'
        : 'Replace your local draft with the cloud version? Review both versions first if unsure.')) return;
    } else if (strategy === 'keep_local') {
      if (!window.confirm(deleted
        ? 'Restore your local draft as this same note in the cloud?'
        : 'Replace the cloud version with your current local edits?')) return;
    }
    onResolve(strategy);
    setReview(false);
  };

  return (
    <>
      {!review && (
        <aside className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] sm:w-96 p-4 rounded-2xl border border-amber-400/60 theme-card shadow-2xl"
          role="alert" aria-label="Note sync conflict needs your decision">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-sm text-theme-primary"><AlertTriangle className="w-5 h-5 text-amber-500" /> Two note versions need review</div>
          </div>
          <p className="text-xs text-theme-secondary mt-2">
            {deleted ? 'This note was removed on another device. Your local edits remain unsynced and have not been duplicated.'
              : 'Cloud and local edits differ. Your work is still here; no recovered copy was created.'}
          </p>
          <button type="button" onClick={() => setReview(true)} className="mt-3 w-full min-h-11 rounded-xl accent-button font-semibold text-xs inline-flex items-center justify-center gap-2">
            <ArrowLeftRight className="w-4 h-4" /> Compare and choose
          </button>
        </aside>
      )}
      {review && (
        <div className="fixed inset-0 z-[70] bg-black/65 flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="conflict-choice-heading">
          <div ref={panelRef} className="max-w-3xl w-full rounded-2xl theme-card border theme-border p-4 sm:p-6 shadow-2xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <h2 id="conflict-choice-heading" className="font-bold text-theme-primary text-lg">Choose which note to keep</h2>
              <button type="button" className="min-h-11 min-w-11 flex items-center justify-center" onClick={() => setReview(false)} aria-label="Close comparison"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-theme-secondary mt-2">Review both versions before deciding. Only one note ID will remain; history is separate from the notes list.</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <section className="border theme-border rounded-xl p-3 min-w-0">
                <h3 className="text-sm font-bold text-theme-primary">Current local edits</h3>
                <p className="text-xs text-theme-tertiary my-1">{local.updatedAt ? new Date(local.updatedAt).toLocaleString() : 'Unknown edit time'}</p>
                <p className="text-sm font-semibold text-theme-primary break-words">{local.title || 'Untitled'}</p>
                <pre className="text-xs text-theme-secondary whitespace-pre-wrap break-words mt-2 max-h-52 overflow-auto">{local.content || '(Empty note)'}</pre>
                <NoteDetails note={local} />
              </section>
              <section className="border theme-border rounded-xl p-3 min-w-0">
                <h3 className="text-sm font-bold text-theme-primary">{deleted ? 'Cloud copy deleted' : 'Saved cloud version'}</h3>
                {!deleted && remote && <>
                  <p className="text-xs text-theme-tertiary my-1">{remote.updatedAt ? new Date(remote.updatedAt).toLocaleString() : 'Unknown edit time'}</p>
                  <p className="text-sm font-semibold text-theme-primary break-words">{remote.title || 'Untitled'}</p>
                  <pre className="text-xs text-theme-secondary whitespace-pre-wrap break-words mt-2 max-h-52 overflow-auto">{remote.content || '(Empty note)'}</pre>
                  <NoteDetails note={remote} />
                </>}
                {deleted && <p className="text-xs text-theme-tertiary mt-2">No cloud version exists. You may restore the current local draft using its original note ID.</p>}
              </section>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 mt-5">
              <button type="button" className="min-h-11 px-3 py-2 border theme-border rounded-xl text-sm" onClick={() => setReview(false)}>Review later</button>
              <button type="button" className="min-h-11 px-3 py-2 border theme-border rounded-xl text-sm" onClick={() => decide(deleted ? 'keep_deleted' : 'use_remote')}>
                {deleted ? 'Keep deleted' : 'Keep cloud version'}
              </button>
              <button type="button" className="min-h-11 px-3 py-2 accent-button rounded-xl text-sm font-semibold inline-flex items-center gap-1" onClick={() => decide('keep_local')}>
                <Check className="w-4 h-4" /> {deleted ? 'Restore my draft' : 'Keep my current edits'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NoteDetails({ note }: { note: SyncConflict['local'] }) {
  return <div className="mt-3 space-y-1 text-xs text-theme-secondary break-words">
    {note.encrypted && <p>Encrypted note: unlock it in the editor to inspect its text before choosing.</p>}
    <p>Tags: {(note.tags || []).join(', ') || 'None'} · Notebook: {useStore.getState().notebooks.find(n => n.id === note.notebookId)?.name || note.notebookId || 'None'}</p>
    {(note.checklist || []).map(item => <p key={item.id}>{item.checked ? '☑' : '☐'} {item.text}</p>)}
    <p>Attachments: {(note.attachments || []).map(a => a.name).join(', ') || 'None'}</p>
    <p>Audio: {(note.voiceNotes || []).map(a => a.title).join(', ') || 'None'}</p>
    <p>Images: {(note.images || []).length} · Photos: {(note.photos || []).length}</p>
  </div>;
}
