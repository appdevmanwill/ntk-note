import type { AppReminder, Priority } from '@/types';
import { format, isToday, startOfDay, endOfDay, addMinutes, addDays, setHours, setMinutes } from 'date-fns';

export interface CategorizedReminders {
  overdue: AppReminder[];
  today: AppReminder[];
  upcoming: AppReminder[];
  completed: AppReminder[];
}

export const priorityLabels: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const priorityColors: Record<Priority, { bg: string; text: string; border: string }> = {
  low: { bg: 'bg-blue-500/10 dark:bg-blue-400/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30' },
  medium: { bg: 'bg-amber-500/10 dark:bg-amber-400/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30' },
  high: { bg: 'bg-orange-500/10 dark:bg-orange-400/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/30' },
  urgent: { bg: 'bg-red-500/10 dark:bg-red-400/15', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/30' },
};

/**
 * Categorize reminders into Overdue, Today, Upcoming, and Completed/Dismissed.
 */
export const categorizeReminders = (reminders: AppReminder[]): CategorizedReminders => {
  const overdue: AppReminder[] = [];
  const today: AppReminder[] = [];
  const upcoming: AppReminder[] = [];
  const completed: AppReminder[] = [];

  const now = new Date();
  const startOfToday = startOfDay(now);
  const endOfToday = endOfDay(now);

  // Sort by effective due time (snoozedUntil takes precedence if set)
  const sorted = [...reminders].sort((a, b) => {
    const timeA = new Date(a.snoozedUntil || a.dueAt).getTime();
    const timeB = new Date(b.snoozedUntil || b.dueAt).getTime();
    return timeA - timeB;
  });

  sorted.forEach(reminder => {
    if (reminder.status === 'completed' || reminder.status === 'dismissed') {
      completed.push(reminder);
      return;
    }

    const effectiveDate = new Date(reminder.snoozedUntil || reminder.dueAt);
    if (!Number.isFinite(effectiveDate.getTime())) {
      upcoming.push(reminder);
      return;
    }

    if (effectiveDate < startOfToday) {
      overdue.push(reminder);
    } else if (effectiveDate <= endOfToday) {
      if (effectiveDate < now) {
        overdue.push(reminder);
      } else {
        today.push(reminder);
      }
    } else {
      upcoming.push(reminder);
    }
  });

  return { overdue, today, upcoming, completed };
};

/**
 * Format a reminder due date and time cleanly.
 */
export const formatReminderDue = (dueAt: string, snoozedUntil?: string): string => {
  const targetStr = snoozedUntil || dueAt;
  const date = new Date(targetStr);
  if (!Number.isFinite(date.getTime())) return 'Invalid date';

  const prefix = snoozedUntil ? 'Snoozed until ' : '';

  if (isToday(date)) {
    return `${prefix}Today at ${format(date, 'h:mm a')}`;
  }
  return `${prefix}${format(date, 'MMM d, yyyy h:mm a')}`;
};

/**
 * Calculate ISO string for snooze duration.
 */
export const calculateSnoozeTime = (option: 5 | 10 | 30 | 60 | 'tomorrow'): string => {
  const now = new Date();
  if (option === 'tomorrow') {
    // Tomorrow at 9:00 AM
    const tomorrow = addDays(now, 1);
    return setMinutes(setHours(tomorrow, 9), 0).toISOString();
  }
  return addMinutes(now, option).toISOString();
};

export const isReminderDue = (reminderOrDateStr: AppReminder | string, nowMs = Date.now()): boolean => {
  if (typeof reminderOrDateStr === 'object') {
    if (reminderOrDateStr.status !== 'active') return false;
    const targetMs = new Date(reminderOrDateStr.snoozedUntil || reminderOrDateStr.dueAt).getTime();
    return Number.isFinite(targetMs) && nowMs >= targetMs;
  }
  const targetMs = new Date(reminderOrDateStr).getTime();
  return Number.isFinite(targetMs) && nowMs >= targetMs;
};

export const isReminderOverdue = (reminderOrDateStr: AppReminder | string, nowMs = Date.now()): boolean => {
  if (typeof reminderOrDateStr === 'object') {
    if (reminderOrDateStr.status !== 'active') return false;
    const targetMs = new Date(reminderOrDateStr.snoozedUntil || reminderOrDateStr.dueAt).getTime();
    return Number.isFinite(targetMs) && nowMs > targetMs;
  }
  const targetMs = new Date(reminderOrDateStr).getTime();
  return Number.isFinite(targetMs) && nowMs > targetMs;
};
