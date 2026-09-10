import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import type { AppReminder, Priority } from '@/types';
import { Bell, Calendar, Clock, FileText, Flag, X } from 'lucide-react';
import { format, addDays, setHours, setMinutes } from 'date-fns';
import { priorityColors, priorityLabels } from '@/utils/reminders';

interface CreateReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialReminder?: AppReminder | null;
  initialNoteId?: string;
}

const priorities: (Priority | null)[] = [null, 'low', 'medium', 'high', 'urgent'];

export default function CreateReminderModal({
  isOpen,
  onClose,
  initialReminder,
  initialNoteId,
}: CreateReminderModalProps) {
  const { notes, createReminder, updateReminder } = useStore();

  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [priority, setPriority] = useState<Priority | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setError('');
      setIsSubmitting(false);

      if (initialReminder) {
        setTitle(initialReminder.title);
        setDetails(initialReminder.details || '');
        const d = new Date(initialReminder.dueAt);
        if (Number.isFinite(d.getTime())) {
          setDateStr(format(d, 'yyyy-MM-dd'));
          setTimeStr(format(d, 'HH:mm'));
        } else {
          setDateStr('');
          setTimeStr('');
        }
        setPriority(initialReminder.priority || null);
        setSelectedNoteId(initialReminder.noteId || '');
      } else {
        // Defaults: Tomorrow at 09:00
        const defaultDate = addDays(new Date(), 1);
        const defaultTime = setMinutes(setHours(defaultDate, 9), 0);
        setTitle('');
        setDetails('');
        setDateStr(format(defaultTime, 'yyyy-MM-dd'));
        setTimeStr('09:00');
        setPriority(null);
        setSelectedNoteId(initialNoteId || '');
      }

      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isOpen, initialReminder, initialNoteId]);

  // Focus trap: Escape closes, Tab/Shift+Tab wraps within modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Please enter a reminder title.');
      titleInputRef.current?.focus();
      return;
    }

    if (!dateStr || !timeStr) {
      setError('Please choose both a date and time.');
      return;
    }

    const dueAtDate = new Date(`${dateStr}T${timeStr}`);
    if (!Number.isFinite(dueAtDate.getTime())) {
      setError('Invalid date or time entered.');
      return;
    }

    // Block past-date reminders — the time has already passed
    if (dueAtDate.getTime() < Date.now() - 60_000) {
      setError('This time has already passed. Choose a future date and time.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      if (initialReminder) {
        await updateReminder(initialReminder.id, {
          title: cleanTitle,
          details: details.trim() || undefined,
          dueAt: dueAtDate.toISOString(),
          priority: priority || undefined,
          noteId: selectedNoteId || undefined,
          status: 'active',
          triggered: false,
          snoozedUntil: undefined,
        });
      } else {
        await createReminder({
          title: cleanTitle,
          details: details.trim() || undefined,
          dueAt: dueAtDate.toISOString(),
          priority: priority || undefined,
          noteId: selectedNoteId || undefined,
        });
      }
      onClose();
    } catch (err) {
      console.error('Failed to save reminder:', err);
      setError(err instanceof Error ? err.message : 'Could not save reminder. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const setQuickTime = (type: 'today_eve' | 'tomorrow_morn' | 'weekend') => {
    const now = new Date();
    if (type === 'today_eve') {
      const todayEve = setMinutes(setHours(now, 18), 0);
      setDateStr(format(todayEve, 'yyyy-MM-dd'));
      setTimeStr('18:00');
    } else if (type === 'tomorrow_morn') {
      const tomMorn = setMinutes(setHours(addDays(now, 1), 9), 0);
      setDateStr(format(tomMorn, 'yyyy-MM-dd'));
      setTimeStr('09:00');
    } else if (type === 'weekend') {
      const daysUntilSat = (6 - now.getDay() + 7) % 7 || 7;
      const satMorn = setMinutes(setHours(addDays(now, daysUntilSat), 10), 0);
      setDateStr(format(satMorn, 'yyyy-MM-dd'));
      setTimeStr('10:00');
    }
  };

  const activeNotes = notes.filter(n => !n.trashed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-modal-title"
        className="w-full max-w-lg rounded-2xl border theme-border bg-[var(--card-bg)] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b theme-divider">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl accent-soft accent-text">
              <Bell className="h-5 w-5 no-transition" />
            </span>
            <h2 id="reminder-modal-title" className="text-lg font-bold text-theme-primary">
              {initialReminder ? 'Edit Reminder' : 'New Reminder'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-theme-tertiary theme-hover cursor-pointer"
            aria-label="Close reminder modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-medium text-red-500" role="alert">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label htmlFor="reminder-title" className="block text-xs font-bold uppercase tracking-wider text-theme-tertiary">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="reminder-title"
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Work at 12:00 PM, Doctor's appointment, Review proposal"
              className="w-full rounded-xl border theme-input px-3.5 py-2.5 text-sm text-theme-primary outline-none accent-focus font-medium"
              required
            />
          </div>

          {/* Details */}
          <div className="space-y-1.5">
            <label htmlFor="reminder-details" className="block text-xs font-bold uppercase tracking-wider text-theme-tertiary">
              Details (optional)
            </label>
            <textarea
              id="reminder-details"
              rows={2}
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="Add optional notes or checklist items..."
              className="w-full rounded-xl border theme-input px-3.5 py-2.5 text-sm text-theme-primary outline-none accent-focus resize-none"
            />
          </div>

          {/* Quick presets */}
          <div className="space-y-1.5">
            <span className="block text-xs font-bold uppercase tracking-wider text-theme-tertiary">
              Quick Schedules
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuickTime('today_eve')}
                className="px-2.5 py-1.5 rounded-lg border theme-border theme-hover text-xs font-semibold text-theme-secondary"
              >
                Today 6:00 PM
              </button>
              <button
                type="button"
                onClick={() => setQuickTime('tomorrow_morn')}
                className="px-2.5 py-1.5 rounded-lg border theme-border theme-hover text-xs font-semibold text-theme-secondary"
              >
                Tomorrow 9:00 AM
              </button>
              <button
                type="button"
                onClick={() => setQuickTime('weekend')}
                className="px-2.5 py-1.5 rounded-lg border theme-border theme-hover text-xs font-semibold text-theme-secondary"
              >
                Saturday 10:00 AM
              </button>
            </div>
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="reminder-date" className="block text-xs font-bold uppercase tracking-wider text-theme-tertiary flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Date <span className="text-red-500">*</span>
              </label>
              <input
                id="reminder-date"
                type="date"
                value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                className="w-full rounded-xl border theme-input px-3 py-2 text-sm text-theme-primary outline-none accent-focus"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reminder-time" className="block text-xs font-bold uppercase tracking-wider text-theme-tertiary flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Time <span className="text-red-500">*</span>
              </label>
              <input
                id="reminder-time"
                type="time"
                value={timeStr}
                onChange={e => setTimeStr(e.target.value)}
                className="w-full rounded-xl border theme-input px-3 py-2 text-sm text-theme-primary outline-none accent-focus"
                required
              />
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-theme-tertiary flex items-center gap-1">
              <Flag className="w-3.5 h-3.5" /> Priority
            </label>
            <div className="flex flex-wrap gap-2">
              {priorities.map(p => {
                const isSelected = priority === p;
                return (
                  <button
                    key={p || 'none'}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                      isSelected
                        ? p ? `${priorityColors[p].bg} ${priorityColors[p].text} ${priorityColors[p].border} ring-2 ring-purple-400/50 font-bold`
                            : 'bg-[var(--active-bg)] text-theme-primary border-purple-500/50 ring-2 ring-purple-400/50 font-bold'
                        : 'border-[var(--border-color)] text-theme-tertiary theme-hover'
                    }`}
                  >
                    {p ? priorityLabels[p] : 'None'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Linked Note Picker */}
          <div className="space-y-1.5">
            <label htmlFor="reminder-note-select" className="block text-xs font-bold uppercase tracking-wider text-theme-tertiary flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" /> Linked Note (optional)
            </label>
            <select
              id="reminder-note-select"
              value={selectedNoteId}
              onChange={e => setSelectedNoteId(e.target.value)}
              className="w-full rounded-xl border theme-input px-3 py-2.5 text-sm text-theme-primary outline-none accent-focus"
            >
              <option value="">-- Standalone Reminder (No Note) --</option>
              {activeNotes.map(n => (
                <option key={n.id} value={n.id}>
                  {n.title ? n.title : 'Untitled Note'}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-theme-tertiary">
              {selectedNoteId
                ? 'Opening this reminder will navigate directly to the linked note.'
                : 'Standalone reminders do not require a note and are managed in the Reminder Center.'}
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t theme-divider flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border theme-border theme-hover text-sm font-semibold text-theme-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl accent-button text-sm font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : initialReminder ? 'Save Changes' : 'Create Reminder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
