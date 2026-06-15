import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity, AlertTriangle, BookOpen, CalendarClock, DownloadCloud,
  FileText, FolderPlus, Pin, Settings, Share2, ShieldCheck,
  Trash2, Users, X,
} from 'lucide-react';
import { useStore } from '@/store';
import type { Notebook, Note, TeamSpace } from '@/types';
import { getEntityRole, normalizeEmail, roleLabels } from '@/utils/collaboration';
import ShareModal from './ShareModal';

type ShareTarget = {
  type: 'note' | 'notebook';
  id: string;
} | null;

export default function ShareCenterView() {
  const {
    notes,
    notebooks,
    teamSpaces,
    activityItems,
    profile,
    uid,
    settings,
    createTeamSpace,
    updateTeamSpace,
    deleteTeamSpace,
    updateNotebook,
    selectNote,
    setCurrentView,
  } = useStore();
  const [newSpaceName, setNewSpaceName] = useState('');
  const [shareTarget, setShareTarget] = useState<ShareTarget>(null);
  const email = normalizeEmail(profile.email);

  const sharedNotes = notes.filter(note => note.isShared && !note.trashed);
  const sharedNotebooks = notebooks.filter(notebook => notebook.isShared && !notebook.trashed);
  const sharedByMeNotes = sharedNotes.filter(note => note.ownerId === uid || normalizeEmail(note.sharedBy || '') === email);
  const sharedWithMeNotes = sharedNotes.filter(note => !sharedByMeNotes.includes(note));
  const sharedByMeNotebooks = sharedNotebooks.filter(notebook => notebook.ownerId === uid || normalizeEmail(notebook.sharedBy || '') === email);
  const sharedWithMeNotebooks = sharedNotebooks.filter(notebook => !sharedByMeNotebooks.includes(notebook));

  const spaces = [...teamSpaces].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  const backupDays = settings.lastBackupAt
    ? Math.floor((Date.now() - new Date(settings.lastBackupAt).getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const backupDue = backupDays === null || backupDays >= settings.backupReminderDays;
  const permissionWarnings = useMemo(() => {
    const legacy = [...sharedNotes, ...sharedNotebooks].filter(item =>
      (item.sharedWith?.length || 0) > 0 && (!item.shareAccess || item.shareAccess.length === 0)
    );
    const published = sharedNotes.filter(note => note.isPublished);
    const editorCount = [...sharedNotes, ...sharedNotebooks].reduce((total, item) => total + (item.editors?.length || 0), 0);
    return { legacy, published, editorCount };
  }, [sharedNotes, sharedNotebooks]);

  const createSpace = () => {
    const name = newSpaceName.trim();
    if (!name) return;
    createTeamSpace(name);
    setNewSpaceName('');
  };

  const assignNotebook = (space: TeamSpace, notebookId: string) => {
    if (!notebookId) return;
    const notebook = notebooks.find(item => item.id === notebookId);
    if (!notebook) return;
    const previousSpace = notebook.teamSpaceId ? teamSpaces.find(item => item.id === notebook.teamSpaceId) : null;
    if (previousSpace && previousSpace.id !== space.id) {
      updateTeamSpace(previousSpace.id, {
        notebookIds: previousSpace.notebookIds.filter(id => id !== notebook.id),
      });
    }
    updateNotebook(notebook.id, { teamSpaceId: space.id });
    updateTeamSpace(space.id, {
      notebookIds: [...new Set([...space.notebookIds, notebook.id])],
    });
  };

  const removeNotebookFromSpace = (space: TeamSpace, notebookId: string) => {
    updateNotebook(notebookId, { teamSpaceId: null });
    updateTeamSpace(space.id, {
      notebookIds: space.notebookIds.filter(id => id !== notebookId),
    });
  };

  const openNote = (noteId: string) => {
    selectNote(noteId);
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="mx-auto max-w-6xl space-y-6 p-4 pb-24 md:p-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[var(--badge-bg)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--badge-text)]">
              <Share2 className="h-3.5 w-3.5 no-transition" />
              Share Center
            </div>
            <h1 className="text-3xl font-bold text-theme-primary">Collaboration and backups</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-theme-tertiary">
              Manage shared notes, notebook access, team spaces, activity, and manual cloud backups without adding paid Firebase services.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCurrentView('settings')}
            className="inline-flex w-fit items-center gap-2 rounded-xl accent-button px-4 py-2.5 text-sm font-bold"
          >
            <DownloadCloud className="h-4 w-4 no-transition" />
            Backup settings
          </button>
        </header>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <MetricCard icon={FileText} label="Shared notes" value={sharedNotes.length.toString()} />
          <MetricCard icon={BookOpen} label="Shared notebooks" value={sharedNotebooks.length.toString()} />
          <MetricCard icon={Users} label="Team spaces" value={teamSpaces.length.toString()} />
          <MetricCard
            icon={CalendarClock}
            label="Backup status"
            value={backupDue ? 'Due' : 'Current'}
            tone={backupDue ? 'warn' : 'good'}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-4">
            <Panel title="Team spaces" icon={Users}>
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={newSpaceName}
                  onChange={event => setNewSpaceName(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') createSpace(); }}
                  className="min-w-0 flex-1 rounded-xl border theme-input px-3 py-2.5 text-sm text-theme-primary outline-none accent-focus"
                  placeholder="Create a team space, for example Hosting Team"
                />
                <button
                  type="button"
                  onClick={createSpace}
                  disabled={!newSpaceName.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl accent-button px-4 py-2.5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FolderPlus className="h-4 w-4 no-transition" />
                  Create
                </button>
              </div>

              {spaces.length === 0 ? (
                <EmptyState text="No team spaces yet. Create one to group notebooks for a company or project." />
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {spaces.map(space => {
                    const spaceNotebooks = notebooks.filter(notebook => space.notebookIds.includes(notebook.id) || notebook.teamSpaceId === space.id);
                    const availableNotebooks = notebooks.filter(notebook => !notebook.trashed && notebook.teamSpaceId !== space.id);
                    return (
                      <article key={space.id} className="rounded-2xl border theme-border bg-[var(--card-bg)] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{space.icon}</span>
                              <h3 className="truncate text-base font-bold text-theme-primary">{space.name}</h3>
                            </div>
                            <p className="mt-1 text-xs text-theme-tertiary">
                              {spaceNotebooks.length} notebook{spaceNotebooks.length === 1 ? '' : 's'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateTeamSpace(space.id, { pinned: !space.pinned })}
                              className="rounded-lg p-2 theme-hover"
                              title={space.pinned ? 'Unpin team space' : 'Pin team space'}
                              aria-label={space.pinned ? 'Unpin team space' : 'Pin team space'}
                            >
                              <Pin className={`h-4 w-4 no-transition ${space.pinned ? 'accent-text fill-current' : 'text-theme-tertiary'}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteTeamSpace(space.id)}
                              className="rounded-lg p-2 text-theme-tertiary theme-hover hover:text-red-500"
                              title="Delete team space"
                              aria-label="Delete team space"
                            >
                              <Trash2 className="h-4 w-4 no-transition" />
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 space-y-2">
                          {spaceNotebooks.length === 0 ? (
                            <p className="rounded-xl border theme-border bg-[var(--input-bg)] px-3 py-2 text-xs text-theme-tertiary">
                              No notebooks assigned yet.
                            </p>
                          ) : (
                            spaceNotebooks.map(notebook => (
                              <div key={notebook.id} className="flex items-center gap-2 rounded-xl border theme-border bg-[var(--input-bg)] px-3 py-2">
                                <span className="shrink-0">{notebook.icon}</span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-theme-secondary">{notebook.name}</span>
                                <button
                                  type="button"
                                  onClick={() => removeNotebookFromSpace(space, notebook.id)}
                                  className="rounded-md p-1 text-theme-tertiary theme-hover"
                                  aria-label={`Remove ${notebook.name} from ${space.name}`}
                                >
                                  <X className="h-3.5 w-3.5 no-transition" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        <select
                          value=""
                          onChange={event => assignNotebook(space, event.target.value)}
                          className="mt-3 w-full rounded-xl border theme-input px-3 py-2 text-sm text-theme-secondary outline-none accent-focus"
                          aria-label={`Assign notebook to ${space.name}`}
                        >
                          <option value="">Add notebook to this space</option>
                          {availableNotebooks.map(notebook => (
                            <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
                          ))}
                        </select>
                      </article>
                    );
                  })}
                </div>
              )}
            </Panel>

            <Panel title="Shared notes" icon={FileText}>
              <ShareList
                items={sharedByMeNotes}
                empty="You are not sharing any notes yet."
                title="Shared by me"
                profileEmail={profile.email}
                uid={uid}
                onOpen={openNote}
                onShare={id => setShareTarget({ type: 'note', id })}
              />
              <ShareList
                items={sharedWithMeNotes}
                empty="No notes have been shared with you yet."
                title="Shared with me"
                profileEmail={profile.email}
                uid={uid}
                onOpen={openNote}
                onShare={id => setShareTarget({ type: 'note', id })}
              />
            </Panel>

            <Panel title="Shared notebooks" icon={BookOpen}>
              <NotebookShareList
                items={sharedByMeNotebooks}
                empty="You are not sharing any notebooks yet."
                title="Shared by me"
                profileEmail={profile.email}
                uid={uid}
                onShare={id => setShareTarget({ type: 'notebook', id })}
              />
              <NotebookShareList
                items={sharedWithMeNotebooks}
                empty="No notebooks have been shared with you yet."
                title="Shared with me"
                profileEmail={profile.email}
                uid={uid}
                onShare={id => setShareTarget({ type: 'notebook', id })}
              />
            </Panel>
          </div>

          <aside className="space-y-4">
            <Panel title="Backup reminder" icon={DownloadCloud}>
              <div className={`rounded-2xl border p-4 ${backupDue ? 'border-amber-400/30 bg-amber-500/10' : 'theme-border bg-[var(--input-bg)]'}`}>
                <p className="text-sm font-bold text-theme-primary">
                  {backupDue ? 'Manual cloud backup is due' : 'Backup is current'}
                </p>
                <p className="mt-2 text-xs leading-5 text-theme-tertiary">
                  {backupDays === null
                    ? 'No backup date is recorded yet.'
                    : `Last backup was ${backupDays} day${backupDays === 1 ? '' : 's'} ago.`}
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentView('settings')}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg accent-button px-3 py-2 text-xs font-bold"
                >
                  <Settings className="h-3.5 w-3.5 no-transition" />
                  Open backup tools
                </button>
              </div>
            </Panel>

            <Panel title="Permission checks" icon={ShieldCheck}>
              <div className="space-y-3">
                {permissionWarnings.legacy.length > 0 && (
                  <WarningRow text={`${permissionWarnings.legacy.length} legacy share${permissionWarnings.legacy.length === 1 ? '' : 's'} need explicit roles.`} />
                )}
                {permissionWarnings.published.length > 0 && (
                  <WarningRow text={`${permissionWarnings.published.length} note${permissionWarnings.published.length === 1 ? '' : 's'} published with public links.`} />
                )}
                <div className="rounded-xl border theme-border bg-[var(--input-bg)] p-3">
                  <p className="text-xs text-theme-tertiary">Current editors</p>
                  <p className="mt-1 text-xl font-bold text-theme-primary">{permissionWarnings.editorCount}</p>
                </div>
              </div>
            </Panel>

            <Panel title="Activity" icon={Activity}>
              {activityItems.length === 0 ? (
                <EmptyState text="Shared edits, comments, and access updates will appear here." />
              ) : (
                <div className="space-y-3">
                  {activityItems.slice(0, 12).map(item => (
                    <div key={item.id} className="border-b pb-3 last:border-b-0 last:pb-0 theme-divider">
                      <p className="text-sm font-medium leading-5 text-theme-secondary">{item.message}</p>
                      <p className="mt-1 text-[11px] text-theme-muted">
                        {item.actorName || item.actorEmail} - {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </aside>
        </section>
      </div>

      {shareTarget && (
        <ShareModal
          isOpen
          onClose={() => setShareTarget(null)}
          entityType={shareTarget.type}
          entityId={shareTarget.id}
        />
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof Share2;
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const toneClass = tone === 'good' ? 'text-emerald-500' : tone === 'warn' ? 'text-amber-500' : 'accent-text';
  return (
    <div className="rounded-2xl border theme-border bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-theme-tertiary">
        <Icon className={`h-4 w-4 no-transition ${toneClass}`} />
        {label}
      </div>
      <p className="text-2xl font-bold text-theme-primary">{value}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Share2;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border theme-border bg-[var(--app-bg-subtle)]/30 p-4">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 accent-text no-transition" />
        <h2 className="text-sm font-bold uppercase tracking-wide text-theme-secondary">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ShareList({
  items,
  empty,
  title,
  profileEmail,
  uid,
  onOpen,
  onShare,
}: {
  items: Note[];
  empty: string;
  title: string;
  profileEmail: string;
  uid: string | null;
  onOpen: (id: string) => void;
  onShare: (id: string) => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-theme-tertiary">{title}</h3>
      {items.length === 0 ? (
        <EmptyState text={empty} />
      ) : (
        <div className="space-y-2">
          {items.map(note => {
            const role = getEntityRole(note, profileEmail, uid);
            return (
              <div key={note.id} className="flex flex-col gap-3 rounded-xl border theme-border bg-[var(--card-bg)] p-3 sm:flex-row sm:items-center">
                <button type="button" onClick={() => onOpen(note.id)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-bold text-theme-primary">{note.title || 'Untitled note'}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-theme-tertiary">{note.content || 'Empty note'}</p>
                </button>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="rounded-full bg-[var(--badge-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--badge-text)]">
                    {roleLabels[role]}
                  </span>
                  {role === 'owner' && (
                    <button type="button" onClick={() => onShare(note.id)} className="rounded-lg px-3 py-1.5 text-xs font-bold theme-hover">
                      Manage
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotebookShareList({
  items,
  empty,
  title,
  profileEmail,
  uid,
  onShare,
}: {
  items: Notebook[];
  empty: string;
  title: string;
  profileEmail: string;
  uid: string | null;
  onShare: (id: string) => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-theme-tertiary">{title}</h3>
      {items.length === 0 ? (
        <EmptyState text={empty} />
      ) : (
        <div className="space-y-2">
          {items.map(notebook => {
            const role = getEntityRole(notebook, profileEmail, uid);
            return (
              <div key={notebook.id} className="flex flex-col gap-3 rounded-xl border theme-border bg-[var(--card-bg)] p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-theme-primary">{notebook.icon} {notebook.name}</p>
                  <p className="mt-1 text-xs text-theme-tertiary">{notebook.sharedWith?.length || 0} collaborator{(notebook.sharedWith?.length || 0) === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="rounded-full bg-[var(--badge-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--badge-text)]">
                    {roleLabels[role]}
                  </span>
                  {role === 'owner' && (
                    <button type="button" onClick={() => onShare(notebook.id)} className="rounded-lg px-3 py-1.5 text-xs font-bold theme-hover">
                      Manage
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WarningRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 no-transition" />
      <p className="text-xs leading-5 text-theme-secondary">{text}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border theme-border bg-[var(--input-bg)] px-3 py-3 text-sm text-theme-tertiary">
      {text}
    </div>
  );
}
