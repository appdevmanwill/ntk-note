import { useState, useMemo } from 'react';
import { useStore } from '@/store';
import type { AppReminder, Priority } from '@/types';
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Flag,
  Plus,
  Search,
  Trash2,
  AlertCircle,
  Clock3,
  Edit2,
  Sparkles,
} from 'lucide-react';
import {
  categorizeReminders,
  formatReminderDue,
  priorityColors,
  priorityLabels,
} from '@/utils/reminders';
import CreateReminderModal from './CreateReminderModal';

type ReminderTab = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed';

export default function RemindersCenterView() {
  const {
    reminders,
    notes,
    toggleReminderStatus,
    deleteReminder,
    snoozeReminderItem,
    selectNote,
    setEditingNote,
    setCurrentView,
  } = useStore();

  const [activeTab, setActiveTab] = useState<ReminderTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'standalone' | 'note'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<AppReminder | null>(null);
  const [snoozeMenuOpenId, setSnoozeMenuOpenId] = useState<string | null>(null);

  // Categorize reminders
  const categorized = useMemo(() => categorizeReminders(reminders), [reminders]);

  const activeCount = categorized.overdue.length + categorized.today.length + categorized.upcoming.length;
  const overdueCount = categorized.overdue.length;
  const todayCount = categorized.today.length;
  const upcomingCount = categorized.upcoming.length;
  const completedCount = categorized.completed.length;

  // Filtered list based on active tab, search, priority, and type
  const displayedReminders = useMemo(() => {
    let list: AppReminder[] = [];
    if (activeTab === 'all') {
      list = [...categorized.overdue, ...categorized.today, ...categorized.upcoming];
    } else if (activeTab === 'overdue') {
      list = categorized.overdue;
    } else if (activeTab === 'today') {
      list = categorized.today;
    } else if (activeTab === 'upcoming') {
      list = categorized.upcoming;
    } else if (activeTab === 'completed') {
      list = categorized.completed;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r =>
        r.title.toLowerCase().includes(q) ||
        (r.details && r.details.toLowerCase().includes(q))
      );
    }

    if (priorityFilter !== 'all') {
      list = list.filter(r => r.priority === priorityFilter);
    }

    if (typeFilter === 'standalone') {
      list = list.filter(r => !r.noteId);
    } else if (typeFilter === 'note') {
      list = list.filter(r => !!r.noteId);
    }

    return list;
  }, [activeTab, categorized, searchQuery, priorityFilter, typeFilter]);

  const handleOpenNote = (noteId: string) => {
    const targetNote = notes.find(n => n.id === noteId);
    if (targetNote) {
      setCurrentView(targetNote.isShared ? 'shared' : 'all-notes');
      selectNote(noteId);
      setEditingNote(true);
    }
  };

  const handleOpenReminder = (reminder: AppReminder) => {
    if (reminder.noteId) {
      handleOpenNote(reminder.noteId);
    } else {
      setEditingReminder(reminder);
      setModalOpen(true);
    }
  };

  const handleSnooze = async (id: string, option: 5 | 10 | 30 | 60 | 'tomorrow') => {
    setSnoozeMenuOpenId(null);
    await snoozeReminderItem(id, option);
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="max-w-6xl mx-auto p-4 pb-28 md:p-8 space-y-6">
        
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--badge-bg)] text-xs font-bold uppercase tracking-wide text-[var(--badge-text)] mb-2">
              <Bell className="h-3.5 w-3.5 no-transition" />
              Reminder Center
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-theme-primary">Reminders & Tasks</h1>
            <p className="text-sm text-theme-tertiary mt-1">
              Manage note reminders and standalone reminders synced across your devices.
            </p>
          </div>

          <button
            type="button"
            onClick={() => { setEditingReminder(null); setModalOpen(true); }}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl accent-button text-sm font-bold shadow-lg transition-transform active:scale-95 cursor-pointer"
          >
            <Plus className="h-4 w-4 no-transition" />
            New Reminder
          </button>
        </header>

        {/* Stats / Tabs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <StatTab
            label="Active"
            count={activeCount}
            active={activeTab === 'all'}
            onClick={() => setActiveTab('all')}
          />
          <StatTab
            label="Overdue"
            count={overdueCount}
            active={activeTab === 'overdue'}
            onClick={() => setActiveTab('overdue')}
            tone={overdueCount > 0 ? 'red' : 'default'}
          />
          <StatTab
            label="Today"
            count={todayCount}
            active={activeTab === 'today'}
            onClick={() => setActiveTab('today')}
            tone={todayCount > 0 ? 'amber' : 'default'}
          />
          <StatTab
            label="Upcoming"
            count={upcomingCount}
            active={activeTab === 'upcoming'}
            onClick={() => setActiveTab('upcoming')}
          />
          <StatTab
            label="Completed"
            count={completedCount}
            active={activeTab === 'completed'}
            onClick={() => setActiveTab('completed')}
          />
        </div>

        {/* Filters and Search Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-3 bg-[var(--card-bg)] border theme-border p-3 rounded-2xl">
          <div className="relative flex-1 w-full min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search reminders by title or details..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl border theme-input text-sm text-theme-primary outline-none accent-focus"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value as Priority | 'all')}
              className="flex-1 sm:flex-initial px-3 py-2 rounded-xl border theme-input text-xs font-semibold text-theme-secondary outline-none"
              aria-label="Filter by priority"
            >
              <option value="all">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as 'all' | 'standalone' | 'note')}
              className="flex-1 sm:flex-initial px-3 py-2 rounded-xl border theme-input text-xs font-semibold text-theme-secondary outline-none"
              aria-label="Filter by reminder type"
            >
              <option value="all">All Types</option>
              <option value="standalone">Standalone Only</option>
              <option value="note">Attached to Note</option>
            </select>
          </div>
        </div>

        {/* Reminders List */}
        <div className="space-y-3">
          {displayedReminders.length === 0 ? (
            <div className="rounded-2xl border theme-border bg-[var(--card-bg)] p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl accent-soft flex items-center justify-center mx-auto text-theme-muted">
                {activeTab === 'completed' ? <CheckCircle2 className="w-6 h-6" /> : <Bell className="w-6 h-6" />}
              </div>
              <h3 className="text-base font-bold text-theme-primary">
                {searchQuery
                  ? 'No matching reminders'
                  : activeTab === 'overdue'
                    ? 'No overdue reminders'
                    : activeTab === 'today'
                      ? 'No reminders due today'
                      : activeTab === 'completed'
                        ? 'No completed reminders'
                        : 'No active reminders'}
              </h3>
              <p className="text-xs text-theme-tertiary max-w-sm mx-auto">
                {activeTab === 'completed'
                  ? 'Reminders you mark as done will appear here for reference.'
                  : 'Create standalone reminders or attach them to notes to stay on track.'}
              </p>
              {activeTab !== 'completed' && !searchQuery && (
                <button
                  type="button"
                  onClick={() => { setEditingReminder(null); setModalOpen(true); }}
                  className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl accent-button text-xs font-bold"
                >
                  <Plus className="w-3.5 h-3.5" /> Create a reminder
                </button>
              )}
            </div>
          ) : (
            displayedReminders.map(reminder => {
              const linkedNote = reminder.noteId ? notes.find(n => n.id === reminder.noteId) : null;
              const isOverdue = categorized.overdue.includes(reminder);
              const isTodayDue = categorized.today.includes(reminder);
              const isCompleted = reminder.status === 'completed' || reminder.status === 'dismissed';

              return (
                <div
                  key={reminder.id}
                  className={`group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                    isCompleted
                      ? 'border-[var(--border-color)] bg-[var(--card-bg)] opacity-70'
                      : isOverdue
                        ? 'border-red-500/30 bg-red-500/5 dark:bg-red-950/10'
                        : isTodayDue
                          ? 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/10'
                          : 'theme-border bg-[var(--card-bg)] theme-hover'
                  }`}
                >
                  {/* Left: Checkbox + Content */}
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => void toggleReminderStatus(reminder.id)}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                        isCompleted
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-400/50 hover:border-purple-400 focus-visible:ring-2 focus-visible:ring-purple-400'
                      }`}
                      aria-label={isCompleted ? 'Mark reminder active' : 'Mark reminder completed'}
                    >
                      {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 stroke-[3]" />}
                    </button>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4
                          onClick={() => handleOpenReminder(reminder)}
                          className={`text-sm font-bold text-theme-primary cursor-pointer hover:underline truncate ${
                            isCompleted ? 'line-through text-theme-tertiary' : ''
                          }`}
                        >
                          {reminder.title}
                        </h4>

                        {/* Priority Badge */}
                        {reminder.priority && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${
                              priorityColors[reminder.priority].bg
                            } ${priorityColors[reminder.priority].text} ${
                              priorityColors[reminder.priority].border
                            }`}
                          >
                            <Flag className="w-2.5 h-2.5" />
                            {priorityLabels[reminder.priority]}
                          </span>
                        )}

                        {/* Note Link Badge */}
                        {linkedNote ? (
                          <button
                            type="button"
                            onClick={() => handleOpenNote(linkedNote.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-500/10 hover:bg-purple-500/20 text-purple-600 dark:text-purple-400 text-[10px] font-bold cursor-pointer"
                            title="Open associated note"
                          >
                            <FileText className="w-2.5 h-2.5" />
                            <span className="max-w-[120px] truncate">{linkedNote.title || 'Untitled note'}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--input-bg)] text-theme-tertiary text-[10px] font-semibold">
                            <Sparkles className="w-2.5 h-2.5" />
                            Standalone
                          </span>
                        )}
                      </div>

                      {reminder.details && (
                        <p className="text-xs text-theme-tertiary line-clamp-2">
                          {reminder.details}
                        </p>
                      )}

                      {/* Due Time + Snooze indicator */}
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            isCompleted
                              ? 'text-theme-muted'
                              : isOverdue
                                ? 'text-red-500'
                                : isTodayDue
                                  ? 'text-amber-500'
                                  : 'text-theme-secondary'
                          }`}
                        >
                          {isOverdue && !isCompleted ? (
                            <AlertCircle className="w-3.5 h-3.5" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                          {formatReminderDue(reminder.dueAt, reminder.snoozedUntil)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                    {/* Snooze dropdown */}
                    {!isCompleted && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setSnoozeMenuOpenId(snoozeMenuOpenId === reminder.id ? null : reminder.id)}
                          className="p-1.5 rounded-xl border theme-border theme-hover text-theme-secondary text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          title="Snooze reminder"
                        >
                          <Clock3 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Snooze</span>
                        </button>

                        {snoozeMenuOpenId === reminder.id && (
                          <div className="absolute right-0 top-full mt-1.5 w-40 rounded-xl bg-[var(--card-bg)] border theme-border shadow-xl z-30 py-1 text-xs">
                            <button
                              type="button"
                              onClick={() => void handleSnooze(reminder.id, 5)}
                              className="w-full text-left px-3 py-1.5 theme-hover text-theme-primary font-medium"
                            >
                              5 minutes
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSnooze(reminder.id, 10)}
                              className="w-full text-left px-3 py-1.5 theme-hover text-theme-primary font-medium"
                            >
                              10 minutes
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSnooze(reminder.id, 30)}
                              className="w-full text-left px-3 py-1.5 theme-hover text-theme-primary font-medium"
                            >
                              30 minutes
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSnooze(reminder.id, 60)}
                              className="w-full text-left px-3 py-1.5 theme-hover text-theme-primary font-medium"
                            >
                              1 hour
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSnooze(reminder.id, 'tomorrow')}
                              className="w-full text-left px-3 py-1.5 theme-hover text-theme-primary font-medium border-t theme-divider"
                            >
                              Tomorrow 9:00 AM
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Edit button */}
                    <button
                      type="button"
                      onClick={() => { setEditingReminder(reminder); setModalOpen(true); }}
                      className="p-1.5 rounded-xl border theme-border theme-hover text-theme-secondary cursor-pointer"
                      title="Edit reminder"
                      aria-label="Edit reminder"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={() => void deleteReminder(reminder.id)}
                      className="p-1.5 rounded-xl border theme-border theme-hover text-theme-tertiary hover:text-red-500 cursor-pointer"
                      title="Delete reminder"
                      aria-label="Delete reminder"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <CreateReminderModal
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setEditingReminder(null); }}
          initialReminder={editingReminder}
        />
      )}
    </div>
  );
}

function StatTab({
  label,
  count,
  active,
  onClick,
  tone = 'default',
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: 'default' | 'red' | 'amber';
}) {
  const toneClasses = tone === 'red' && count > 0
    ? 'text-red-500 bg-red-500/10 border-red-500/30'
    : tone === 'amber' && count > 0
      ? 'text-amber-500 bg-amber-500/10 border-amber-500/30'
      : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all cursor-pointer ${
        active
          ? 'border-purple-500/60 bg-[var(--active-bg)] ring-2 ring-purple-400/40 shadow-sm'
          : 'theme-border bg-[var(--card-bg)] theme-hover'
      }`}
    >
      <span className="text-xs font-semibold text-theme-tertiary">{label}</span>
      <span className={`text-xl font-extrabold mt-0.5 ${toneClasses ? toneClasses.split(' ')[0] : 'text-theme-primary'}`}>
        {count}
      </span>
    </button>
  );
}
