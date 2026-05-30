import { useState } from 'react';
import { useStore } from '@/store';
import {
  Plus, FileText, CheckSquare, Type, Sparkles, Pin,
  Clock, TrendingUp, BarChart3, ListChecks, BookOpen,
  ChevronRight, Star, Zap, Upload
} from 'lucide-react';
import ImportManager from './ImportManager';
import { format, isThisWeek } from 'date-fns';
import NoteCard from './NoteCard';
import CalendarWidget from './CalendarWidget';
import { formatDashboardDate } from '@/utils/date';

export default function Dashboard() {
  const {
    profile, createNote, setCurrentView,
    getRecentNotes, getPinnedNotes, getStats, notes, scratchPad,
    updateScratchPad, settings,
  } = useStore();

  const [scratchPadValue, setScratchPadValue] = useState(scratchPad);
  const [showImportManager, setShowImportManager] = useState(false);

  const stats = getStats();
  const recent = getRecentNotes(6);
  const pinned = getPinnedNotes().slice(0, 4);

  const taskProgress = stats.tasks > 0 ? Math.round((stats.completedTasks / stats.tasks) * 100) : 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getMotivation = () => {
    const msgs = [
      "What's on your mind today?",
      "Ready to capture some ideas?",
      "Let's make today productive!",
      "Your thoughts deserve to be saved.",
      "Great things start with a note.",
    ];
    return msgs[new Date().getDate() % msgs.length];
  };

  const handleScratchPadBlur = () => {
    updateScratchPad(scratchPadValue);
  };

  const quickActions = [
    { icon: FileText, label: 'New Note', color: 'from-indigo-500 to-blue-500', action: () => { createNote({ type: 'note' }); } },
    { icon: CheckSquare, label: 'Checklist', color: 'from-green-500 to-emerald-500', action: () => { createNote({ type: 'checklist' }); } },
    { icon: Type, label: 'Markdown', color: 'from-purple-500 to-pink-500', action: () => { createNote({ type: 'markdown' }); } },
    { icon: Sparkles, label: 'Template', color: 'from-amber-500 to-orange-500', action: () => { setCurrentView('templates'); } },
    { icon: Upload, label: 'Import', color: 'from-cyan-500 to-blue-500', action: () => { setShowImportManager(true); } },
  ];

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
        {/* Hero Greeting */}
        <div className="relative overflow-hidden rounded-2xl accent-gradient p-6 md:p-8 text-white shadow-xl">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.18) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
          <div className="relative">
            <div className="flex items-center gap-2 text-white/75 text-sm font-medium mb-2">
              <Zap className="w-4 h-4 no-transition" />
              {formatDashboardDate(new Date())}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              {getGreeting()}, {profile.name.split(' ')[0]} 👋
            </h1>
            <p className="text-white/75 text-lg">{getMotivation()}</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickActions.map((action, i) => (
            <button
              key={i}
              onClick={action.action}
              className="group flex flex-col items-center gap-3 p-4 rounded-xl theme-card border hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${action.color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                <action.icon className="w-6 h-6 text-white no-transition" />
              </div>
              <span className="text-sm font-semibold text-theme-secondary">{action.label}</span>
            </button>
          ))}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { icon: FileText, label: 'Notes', value: stats.notes, color: 'text-indigo-500', bg: 'rgba(99, 102, 241, 0.1)' },
            { icon: BarChart3, label: 'Words', value: stats.words.toLocaleString(), color: 'text-blue-500', bg: 'rgba(59, 130, 246, 0.1)' },
            { icon: BookOpen, label: 'Notebooks', value: stats.notebooks, color: 'text-purple-500', bg: 'rgba(168, 85, 247, 0.1)' },
            { icon: ListChecks, label: 'Tasks Done', value: `${stats.completedTasks}/${stats.tasks}`, color: 'text-emerald-500', bg: 'rgba(16, 185, 129, 0.1)' },
          ].map((stat, i) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl theme-card border">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: stat.bg }}>
                <stat.icon className={`w-5 h-5 ${stat.color} no-transition`} />
              </div>
              <div>
                <p className="text-xl font-bold text-theme-primary">{stat.value}</p>
                <p className="text-xs text-theme-tertiary">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Task Progress */}
        {stats.tasks > 0 && (
          <div className="rounded-xl theme-card border p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-500 no-transition" />
                <h3 className="font-semibold text-theme-primary">Task Progress</h3>
              </div>
              <span className="text-sm font-bold text-emerald-500">{taskProgress}%</span>
            </div>
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--input-bg)' }}>
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-500"
                style={{ width: `${taskProgress}%` }}
              />
            </div>
            <p className="text-xs text-theme-tertiary mt-2">{stats.completedTasks} of {stats.tasks} tasks completed</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Scratch Pad */}
          <div className="lg:col-span-1">
            <div className="rounded-xl theme-card border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b theme-divider">
                <Zap className="w-4 h-4 text-amber-500 no-transition" />
                <h3 className="font-semibold text-theme-primary text-sm">Scratch Pad</h3>
              </div>
              <textarea
                value={scratchPadValue}
                onChange={e => setScratchPadValue(e.target.value)}
                onBlur={handleScratchPadBlur}
                placeholder="Quick capture — jot down anything..."
                className="w-full h-40 px-4 py-3 text-sm bg-transparent text-theme-primary resize-none focus:outline-none"
                spellCheck={settings.spellCheck}
                style={{ color: 'var(--text-primary)' }}
              />
            </div>

            {/* Calendar Widget */}
            <div className="mt-4">
              <CalendarWidget />
            </div>
          </div>

          {/* Pinned & Recent */}
          <div className="lg:col-span-2 space-y-6">
            {/* Pinned Notes */}
            {pinned.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Pin className="w-4 h-4 accent-text no-transition" />
                    <h3 className="font-semibold text-theme-primary">Pinned</h3>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {pinned.map(note => (
                    <NoteCard key={note.id} note={note} compact />
                  ))}
                </div>
              </div>
            )}

            {/* Recently Modified */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-theme-tertiary no-transition" />
                  <h3 className="font-semibold text-theme-primary">Recently Modified</h3>
                </div>
                <button
                  onClick={() => setCurrentView('all-notes')}
                  className="flex items-center gap-1 text-sm accent-text font-medium"
                >
                  View all <ChevronRight className="w-4 h-4 no-transition" />
                </button>
              </div>
              {recent.length === 0 ? (
                <div className="text-center py-12 rounded-xl theme-card border">
                  <FileText className="w-12 h-12 text-theme-muted mx-auto mb-3 no-transition" />
                  <p className="text-theme-secondary font-medium">No notes yet</p>
                  <p className="text-theme-tertiary text-sm mt-1">Create your first note to get started!</p>
                  <button
                    onClick={() => createNote({})}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg accent-button text-sm font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4 no-transition" /> New Note
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {recent.map(note => (
                    <NoteCard key={note.id} note={note} compact />
                  ))}
                </div>
              )}
            </div>

            {/* Weekly Summary */}
            <div className="rounded-xl theme-card border p-5">
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-4 h-4 text-amber-500 no-transition" />
                <h3 className="font-semibold text-theme-primary">This Week</h3>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Notes Created', value: notes.filter(n => isThisWeek(new Date(n.createdAt))).length },
                  { label: 'Notes Modified', value: notes.filter(n => isThisWeek(new Date(n.updatedAt))).length },
                  { label: 'Tasks Done', value: notes.filter(n => isThisWeek(new Date(n.updatedAt))).flatMap(n => n.checklist).filter(c => c.checked).length },
                ].map((s, i) => (
                  <div key={i} className="text-center">
                    <p className="text-2xl font-bold text-theme-primary">{s.value}</p>
                    <p className="text-xs text-theme-tertiary mt-1">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Import Manager Modal */}
      {showImportManager && (
        <ImportManager onClose={() => setShowImportManager(false)} />
      )}
    </div>
  );
}
