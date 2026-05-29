import { useState, useEffect } from 'react';
import { db } from '@/utils/firebase';
import { doc, getDoc } from 'firebase/firestore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Lock, Globe, Clock, Sparkles } from 'lucide-react';
import type { Note } from '@/types';

interface PublicNoteReaderProps {
  noteId: string;
}

export default function PublicNoteReader({ noteId }: PublicNoteReaderProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    getDoc(doc(db, 'shared_notes', noteId))
      .then(docSnap => {
        if (docSnap.exists()) {
          const data = docSnap.data() as Note;
          if (data.isPublished) {
            setNote(data);
          } else {
            setError('This note is private or is no longer shared publicly.');
          }
        } else {
          setError('This note does not exist.');
        }
      })
      .catch(err => {
        console.error(err);
        setError('Failed to fetch the public note. Please check your connection.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [noteId]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#f5f7fa] dark:bg-[#111315] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-[var(--accent-primary, #6366f1)] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-theme-secondary">Fetching note...</p>
        </div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="fixed inset-0 bg-[#f5f7fa] dark:bg-[#111315] flex items-center justify-center p-4">
        <div className="text-center max-w-sm p-6 rounded-2xl bg-[var(--card-bg)] border theme-border shadow-xl space-y-4">
          <Lock className="w-12 h-12 mx-auto text-red-500" />
          <h3 className="text-lg font-bold text-theme-primary">Access Denied</h3>
          <p className="text-sm text-theme-tertiary">{error || 'Unable to view this note.'}</p>
          <a
            href="/"
            className="inline-block px-4 py-2 bg-[var(--accent-primary, #6366f1)] text-white text-xs font-bold rounded-xl shadow-lg"
          >
            Go to NTK Note
          </a>
        </div>
      </div>
    );
  }

  const activeTheme = note.theme || 'canvas';

  return (
    <div
      className="min-h-screen flex flex-col note-theme-editor"
      data-note-theme={activeTheme}
      style={{ backgroundColor: 'var(--note-theme-bg, #ffffff)' }}
    >
      {/* Top Banner */}
      <header className="flex items-center justify-between px-6 py-4 border-b theme-divider bg-[var(--card-bg)]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary, #6366f1)] flex items-center justify-center text-white font-bold">
            N
          </div>
          <div>
            <h1 className="text-sm font-extrabold text-theme-primary tracking-wide">NTK Note</h1>
            <p className="text-[10px] text-theme-tertiary">Shared Workspace</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-extrabold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Globe className="w-3 h-3" />
            Public Note
          </span>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 md:py-12">
        <article className="space-y-6">
          {/* Title */}
          <h2
            className="text-3xl md:text-4xl font-extrabold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {note.title || 'Untitled Note'}
          </h2>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-theme-tertiary border-b theme-divider pb-4">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Published: {new Date(note.updatedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </span>
            <span>•</span>
            <span>By {note.sharedBy || 'Collaborator'}</span>
            {note.tags.length > 0 && (
              <>
                <span>•</span>
                <div className="flex flex-wrap gap-1">
                  {note.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 rounded-full bg-[var(--badge-bg)] text-[var(--badge-text)] font-semibold text-[10px]">
                      #{tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Document Content */}
          {note.type === 'checklist' ? (
            <div className="space-y-2">
              {note.checklist.map(item => (
                <div key={item.id} className="flex items-center gap-3 py-1">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    readOnly
                    className="w-4 h-4 rounded text-[var(--accent-primary)] border-theme-divider focus:ring-0 cursor-not-allowed"
                  />
                  <span className={`text-sm ${item.checked ? 'line-through text-theme-tertiary' : 'text-theme-primary'}`}>
                    {item.text}
                  </span>
                </div>
              ))}
              {note.content && (
                <div className="mt-6 pt-4 border-t theme-divider text-sm leading-relaxed">
                  {note.content}
                </div>
              )}
            </div>
          ) : (
            <div
              className="note-content prose dark:prose-invert max-w-none text-base leading-relaxed"
              style={{ color: 'var(--text-primary)' }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content}</ReactMarkdown>
            </div>
          )}
        </article>
      </main>

      {/* Footer Branding */}
      <footer className="py-8 border-t theme-divider bg-[var(--card-bg)]/40 text-center space-y-2 shrink-0">
        <p className="text-xs text-theme-tertiary flex items-center justify-center gap-1 font-semibold">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          Created and published with <span className="text-[var(--accent-primary, #6366f1)] font-bold">NTK Note</span>
        </p>
        <p className="text-[10px] text-theme-muted">
          Your modern, offline-first personal second brain.
        </p>
      </footer>
    </div>
  );
}
