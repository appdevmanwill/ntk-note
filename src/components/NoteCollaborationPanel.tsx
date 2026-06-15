import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Send, ShieldCheck, UserRound, Activity, LockKeyhole } from 'lucide-react';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { v4 as uuid } from 'uuid';
import { db } from '@/utils/firebase';
import { useStore } from '@/store';
import type { Note, NoteComment, ShareRole } from '@/types';
import { canCommentRole, getEntityParticipants, normalizeEmail, roleLabels } from '@/utils/collaboration';

const mentionPattern = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export default function NoteCollaborationPanel({
  note,
  accessRole,
}: {
  note: Note;
  accessRole: ShareRole;
}) {
  const { uid, profile, activityItems, addActivity } = useStore();
  const [comments, setComments] = useState<NoteComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [saving, setSaving] = useState(false);
  const email = normalizeEmail(profile.email);
  const participants = useMemo(() => {
    const values = new Set(getEntityParticipants(note, note.sharedBy || profile.email));
    if (email) values.add(email);
    return [...values].filter(Boolean);
  }, [email, note, profile.email]);
  const canComment = canCommentRole(accessRole);

  useEffect(() => {
    if (!uid || !email || !note.isShared) {
      setComments([]);
      return;
    }

    const commentsQuery = query(collection(db, 'note_comments'), where('participants', 'array-contains', email));
    return onSnapshot(commentsQuery, snapshot => {
      const next = snapshot.docs
        .map(item => item.data() as NoteComment)
        .filter(comment => comment.noteId === note.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      setComments(next);
    }, error => {
      console.error('Comment sync failed:', error);
    });
  }, [email, note.id, note.isShared, uid]);

  const noteActivity = activityItems
    .filter(item => item.noteId === note.id)
    .slice(0, 5);

  const submitComment = async () => {
    const body = commentText.trim();
    if (!uid || !email || !body || !canComment) return;
    setSaving(true);
    const mentions = [...body.matchAll(mentionPattern)]
      .map(match => normalizeEmail(match[1]))
      .filter(Boolean);
    const commentParticipants = [...new Set([...participants, ...mentions, email])];
    const comment: NoteComment = {
      id: uuid(),
      noteId: note.id,
      body,
      authorEmail: email,
      authorName: profile.name || email,
      mentions,
      participants: commentParticipants,
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'note_comments', comment.id), comment);
      await addActivity({
        entityType: 'note',
        entityId: note.id,
        noteId: note.id,
        action: 'comment-added',
        message: `Commented on ${note.title || 'Untitled note'}.`,
        participants: commentParticipants,
        shared: true,
      });
      setCommentText('');
    } catch (error) {
      console.error('Could not add comment:', error);
    } finally {
      setSaving(false);
    }
  };

  if (!note.isShared) return null;

  return (
    <section className="mt-8 rounded-2xl border theme-border bg-[var(--card-bg)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--active-bg)] accent-text">
            <MessageSquare className="h-5 w-5 no-transition" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-theme-primary">Collaboration</h3>
            <p className="text-xs text-theme-tertiary">
              Your access: <span className="font-semibold text-theme-secondary">{roleLabels[accessRole]}</span>
            </p>
          </div>
        </div>
        <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--badge-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--badge-text)]">
          <ShieldCheck className="h-3.5 w-3.5 no-transition" />
          {participants.length} participant{participants.length === 1 ? '' : 's'}
        </div>
      </div>

      {!uid && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border theme-border bg-[var(--input-bg)] p-3 text-xs text-theme-tertiary">
          <LockKeyhole className="h-4 w-4 shrink-0 no-transition" />
          Sign in to sync comments and activity across your devices.
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">
          <div className="space-y-2">
            {comments.length === 0 ? (
              <div className="rounded-xl border theme-border bg-[var(--input-bg)] p-3 text-sm text-theme-tertiary">
                No comments yet.
              </div>
            ) : (
              comments.map(comment => (
                <article key={comment.id} className="rounded-xl border theme-border bg-[var(--input-bg)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <UserRound className="h-4 w-4 shrink-0 text-theme-tertiary no-transition" />
                      <p className="truncate text-xs font-semibold text-theme-secondary">{comment.authorName || comment.authorEmail}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-theme-muted">
                      {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-theme-primary">{comment.body}</p>
                </article>
              ))
            )}
          </div>

          <div className="rounded-xl border theme-border bg-[var(--input-bg)] p-2">
            <textarea
              value={commentText}
              onChange={event => setCommentText(event.target.value)}
              disabled={!uid || !canComment}
              rows={3}
              placeholder={canComment ? 'Add a comment. Mention a collaborator with @email@example.com' : 'You can view comments, but this role cannot add comments.'}
              className="w-full resize-none bg-transparent px-2 py-2 text-sm text-theme-primary placeholder:text-theme-muted outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void submitComment()}
                disabled={!commentText.trim() || saving || !uid || !canComment}
                className="inline-flex items-center gap-2 rounded-lg accent-button px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5 no-transition" />
                Comment
              </button>
            </div>
          </div>
        </div>

        <aside className="rounded-xl border theme-border bg-[var(--input-bg)] p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-theme-tertiary">
            <Activity className="h-4 w-4 no-transition" />
            Recent activity
          </div>
          {noteActivity.length === 0 ? (
            <p className="text-sm text-theme-tertiary">No activity recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {noteActivity.map(item => (
                <div key={item.id} className="border-b pb-3 last:border-b-0 last:pb-0 theme-divider">
                  <p className="text-sm font-medium leading-5 text-theme-secondary">{item.message}</p>
                  <p className="mt-1 text-[11px] text-theme-muted">
                    {item.actorName || item.actorEmail} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
