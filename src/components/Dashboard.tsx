import { useState } from 'react';
import { useStore } from '@/store';
import {
  Plus, FileText, CheckSquare, Sparkles, Pin,
  Clock, TrendingUp, BarChart3, BookOpen, BellRing,
  CalendarDays, PenLine, DownloadCloud, Upload,
  ArchiveRestore, CheckCircle2, Loader2, ChevronRight,
  Star, Share2, TriangleAlert, FolderPlus,
} from 'lucide-react';
import ImportManager from './ImportManager';
import BackupCenterModal from './BackupCenterModal';
import NoteCard from './NoteCard';
import CalendarWidget from './CalendarWidget';
import UserAvatar from './UserAvatar';
import ScratchPad from './ScratchPad';
import NewNotebookModal from './NewNotebookModal';
import { formatDashboardDate } from '@/utils/date';
import { getHolidaysForDate, type Holiday } from '@/utils/holidays';
import { getRecentNotebooks } from '@/utils/recentNotebooks';

const celebrationTypeLabels: Record<Holiday['type'], string> = {
  universal: 'Global observance',
  NG: 'Nigeria calendar',
  UK: 'UK calendar',
  US: 'US calendar',
  BCG: 'Berachah Church calendar',
};

const celebrationToneClasses: Record<Holiday['type'], string> = {
  universal: 'bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-400/15 dark:text-sky-100 dark:ring-sky-300/25',
  NG: 'bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-sky-400/15 dark:text-sky-100 dark:ring-sky-300/25',
  UK: 'bg-blue-100 text-blue-900 ring-blue-200 dark:bg-blue-400/15 dark:text-blue-100 dark:ring-blue-300/25',
  US: 'bg-rose-100 text-rose-900 ring-rose-200 dark:bg-blue-400/15 dark:text-blue-100 dark:ring-blue-300/25',
  BCG: 'bg-amber-100 text-amber-950 ring-amber-200 dark:bg-cyan-400/15 dark:text-cyan-100 dark:ring-cyan-300/25',
};

const celebrationNoteColors: Record<Holiday['type'], 'indigo' | 'green' | 'blue' | 'red' | 'purple'> = {
  universal: 'indigo',
  NG: 'green',
  UK: 'blue',
  US: 'red',
  BCG: 'purple',
};

function toTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
}

const typeMeta: Record<string, { label: string; tile: string }> = {
  note: { label: 'Note', tile: 'bg-indigo-500/10 text-indigo-500' },
  checklist: { label: 'Checklist', tile: 'bg-emerald-500/10 text-emerald-500' },
  markdown: { label: 'Markdown', tile: 'bg-purple-500/10 text-purple-500' },
};

const previewFor = (content: string) =>
  content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*`~_[\]()|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

/** Compact relative age for tight list rows: now / 5m / 3h / 2d. */
const compactAge = (isoDate: string) => {
  const minutes = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
};

export default function Dashboard() {
  const {
    profile, createNote, setCurrentView, selectNote, setEditingNote,
    getRecentNotes, getPinnedNotes, getStats, notes, settings,
    notebooks, uid, reminders, selectNotebook,
  } = useStore();

  const [showImportManager, setShowImportManager] = useState(false);
  const [showNewNotebookModal, setShowNewNotebookModal] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupJustDone, setBackupJustDone] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [showBackupCenter, setShowBackupCenter] = useState(false);

  const stats = getStats();
  const recent = getRecentNotes(5);
  const recentNotebooks = getRecentNotebooks(notebooks, notes, 6);
  const pinned = getPinnedNotes().slice(0, 4);
  const today = new Date();
  const todayLabel = formatDashboardDate(today);
  const todayCelebrations = getHolidaysForDate(today);
  const remindersCount = reminders.length > 0
    ? reminders.filter(r => r.status === 'active').length
    : notes.filter(n => n.reminder && !n.trashed).length;
  const sharedCount = notes.filter(n => n.isShared && !n.trashed).length;
  const backupDays = settings.lastBackupAt
    ? Math.floor((Date.now() - new Date(settings.lastBackupAt).getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const backupDue = backupDays === null || backupDays >= settings.backupReminderDays;

  // 7-day note creation trend for the sparkline (real data, CSS/SVG only).
  const creationTrend = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(today);
    day.setDate(day.getDate() - (6 - i));
    const key = day.toDateString();
    return notes.filter(n => new Date(n.createdAt).toDateString() === key).length;
  });
  const trendMax = Math.max(1, ...creationTrend);
  const sparkPoints = creationTrend
    .map((value, i) => `${(i / 6) * 100},${30 - (value / trendMax) * 26}`)
    .join(' ');

  const handleBackupNow = async () => {
    setBackupRunning(true);
    setBackupError('');
    try {
      await useStore.getState().createCloudBackup('manual');
      setBackupJustDone(true);
      window.setTimeout(() => setBackupJustDone(false), 8_000);
    } catch (err) {
      console.error('Cloud backup failed', err);
      setBackupError(err instanceof Error ? err.message : 'Cloud backup failed.');
    } finally {
      setBackupRunning(false);
    }
  };

  const openNote = (noteId: string) => {
    selectNote(noteId);
    setEditingNote(true);
  };

  const captureCelebrationReflection = (holiday: Holiday) => {
    const content = [
      `Date: ${todayLabel}`,
      `Calendar: ${celebrationTypeLabels[holiday.type]}`,
      '',
      'SUMMARY',
      holiday.summary,
      '',
      'REFLECTION',
      'What does this day mean to you, your family, or your community?',
      '',
      'NOTES',
      'Write anything you want to remember…',
    ].join('\n');

    void createNote({
      title: `${holiday.name} - ${todayLabel}`,
      content,
      type: 'note',
      color: celebrationNoteColors[holiday.type],
      tags: ['celebration', `calendar-${holiday.type.toLowerCase()}`, toTag(holiday.name)].filter(Boolean),
      priority: holiday.type === 'BCG' ? 'high' : 'medium',
    });
  };

  const quickActions = [
    { icon: FileText, label: 'New Note', tile: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-300', action: () => { createNote({ type: 'note' }); } },
    { icon: FolderPlus, label: 'New Notebook', tile: 'bg-blue-500/10 text-blue-500 dark:text-blue-300', action: () => { setShowNewNotebookModal(true); } },
    { icon: CheckSquare, label: 'Checklist', tile: 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-300', action: () => { createNote({ type: 'checklist' }); } },
    { icon: BellRing, label: 'Reminders', tile: 'bg-purple-500/10 text-purple-500 dark:text-purple-300', action: () => { setCurrentView('reminders'); } },
    { icon: Sparkles, label: 'Templates', tile: 'bg-amber-500/10 text-amber-500 dark:text-amber-300', action: () => { setCurrentView('templates'); } },
    { icon: Sparkles, label: 'NTK AI', tile: 'ai-soft text-violet-600 dark:text-violet-200', action: () => { setCurrentView('ai'); } },
  ];

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const renderHero = () => (
    <section className="dashboard-welcome relative overflow-hidden rounded-[28px] p-5 text-white shadow-xl md:p-7 phone-landscape:p-4">
      <div className="absolute inset-0 opacity-15" style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.25) 1px, transparent 1px)', backgroundSize: '26px 26px' }} aria-hidden="true" />
      <div className="relative flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-white/75">
            <Clock className="h-3.5 w-3.5 no-transition" aria-hidden="true" />
            {todayLabel}
          </p>
          <h1 className="mt-1.5 truncate text-2xl font-extrabold tracking-tight md:text-3xl phone-landscape:text-xl">
            {greeting}, {profile.name.split(' ')[0] || 'there'} 👋
          </h1>
          <p className="mt-1 text-sm text-white/78 md:text-base phone-landscape:text-xs">Capture what matters. NTK Note keeps the rest within reach.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold text-white/90 backdrop-blur">{stats.notes} notes</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold text-white/90 backdrop-blur">{remindersCount} reminders</span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold text-white/90 backdrop-blur">{sharedCount} shared</span>
          </div>
        </div>
        <div className="hidden shrink-0 rounded-full bg-white/10 p-1.5 ring-1 ring-white/15 sm:block">
          <UserAvatar profile={profile} size="lg" />
        </div>
      </div>
    </section>
  );

  const renderBackupCard = () => {
    if (!(backupDue || backupJustDone || backupError)) return null;
    return (
      <section
        className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
          backupJustDone && !backupError
            ? 'border-emerald-400/30 bg-emerald-500/10'
            : backupError
              ? 'border-red-400/30 bg-red-500/10'
              : 'theme-card'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            backupJustDone && !backupError
              ? 'bg-emerald-500/15 text-emerald-500'
              : backupError
                ? 'bg-red-500/15 text-red-500'
                : 'bg-amber-500/15 text-amber-500'
          }`}>
            {backupRunning ? (
              <Loader2 className="h-5 w-5 animate-spin no-transition" aria-hidden="true" />
            ) : backupJustDone && !backupError ? (
              <CheckCircle2 className="h-5 w-5 no-transition" aria-hidden="true" />
            ) : backupError ? (
              <TriangleAlert className="h-5 w-5 no-transition" aria-hidden="true" />
            ) : (
              <DownloadCloud className="h-5 w-5 no-transition" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-theme-primary">
              {backupRunning
                ? 'Backing up your notes...'
                : backupJustDone && !backupError
                  ? 'Backup complete — snapshot saved'
                  : backupError
                    ? 'Backup failed'
                    : 'Cloud backup reminder'}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-theme-tertiary">
              {backupRunning
                ? 'Creating a secure snapshot in your account.'
                : backupJustDone && !backupError
                  ? 'Restore this snapshot anytime from any device.'
                  : backupError
                    ? backupError
                    : backupDays === null
                      ? 'No backup yet — create your first snapshot.'
                      : `Your last backup was ${backupDays} day${backupDays === 1 ? '' : 's'} ago.`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowBackupCenter(true)}
            aria-label="Restore a backup"
            title="Restore a backup"
            className="flex h-10 w-10 items-center justify-center rounded-xl border theme-border theme-hover text-theme-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
          >
            <ArchiveRestore className="h-4 w-4 no-transition" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleBackupNow}
            disabled={backupRunning || !uid}
            className="inline-flex items-center gap-1.5 rounded-xl accent-button px-4 py-2.5 text-sm font-bold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
          >
            Backup now
            <ChevronRight className="h-4 w-4 no-transition" aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  };

  const renderQuickActions = () => (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3 phone-landscape:gap-2">
      {quickActions.map(action => (
        <button
          key={action.label}
          type="button"
          onClick={action.action}
          className="delight-card group flex flex-col items-center gap-2 rounded-2xl border theme-border theme-card p-3 transition-all hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 sm:gap-2.5 sm:p-4 phone-landscape:gap-1 phone-landscape:p-2.5"
        >
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl transition-transform group-hover:scale-110 sm:h-11 sm:w-11 phone-landscape:h-9 phone-landscape:w-9 ${action.tile}`}>
            <action.icon className="h-5 w-5 no-transition" aria-hidden="true" />
          </span>
          <span className="text-xs font-semibold text-theme-secondary sm:text-sm phone-landscape:text-[11px]">{action.label}</span>
        </button>
      ))}
    </div>
  );

  const renderRecentNotebooks = () => (
    <section className="rounded-2xl border theme-border theme-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-indigo-500 no-transition" aria-hidden="true" />
          <h2 className="text-sm font-bold text-theme-primary">Recent Notebooks</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewNotebookModal(true)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold accent-button"
          >
            <Plus className="h-3 w-3 no-transition" />
            New
          </button>
          <button
            type="button"
            onClick={() => setCurrentView('notebooks')}
            className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold accent-text theme-hover focus-visible:outline-none"
          >
            View all <ChevronRight className="h-3.5 w-3.5 no-transition" aria-hidden="true" />
          </button>
        </div>
      </div>

      {recentNotebooks.length === 0 ? (
        <div className="rounded-xl border theme-border p-5 text-center" style={{ backgroundColor: 'var(--input-bg)' }}>
          <p className="text-xs text-theme-tertiary">No notebooks yet. Click &ldquo;New&rdquo; to create your first notebook.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {recentNotebooks.map(({ notebook: nb, noteCount, lastActivityIso }) => (
            <button
              key={nb.id}
              type="button"
              onClick={() => {
                selectNotebook(nb.id);
                setCurrentView('all-notes');
              }}
              className="group flex flex-col justify-between rounded-xl border theme-border theme-card p-3 text-left transition-all hover:shadow-md hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              style={{ backgroundColor: 'var(--card-bg)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg">{nb.icon || '📓'}</span>
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold text-theme-secondary" style={{ backgroundColor: 'var(--input-bg)' }}>
                  {noteCount} note{noteCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-theme-primary group-hover:text-indigo-600 dark:group-hover:text-indigo-400">{nb.name}</p>
                <p className="mt-0.5 text-[10px] text-theme-tertiary">{compactAge(lastActivityIso)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );

  const renderRecentNotes = () => (
    <section className="rounded-2xl border theme-border theme-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-theme-primary">Recent Notes</h2>
        <button
          type="button"
          onClick={() => setCurrentView('all-notes')}
          className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold accent-text theme-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
        >
          View all <ChevronRight className="h-3.5 w-3.5 no-transition" aria-hidden="true" />
        </button>
      </div>

      {recent.length === 0 ? (
        <div className="rounded-xl border theme-border p-6 text-center" style={{ backgroundColor: 'var(--input-bg)' }}>
          <FileText className="mx-auto mb-2 h-8 w-8 text-theme-muted no-transition" aria-hidden="true" />
          <p className="text-sm font-medium text-theme-secondary">No notes yet</p>
          <p className="mt-0.5 text-xs text-theme-tertiary">Create your first note to get started.</p>
          <button
            type="button"
            onClick={() => createNote({})}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg accent-button px-3 py-1.5 text-xs font-semibold"
          >
            <Plus className="h-3.5 w-3.5 no-transition" aria-hidden="true" /> Create note
          </button>
        </div>
      ) : (
        <ul className="space-y-1">
          {recent.map(note => {
            const meta = typeMeta[note.type] || typeMeta.note;
            return (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => openNote(note.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors theme-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tile}`}>
                    {note.type === 'checklist'
                      ? <CheckSquare className="h-4 w-4 no-transition" aria-hidden="true" />
                      : <FileText className="h-4 w-4 no-transition" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-theme-primary">{note.title || 'Untitled'}</span>
                      <span className="hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-theme-tertiary sm:inline" style={{ backgroundColor: 'var(--input-bg)' }}>
                        {meta.label}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-theme-tertiary">
                      {previewFor(note.content) || 'Empty note'}
                    </span>
                  </span>
                  <span className="flex w-10 shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-theme-muted">
                      {compactAge(note.updatedAt)}
                    </span>
                    {note.starred && <Star className="h-3.5 w-3.5 text-amber-400 no-transition" aria-label="Starred" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const renderQuickStats = () => (
    <section className="rounded-2xl border theme-border theme-card p-4">
      <h2 className="mb-3 text-sm font-bold text-theme-primary">At a glance</h2>
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: FileText, label: 'Notes', value: stats.notes },
          { icon: BookOpen, label: 'Notebooks', value: notebooks.filter(nb => !nb.trashed).length },
          { icon: TrendingUp, label: 'Reminders', value: remindersCount },
          { icon: Share2, label: 'Shared', value: sharedCount },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2.5 rounded-xl border theme-border p-2.5" style={{ backgroundColor: 'var(--input-bg)' }}>
            <item.icon className="h-4 w-4 shrink-0 accent-text no-transition" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight text-theme-primary">{item.value}</span>
              <span className="block truncate text-[11px] text-theme-tertiary">{item.label}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border theme-border p-2.5" style={{ backgroundColor: 'var(--input-bg)' }}>
        <p className="mb-1 text-[11px] font-medium text-theme-tertiary">Notes created — last 7 days</p>
        <svg viewBox="0 0 100 32" className="h-10 w-full" aria-hidden="true" preserveAspectRatio="none">
          <defs>
            <linearGradient id="ntk-spark-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,32 ${sparkPoints} 100,32`} fill="url(#ntk-spark-fill)" />
          <polyline points={sparkPoints} fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </section>
  );

  const renderImportCard = () => (
    <button
      type="button"
      onClick={() => setShowImportManager(true)}
      className="flex w-full items-center gap-3 rounded-2xl border theme-border theme-card p-4 text-left transition-all hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-300">
        <Upload className="h-5 w-5 no-transition" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-theme-primary">Import</span>
        <span className="block truncate text-xs text-theme-tertiary">Bring your notes from other apps — Evernote, Keep, Notion and more</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-theme-muted no-transition" aria-hidden="true" />
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="mx-auto max-w-6xl p-4 pb-28 md:p-6 lg:p-8 lg:pb-8 phone-landscape:p-3 phone-landscape:pb-32">
        {/* Landscape phones — dedicated two-region composition */}
        <div className="hidden phone-landscape:grid phone-landscape:grid-cols-2 phone-landscape:items-start phone-landscape:gap-4 [&>*]:min-w-0">
          <div className="space-y-3 min-w-0">
            {renderHero()}
            {renderBackupCard()}
            {renderQuickActions()}
            {renderRecentNotebooks()}
            {renderImportCard()}
          </div>
          <div className="space-y-3 min-w-0">
            {renderRecentNotes()}
            {renderQuickStats()}
          </div>
        </div>

        {/* Default, tablet and desktop composition */}
        <div className="phone-landscape:hidden">
          <div className="space-y-4">
            {renderHero()}
            {renderBackupCard()}
            {renderQuickActions()}
            {renderRecentNotebooks()}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start [&>*]:min-w-0">
            <div className="space-y-4 min-w-0">
              {renderRecentNotes()}
              {renderImportCard()}
            </div>
            {renderQuickStats()}
          </div>
        </div>

        {/* Dashboard Extras: Celebrations, Pinned, ScratchPad, Calendar, Weekly */}
        <div className="mt-6 space-y-6 phone-landscape:hidden">
          {/* Celebrations */}
          {todayCelebrations.length > 0 && (
            <section
              aria-live="polite"
              aria-label="Today's celebration reminder"
              className="rounded-2xl border border-white/50 bg-white/95 p-4 shadow-[0_18px_50px_rgba(30,41,59,0.14)] dark:border-blue-200/15 dark:bg-[#081d35]/95 dark:text-blue-50 dark:shadow-[0_18px_50px_rgba(1,8,20,0.32)]"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 dark:bg-blue-500/15 dark:text-blue-100 dark:ring-blue-200/20">
                    <BellRing className="h-5 w-5 no-transition" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-surface-500 dark:text-blue-200/70">Today&apos;s celebrations</p>
                    <p className="text-sm font-bold text-surface-950 dark:text-blue-50">
                      {todayCelebrations.length} celebration{todayCelebrations.length === 1 ? '' : 's'} on your calendar today
                    </p>
                  </div>
                </div>
                <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-100 dark:bg-cyan-400/10 dark:text-cyan-100 dark:ring-cyan-300/20">
                  <CalendarDays className="h-3.5 w-3.5 no-transition" />
                  Reminder active
                </div>
              </div>

              <div className="mt-3 grid max-h-64 grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
                {todayCelebrations.map((holiday, i) => (
                  <article
                    key={`${holiday.type}-${holiday.name}-${i}`}
                    className={`rounded-xl border border-surface-200 bg-surface-50 p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:border-blue-200/15 dark:bg-[#0b2745] ${todayCelebrations.length === 1 ? 'md:col-span-2' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ${celebrationToneClasses[holiday.type]}`}>
                        {celebrationTypeLabels[holiday.type]}
                      </span>
                      <span className="text-xs font-bold text-surface-500 dark:text-blue-200/60">{holiday.flag}</span>
                    </div>
                    <h3 className="mt-2 text-base font-bold leading-snug text-surface-950 dark:text-blue-50">{holiday.name}</h3>
                    <p className="mt-1.5 max-w-2xl text-sm font-medium leading-6 text-surface-700 dark:text-blue-100/80">{holiday.summary}</p>
                    <button
                      type="button"
                      onClick={() => captureCelebrationReflection(holiday)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-surface-900 px-3 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-surface-800 dark:bg-blue-500 dark:hover:bg-blue-400"
                      aria-label={`Capture a reflection for ${holiday.name}`}
                    >
                      <PenLine className="h-3.5 w-3.5 no-transition" />
                      Capture reflection
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Pinned */}
          {pinned.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Pin className="h-4 w-4 accent-text no-transition" aria-hidden="true" />
                <h2 className="font-semibold text-theme-primary">Pinned</h2>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {pinned.map(note => (
                  <NoteCard key={note.id} note={note} compact />
                ))}
              </div>
            </section>
          )}

          {/* Scratch pad + calendar (isolated focus-safe ScratchPad) */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ScratchPad />
            <CalendarWidget />
          </div>

          {/* Weekly summary */}
          <div className="rounded-2xl border theme-border theme-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-500 no-transition" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-theme-primary">This Week</h2>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Notes Created', value: notes.filter(n => new Date(n.createdAt) >= new Date(Date.now() - 7 * 864e5)).length },
                { label: 'Notes Modified', value: notes.filter(n => new Date(n.updatedAt) >= new Date(Date.now() - 7 * 864e5)).length },
                { label: 'Tasks Done', value: notes.filter(n => new Date(n.updatedAt) >= new Date(Date.now() - 7 * 864e5)).flatMap(n => n.checklist || []).filter(c => Boolean(c?.checked)).length },
              ].map((s, i) => (
                <div key={i} className="text-center">
                  <p className="text-2xl font-bold text-theme-primary">{s.value}</p>
                  <p className="mt-1 text-xs text-theme-tertiary">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showBackupCenter && (
        <BackupCenterModal isOpen={showBackupCenter} onClose={() => setShowBackupCenter(false)} />
      )}
      {showImportManager && (
        <ImportManager onClose={() => setShowImportManager(false)} />
      )}
      {showNewNotebookModal && (
        <NewNotebookModal isOpen={showNewNotebookModal} onClose={() => setShowNewNotebookModal(false)} />
      )}
    </div>
  );
}
