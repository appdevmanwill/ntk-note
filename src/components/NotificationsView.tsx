import { useMemo, useState } from 'react';
import { useStore } from '@/store';
import type { AppNotification } from '@/types';
import {
  Bell,
  BellRing,
  CalendarDays,
  CheckCheck,
  Clock,
  FileText,
  Share2,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react';

type NotificationFilter = 'active' | 'unread' | 'dismissed' | 'all';

const filterOptions: { value: NotificationFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'unread', label: 'Unread' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All' },
];

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';

  const diffMs = time - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return diffMs >= 0 ? 'now' : 'just now';
  if (abs < hour) {
    const minutes = Math.round(abs / minute);
    return diffMs >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  }
  if (abs < day) {
    const hours = Math.round(abs / hour);
    return diffMs >= 0 ? `in ${hours}h` : `${hours}h ago`;
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getNotificationIcon(notification: AppNotification) {
  if (notification.type === 'note-reminder') return FileText;
  if (notification.type === 'celebration') return CalendarDays;
  if (notification.type === 'shared-activity') return Share2;
  if (notification.type === 'backup') return Clock;
  if (notification.type === 'sync-conflict') return BellRing;
  return Bell;
}

export default function NotificationsView() {
  const {
    notifications,
    settings,
    updateSettings,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    snoozeNotification,
    clearDismissedNotifications,
    selectNote,
    setCurrentView,
    setEditingNote,
  } = useStore();

  const [filter, setFilter] = useState<NotificationFilter>('active');
  const [permissionMessage, setPermissionMessage] = useState('');

  const unreadCount = notifications.filter(notification => !notification.readAt && !notification.dismissedAt).length;
  const dismissedCount = notifications.filter(notification => notification.dismissedAt).length;

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') {
      return notifications.filter(notification => !notification.readAt && !notification.dismissedAt);
    }
    if (filter === 'dismissed') {
      return notifications.filter(notification => notification.dismissedAt);
    }
    if (filter === 'active') {
      return notifications.filter(notification => !notification.dismissedAt);
    }
    return notifications;
  }, [filter, notifications]);

  const requestBrowserPermission = async () => {
    if (!('Notification' in window)) {
      setPermissionMessage('This browser does not support browser notifications.');
      return;
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

    if (permission === 'granted') {
      updateSettings({ browserNotificationsEnabled: true, notificationsEnabled: true });
      setPermissionMessage('Browser notifications are on.');
    } else {
      updateSettings({ browserNotificationsEnabled: false });
      setPermissionMessage('Browser notifications were not allowed by this browser.');
    }
  };

  const openNotificationSettings = () => {
    setCurrentView('settings');
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('ntk-settings-section', { detail: 'notifications' }));
    }, 0);
  };

  const openNotification = (notification: AppNotification) => {
    markNotificationRead(notification.id);

    if (notification.action === 'open-note' && notification.noteId) {
      setCurrentView('all-notes');
      selectNote(notification.noteId);
      setEditingNote(true);
      return;
    }

    if (notification.action === 'open-share-center') {
      setCurrentView('shared');
      return;
    }

    if (notification.action === 'open-settings') {
      openNotificationSettings();
      return;
    }

    setCurrentView('home');
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="max-w-5xl mx-auto px-4 py-5 md:px-8 md:py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-2xl accent-soft flex items-center justify-center">
                <BellRing className="w-5 h-5 no-transition accent-text" />
              </span>
              <div>
                <h2 className="text-2xl font-bold text-theme-primary">Notifications</h2>
                <p className="text-sm text-theme-tertiary">
                  {unreadCount ? `${unreadCount} unread reminder${unreadCount === 1 ? '' : 's'}` : 'No unread notifications'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openNotificationSettings}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl theme-hover text-sm font-semibold text-theme-secondary"
            >
              <Settings className="w-4 h-4 no-transition" />
              Settings
            </button>
            <button
              onClick={markAllNotificationsRead}
              disabled={!unreadCount}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl accent-button text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCheck className="w-4 h-4 no-transition" />
              Mark all read
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
          <div className="space-y-3 min-w-0">
            <div className="flex gap-1 rounded-xl border theme-border p-1 overflow-x-auto" style={{ backgroundColor: 'var(--card-bg)' }}>
              {filterOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => setFilter(option.value)}
                  className="px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
                  style={{
                    backgroundColor: filter === option.value ? 'var(--active-bg)' : 'transparent',
                    color: filter === option.value ? 'var(--badge-text)' : 'var(--text-tertiary)',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {filteredNotifications.length === 0 ? (
              <div className="rounded-xl border theme-border p-8 text-center" style={{ backgroundColor: 'var(--card-bg)' }}>
                <Bell className="w-8 h-8 mx-auto mb-3 no-transition text-theme-muted" />
                <p className="font-semibold text-theme-primary">Nothing here</p>
                <p className="text-sm text-theme-tertiary mt-1">
                  Reminders, celebrations, and shared activity will appear here.
                </p>
              </div>
            ) : (
              filteredNotifications.map(notification => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  defaultSnoozeMinutes={settings.defaultSnoozeMinutes}
                  onOpen={() => openNotification(notification)}
                  onRead={() => markNotificationRead(notification.id)}
                  onDismiss={() => dismissNotification(notification.id)}
                  onSnooze={(minutes) => snoozeNotification(notification.id, minutes)}
                />
              ))
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-xl border theme-border p-4" style={{ backgroundColor: 'var(--card-bg)' }}>
              <p className="text-sm font-bold text-theme-primary mb-2">Browser Alerts</p>
              <p className="text-xs text-theme-tertiary leading-relaxed mb-4">
                In-app notifications sync across devices. Browser alerts appear on the device where the app is installed or open.
              </p>
              <button
                onClick={() => void requestBrowserPermission()}
                className="w-full px-3 py-2 rounded-xl accent-button text-sm font-semibold"
              >
                {settings.browserNotificationsEnabled ? 'Check permission' : 'Enable browser alerts'}
              </button>
              {permissionMessage && (
                <p className="mt-3 text-xs text-theme-tertiary">{permissionMessage}</p>
              )}
            </div>

            <div className="rounded-xl border theme-border p-4" style={{ backgroundColor: 'var(--card-bg)' }}>
              <p className="text-sm font-bold text-theme-primary mb-3">Summary</p>
              <div className="space-y-2 text-sm">
                <SummaryRow label="Unread" value={unreadCount} />
                <SummaryRow label="Dismissed" value={dismissedCount} />
                <SummaryRow label="Total stored" value={notifications.length} />
              </div>
              <button
                onClick={clearDismissedNotifications}
                disabled={!dismissedCount}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl theme-hover text-sm font-semibold text-theme-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4 no-transition" />
                Clear dismissed
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function NotificationRow({
  notification,
  defaultSnoozeMinutes,
  onOpen,
  onRead,
  onDismiss,
  onSnooze,
}: {
  notification: AppNotification;
  defaultSnoozeMinutes: number;
  onOpen: () => void;
  onRead: () => void;
  onDismiss: () => void;
  onSnooze: (minutes: number) => void;
}) {
  const Icon = getNotificationIcon(notification);
  const isUnread = !notification.readAt && !notification.dismissedAt;
  const isDismissed = Boolean(notification.dismissedAt);
  const snoozedUntil = notification.snoozedUntil ? new Date(notification.snoozedUntil) : null;
  const isSnoozed = Boolean(snoozedUntil && snoozedUntil.getTime() > Date.now());

  return (
    <article
      className="rounded-xl border p-4 transition-colors"
      style={{
        backgroundColor: isUnread ? 'var(--active-bg)' : 'var(--card-bg)',
        borderColor: isUnread ? 'var(--accent-primary)' : 'var(--card-border)',
      }}
    >
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--input-bg)' }}>
          <Icon className="w-5 h-5 no-transition accent-text" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="font-bold text-theme-primary break-words">{notification.title}</h3>
              <p className="text-sm text-theme-secondary mt-1 leading-relaxed break-words">{notification.message}</p>
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-theme-tertiary shrink-0">
              {formatRelativeTime(notification.dueAt || notification.createdAt)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {isUnread && (
              <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide accent-soft">
                Unread
              </span>
            )}
            {isSnoozed && notification.snoozedUntil && (
              <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide text-amber-500 bg-amber-500/10">
                Snoozed {formatRelativeTime(notification.snoozedUntil)}
              </span>
            )}
            {isDismissed && (
              <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide text-theme-tertiary bg-[var(--input-bg)]">
                Dismissed
              </span>
            )}
          </div>

          {!isDismissed && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={onOpen} className="px-3 py-2 rounded-lg accent-button text-xs font-semibold">
                Open
              </button>
              {isUnread && (
                <button onClick={onRead} className="px-3 py-2 rounded-lg theme-hover text-xs font-semibold text-theme-secondary">
                  Mark read
                </button>
              )}
              <button
                onClick={() => onSnooze(defaultSnoozeMinutes)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg theme-hover text-xs font-semibold text-theme-secondary"
              >
                <Clock className="w-3.5 h-3.5 no-transition" />
                Snooze {defaultSnoozeMinutes}m
              </button>
              <button
                onClick={() => onSnooze(60)}
                className="px-3 py-2 rounded-lg theme-hover text-xs font-semibold text-theme-secondary"
              >
                1 hour
              </button>
              <button
                onClick={onDismiss}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-500 hover:bg-red-500/10"
              >
                <XCircle className="w-3.5 h-3.5 no-transition" />
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-theme-tertiary">{label}</span>
      <span className="font-bold text-theme-primary">{value}</span>
    </div>
  );
}
