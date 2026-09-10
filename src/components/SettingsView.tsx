import { useEffect, useState, useRef } from 'react';
import { useStore } from '@/store';
import type { NoteTheme, ThemeAccent } from '@/types';
import { accentColors } from '@/utils/colors';
import { noteThemes } from '@/utils/noteThemes';
import { premiumFontFamilies } from '@/utils/fonts';
import {
  User, Palette, Type, Download, Upload,
  Trash2, Moon, Sun, Keyboard, Info, BellRing,
  ChevronRight, FolderInput, ShieldCheck, Wifi, DownloadCloud,
  AlertTriangle, RefreshCw, Tag, TrendingUp, Cloud, ExternalLink,
  ArchiveRestore, CheckCircle2, CloudUpload, DatabaseBackup, Monitor, Search, Sparkles, RotateCcw,
  Camera, HardDrive, Loader2
} from 'lucide-react';
import ImportManager from './ImportManager';
import BackupCenterModal from './BackupCenterModal';
import QuotaDashboard from './QuotaDashboard';
import ManualSyncButton from './ManualSyncButton';
import BrandMark from './BrandMark';
import AiSettingsPanel from './AiSettingsPanel';
import UserAvatar, { builtinAvatarIds, builtinAvatarValue } from './UserAvatar';
import { auth } from '@/utils/firebase';
import {
  createWorkspaceArchive,
  exportWorkspaceArchiveToGoogleDrive,
  exportWorkspaceArchiveToConnectedStorage,
  getWorkspaceArchiveFileName,
  readWorkspaceBackupFile,
} from '@/utils/cloudExport';
import { saveExternalStorageBackup } from '@/utils/cloudBackup';
import { uploadStorageFile } from '@/utils/cloudStorage';
import { compressInlineImagesInMarkdown } from '@/utils/imageCompression';
import { countInlineImages, formatBytes, getOversizedNotes, getStorageHeavyNotes } from '@/utils/storageHealth';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function SettingsView() {
  const {
    profile, setProfile, settings, updateSettings, setTheme, setAccent,
    exportAllNotes, importNotes, resetApp, getStats,
    syncConflicts, resolveSyncConflict, online,
    notes, notebooks, updateNote, cleanupTrashOlderThan, selectNote,
    uid, createCloudBackup, settingsSection, setSyncCenterOpen,
  } = useStore();

  const [activeSection, setActiveSection] = useState(settingsSection || 'profile');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [showImportManager, setShowImportManager] = useState(false);
  const [showBackupCenter, setShowBackupCenter] = useState(false);
  const [snapshotRunning, setSnapshotRunning] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState('');
  const [offlineStatus, setOfflineStatus] = useState('');
  const [cloudExporting, setCloudExporting] = useState(false);
  const [cloudSharing, setCloudSharing] = useState(false);
  const [cloudExportStatus, setCloudExportStatus] = useState('');
  const [cloudExportLink, setCloudExportLink] = useState('');
  const [uploadingProfilePhoto, setUploadingProfilePhoto] = useState(false);
  const [externalBackupRunning, setExternalBackupRunning] = useState(false);
  const [externalBackupStatus, setExternalBackupStatus] = useState<string | null>(null);
  const [externalBackupRetention, setExternalBackupRetention] = useState(5);
  const [connectedExportRunning, setConnectedExportRunning] = useState(false);
  const [connectedExportStatus, setConnectedExportStatus] = useState<string | null>(null);
  const [connectedExportRetention, setConnectedExportRetention] = useState(30);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notificationStatus, setNotificationStatus] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });
  const [cleanupDays, setCleanupDays] = useState(30);
  const [cleanupStatus, setCleanupStatus] = useState('');
  const [compressingImages, setCompressingImages] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [showAllFonts, setShowAllFonts] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const stats = getStats();
  const storageHeavyNotes = getStorageHeavyNotes(notes.filter(note => !note.trashed), 6);
  const oversizedNotes = getOversizedNotes(notes.filter(note => !note.trashed));
  const imageHeavyNotes = notes.filter(note => !note.trashed && countInlineImages(note.content) > 0);

  // Requested section arrives through application state (store.settingsSection)
  // so navigation can never race component mounting.
  useEffect(() => {
    if (settingsSection) setActiveSection(settingsSection);
  }, [settingsSection]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemPrefersDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstallMessage('Install prompt is ready.');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    const refreshOfflineStatus = async () => {
      if (!('serviceWorker' in navigator)) {
        setOfflineStatus('Offline app cache is not supported in this browser.');
        return;
      }
      const registrations = await navigator.serviceWorker.getRegistrations();
      const hasNtkWorker = registrations.some(registration => {
        const scriptUrl = registration.active?.scriptURL || registration.installing?.scriptURL || registration.waiting?.scriptURL || '';
        return scriptUrl.endsWith('/sw.js');
      });
      if (hasNtkWorker) {
        setOfflineStatus(online
          ? 'Offline support is ready. If your connection drops, recent app files remain available and safe edits can stay queued.'
          : 'You are offline. NTK Note is using its local app cache and will sync safe queued changes after you reconnect.');
      } else {
        setOfflineStatus('Offline support is starting. Refresh once if it does not become ready automatically.');
      }
    };

    void refreshOfflineStatus();
    const timer = window.setTimeout(() => void refreshOfflineStatus(), 900);
    navigator.serviceWorker?.addEventListener?.('controllerchange', refreshOfflineStatus);
    return () => {
      window.clearTimeout(timer);
      navigator.serviceWorker?.removeEventListener?.('controllerchange', refreshOfflineStatus);
    };
  }, [online]);

  const handleInstallPwa = async () => {
    if (!installPrompt) {
      setInstallMessage('Your browser has not exposed an install prompt yet. Use the browser menu and choose Install app when available.');
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallMessage(choice.outcome === 'accepted' ? 'Install accepted.' : 'Install dismissed.');
    setInstallPrompt(null);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const payload = await readWorkspaceBackupFile(file);
      const result = importNotes(payload);
      setImportResult(result ? 'Backup imported successfully.' : 'This backup could not be imported.');
    } catch (error) {
      setImportResult(error instanceof Error ? error.message : 'This backup could not be imported.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      window.setTimeout(() => setImportResult(null), 5000);
    }
  };

  const handleExport = async () => {
    try {
      const data = exportAllNotes();
      const blob = await createWorkspaceArchive(data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = getWorkspaceArchiveFileName();
      a.click();
      URL.revokeObjectURL(url);
      updateSettings({ lastBackupAt: new Date().toISOString() });
    } catch (err) {
      console.error('Export failed', err);
      alert('Failed to export workspace. Check console for details.');
    }
  };

  const handleGoogleDriveExport = async () => {
    setCloudExporting(true);
    setCloudExportStatus('Connecting to Google Drive...');
    setCloudExportLink('');

    try {
      const result = await exportWorkspaceArchiveToGoogleDrive(exportAllNotes());
      setCloudExportStatus(`Uploaded ${result.fileName} to Google Drive.`);
      setCloudExportLink(result.url);
      updateSettings({ lastBackupAt: new Date().toISOString() });
    } catch (err) {
      console.error('Google Drive export failed', err);
      setCloudExportStatus(err instanceof Error ? err.message : 'Google Drive export failed.');
    } finally {
      setCloudExporting(false);
    }
  };

  const handleCloudShare = async () => {
    setCloudSharing(true);
    setCloudExportStatus('');
    setCloudExportLink('');

    try {
      const blob = await createWorkspaceArchive(exportAllNotes());
      const file = new File([blob], getWorkspaceArchiveFileName(), { type: 'application/zip' });
      const shareData = {
        title: 'NTK Note Backup',
        text: 'Backup of notes from NTK Note',
        files: [file],
      };
      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        await handleExport();
      }
      updateSettings({ lastBackupAt: new Date().toISOString() });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setCloudExportStatus('Cloud share canceled.');
      } else {
        console.error('Cloud share failed', err);
        setCloudExportStatus(err instanceof Error ? err.message : 'Cloud share failed.');
      }
    } finally {
      setCloudSharing(false);
    }
  };

  const handleProfilePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingProfilePhoto(true);
    try {
      const previousAvatar = profile.avatar;
      const res = await uploadStorageFile(file, 'profilePhotos');
      const { buildStorageReference, parseStorageReference, deleteStorageFile } = await import('@/utils/cloudStorage');
      const storageRef = buildStorageReference('profilePhotos', res.objectId, res.fileName);
      setProfile({ avatar: storageRef, avatarSource: 'custom' });
      if (previousAvatar && previousAvatar.startsWith('storage:profilePhotos:')) {
        const parsed = parseStorageReference(previousAvatar);
        if (parsed) {
          void deleteStorageFile('profilePhotos', parsed.objectId).catch(() => undefined);
        }
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to upload profile photo.');
    } finally {
      setUploadingProfilePhoto(false);
      if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
    }
  };

  const handleExternalStorageBackup = async () => {
    setExternalBackupRunning(true);
    setExternalBackupStatus('Saving backup to connected storage...');
    try {
      const payload = exportAllNotes();
      const result = await saveExternalStorageBackup(payload, externalBackupRetention);
      setExternalBackupStatus(`Saved ${result.fileName} (${(result.size / 1024).toFixed(1)} KB) to external storage.`);
      updateSettings({ lastBackupAt: new Date().toISOString() });
    } catch (error) {
      setExternalBackupStatus(error instanceof Error ? error.message : 'External storage backup failed.');
    } finally {
      setExternalBackupRunning(false);
    }
  };

  const handleConnectedStorageExport = async () => {
    setConnectedExportRunning(true);
    setConnectedExportStatus('Uploading export ZIP to connected storage...');
    try {
      const data = exportAllNotes();
      const result = await exportWorkspaceArchiveToConnectedStorage(data, connectedExportRetention);
      setConnectedExportStatus(`Saved ${result.fileName} to connected storage.`);
      updateSettings({ lastBackupAt: new Date().toISOString() });
    } catch (error) {
      setConnectedExportStatus(error instanceof Error ? error.message : 'Export to connected storage failed.');
    } finally {
      setConnectedExportRunning(false);
    }
  };

  const handleSnapshotBackup = async () => {
    setSnapshotRunning(true);
    setSnapshotStatus(null);
    try {
      const meta = await createCloudBackup('manual');
      setSnapshotStatus({
        tone: 'ok',
        text: `Snapshot saved — ${meta.noteCount} note${meta.noteCount === 1 ? '' : 's'} backed up.`,
      });
    } catch (err) {
      console.error('Cloud snapshot backup failed', err);
      setSnapshotStatus({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Cloud snapshot backup failed.',
      });
    } finally {
      setSnapshotRunning(false);
    }
  };

  const handleBrowserNotificationToggle = async () => {
    if (settings.browserNotificationsEnabled) {
      updateSettings({ browserNotificationsEnabled: false });
      setNotificationStatus('Browser alerts are off. In-app notifications still sync.');
      return;
    }

    if (!('Notification' in window)) {
      updateSettings({ browserNotificationsEnabled: false });
      setNotificationPermission('unsupported');
      setNotificationStatus('This browser does not support browser notifications.');
      return;
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();

    setNotificationPermission(permission);
    if (permission === 'granted') {
      updateSettings({ notificationsEnabled: true, browserNotificationsEnabled: true });
      setNotificationStatus('Browser alerts are on for this device.');
    } else {
      updateSettings({ browserNotificationsEnabled: false });
      setNotificationStatus('Browser alerts were blocked or dismissed. You can still use the synced notification inbox.');
    }
  };

  const handleCleanupOldTrash = async () => {
    const result = await cleanupTrashOlderThan(cleanupDays);
    setCleanupStatus(`Removed ${result.notes} note${result.notes === 1 ? '' : 's'} and ${result.notebooks} notebook${result.notebooks === 1 ? '' : 's'} from trash.`);
  };

  const handleCompressInlineImages = async () => {
    setCompressingImages(true);
    setCleanupStatus('Compressing inline images...');

    let changed = 0;
    for (const note of imageHeavyNotes) {
      const compressed = await compressInlineImagesInMarkdown(note.content);
      if (compressed !== note.content) {
        changed += 1;
        await updateNote(note.id, { content: compressed }, true);
      }
    }

    setCompressingImages(false);
    setCleanupStatus(`Compressed images in ${changed} note${changed === 1 ? '' : 's'}.`);
  };

  const sections = [
    { id: 'profile', icon: User, label: 'Your profile', group: 'everyday', keywords: 'name email account identity avatar photo' },
    { id: 'ai', icon: Sparkles, label: 'NTK AI', group: 'everyday', keywords: 'ai assistant writing connection provider guest storage api' },
    { id: 'appearance', icon: Palette, label: 'Look & feel', group: 'everyday', keywords: 'dark light system theme color colour accent layout grid list kanban spacing' },
    { id: 'editor', icon: Type, label: 'Writing', group: 'everyday', keywords: 'font size spell check autosave word count default note notebook markdown checklist' },
    { id: 'notifications', icon: BellRing, label: 'Alerts & reminders', group: 'everyday', keywords: 'notification reminder browser quiet hours snooze celebration collaboration' },
    { id: 'sync', icon: ShieldCheck, label: 'Sync & offline', group: 'everyday', keywords: 'sync manual cloud offline install pwa conflict device' },
    { id: 'data', icon: Download, label: 'Backups & data', group: 'everyday', keywords: 'backup restore export import drive storage cleanup reset' },
    { id: 'tags', icon: Tag, label: 'Tags', group: 'advanced', keywords: 'tag merge delete organize' },
    { id: 'analytics', icon: TrendingUp, label: 'Insights', group: 'advanced', keywords: 'analytics statistics productivity words tasks' },
    { id: 'shortcuts', icon: Keyboard, label: 'Keyboard shortcuts', group: 'advanced', keywords: 'keyboard ctrl hotkeys commands' },
    { id: 'about', icon: Info, label: 'Help & about', group: 'advanced', keywords: 'about version app help guide getting started tour beginner novice' },
  ] as const;

  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const matchingSections = normalizedSettingsQuery
    ? sections.filter(section => `${section.label} ${section.keywords}`.toLowerCase().includes(normalizedSettingsQuery))
    : sections.filter(section => showAdvancedSettings || section.group === 'everyday' || section.id === activeSection);
  const resolvedTheme = settings.theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : settings.theme;
  const recommendedFonts = ['Inter', 'DM Sans', 'Manrope', 'Georgia', 'System Default'];
  const displayedFonts = showAllFonts
    ? premiumFontFamilies
    : premiumFontFamilies.filter(font => recommendedFonts.includes(font.label) || font.value === settings.editorFontFamily);

  const shortcuts = [
    { keys: 'Ctrl + B', desc: 'Bold text' },
    { keys: 'Ctrl + I', desc: 'Italic text' },
    { keys: 'Ctrl + U', desc: 'Underline text' },
    { keys: 'Ctrl + K', desc: 'Insert link' },
    { keys: 'Ctrl + S', desc: 'Save current note' },
    { keys: 'Ctrl + Shift + N', desc: 'New note' },
    { keys: 'Ctrl + /', desc: 'Command palette' },
    { keys: 'Ctrl + \\', desc: 'Toggle sidebar' },
    { keys: 'Ctrl + Alt + L', desc: 'Collapse notes list' },
    { keys: 'Ctrl + Alt + P', desc: 'Collapse editor panel' },
    { keys: 'Escape', desc: 'Close editor / Go back' },
  ];

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <div className="mb-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl accent-soft accent-text"><Sparkles className="h-5 w-5 no-transition" /></div>
            <div>
              <h2 className="text-2xl font-bold text-theme-primary">Settings</h2>
              <p className="mt-1 text-sm leading-6 text-theme-tertiary">Make NTK Note comfortable for you. Everyday choices are simple and changes apply immediately; technical controls stay out of the way until you need them.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <SettingsStatus label="Appearance" value={`${resolvedTheme === 'dark' ? 'Dark' : 'Light'} · ${settings.accent}`} />
            <SettingsStatus label="Writing" value={`${settings.editorFontSize}px · ${premiumFontFamilies.find(font => font.value === settings.editorFontFamily)?.label || 'Custom font'}`} />
            <SettingsStatus label="Sync" value={uid ? (online ? 'Signed in · Online' : 'Signed in · Offline') : 'Local on this device'} />
          </div>
        </div>

        <label className="mb-4 flex min-h-11 items-center gap-2 rounded-xl border theme-border theme-input px-3">
          <Search className="h-4 w-4 shrink-0 text-theme-tertiary no-transition" />
          <span className="sr-only">Search settings</span>
          <input value={settingsQuery} onChange={event => setSettingsQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-theme-primary outline-none placeholder:text-theme-muted" placeholder="Find a setting — dark mode, font, backup, reminders…" />
        </label>

        <div className="mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {matchingSections.map(sec => (
              <button
                key={sec.id}
                onClick={() => { setActiveSection(sec.id); setSettingsQuery(''); }}
                className="flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors"
                style={{
                  borderColor: activeSection === sec.id ? 'var(--accent-primary)' : 'var(--card-border)',
                  backgroundColor: activeSection === sec.id ? 'var(--active-bg)' : 'var(--card-bg)',
                  color: activeSection === sec.id ? 'var(--badge-text)' : 'var(--text-secondary)',
                }}
              >
                <sec.icon className="h-4 w-4 shrink-0 no-transition" /><span>{sec.label}</span>
              </button>
            ))}
          </div>
          {!normalizedSettingsQuery && (
            <button type="button" onClick={() => setShowAdvancedSettings(value => !value)} className="rounded-lg px-2 py-1.5 text-xs font-semibold accent-text theme-hover">
              {showAdvancedSettings ? 'Hide extra settings' : 'Show more settings'}
            </button>
          )}
          {normalizedSettingsQuery && matchingSections.length === 0 && <p className="rounded-xl border border-dashed theme-border px-4 py-3 text-sm text-theme-tertiary">No setting matched that search. Try “backup”, “dark”, “font”, “reminder”, or “sync”.</p>}
        </div>

        {activeSection === 'ai' && (
          <div className="animate-fade-in">
            <AiSettingsPanel />
          </div>
        )}

        {/* Profile Section */}
        {activeSection === 'profile' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Profile Information">
              <div className="flex items-center gap-4 mb-6">
                <UserAvatar profile={profile} size="xl" />
                <div>
                  <h3 className="font-semibold text-theme-primary">{profile.name}</h3>
                  <p className="text-sm text-theme-tertiary">{profile.email || 'No email set'}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="settings-profile-name" className="block text-sm font-medium text-theme-secondary mb-1">Name</label>
                  <input
                    id="settings-profile-name"
                    type="text"
                    value={profile.name}
                    onChange={e => setProfile({ name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg theme-input accent-focus border text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="settings-profile-email" className="block text-sm font-medium text-theme-secondary mb-1">Email</label>
                  <input
                    id="settings-profile-email"
                    type="email"
                    value={profile.email}
                    readOnly
                    aria-readonly="true"
                    className="w-full px-3 py-2 rounded-lg theme-input border text-sm text-theme-tertiary cursor-not-allowed"
                  />
                  <p className="mt-1 text-xs text-theme-tertiary">This is the email you signed in with. NTK Note uses it for secure sharing, so it can’t be changed here.</p>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-theme-secondary">Profile picture</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {auth.currentUser?.photoURL && (
                      <button
                        type="button"
                        onClick={() => setProfile({ avatar: auth.currentUser?.photoURL || undefined, avatarSource: 'google' })}
                        className="rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
                        title="Use my Google profile photo"
                      >
                        <UserAvatar profile={{ name: profile.name, avatar: auth.currentUser.photoURL }} size="md" />
                      </button>
                    )}
                    {builtinAvatarIds.map(id => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setProfile({ avatar: builtinAvatarValue(id), avatarSource: 'builtin' })}
                        className="rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
                        title="Use this avatar"
                      >
                        <UserAvatar profile={{ name: profile.name, avatar: builtinAvatarValue(id) }} size="md" />
                      </button>
                    ))}
                    <input
                      ref={profilePhotoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleProfilePhotoFileChange}
                      disabled={uploadingProfilePhoto}
                    />
                    <button
                      type="button"
                      onClick={() => profilePhotoInputRef.current?.click()}
                      disabled={uploadingProfilePhoto}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border theme-border theme-hover text-xs font-medium text-theme-secondary disabled:opacity-50"
                      title="Upload custom photo"
                    >
                      {uploadingProfilePhoto ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          <Camera className="w-3.5 h-3.5" />
                          Upload my own photo
                        </>
                      )}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-theme-tertiary">Google accounts use your profile photo when available. You can also upload your own photo or choose one of NTK Note’s built-in avatars.</p>
                </div>

                <div className="pt-4 border-t theme-border space-y-3">
                  <h4 className="text-xs uppercase font-bold tracking-wider text-theme-tertiary">Messaging & Privacy</h4>

                  <label className="flex items-center justify-between p-3 rounded-xl border theme-border cursor-pointer theme-hover">
                    <div>
                      <p className="text-sm font-semibold text-theme-primary">Allow people to find me</p>
                      <p className="text-xs text-theme-tertiary">Show your name and avatar when collaborators search for people</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={profile.discoverable !== false}
                      onChange={e => setProfile({ discoverable: e.target.checked })}
                      className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-3 rounded-xl border theme-border cursor-pointer theme-hover">
                    <div>
                      <p className="text-sm font-semibold text-theme-primary">Allow message requests</p>
                      <p className="text-xs text-theme-tertiary">Let new people send you a private message request</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={profile.allowMessageRequests !== false}
                      onChange={e => setProfile({ allowMessageRequests: e.target.checked })}
                      className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            </SettingCard>

            <SettingCard title="Statistics">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: 'Total Notes', value: stats.notes },
                  { label: 'Total Words', value: stats.words.toLocaleString() },
                  { label: 'Tags', value: stats.tags },
                  { label: 'Notebooks', value: stats.notebooks },
                  { label: 'Tasks', value: stats.tasks },
                  { label: 'Completed', value: stats.completedTasks },
                ].map((s, i) => (
                  <div key={i} className="p-3 rounded-lg text-center" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <p className="text-xl font-bold text-theme-primary">{s.value}</p>
                    <p className="text-xs text-theme-tertiary">{s.label}</p>
                  </div>
                ))}
              </div>
            </SettingCard>
          </div>
        )}

        {/* Appearance Section */}
        {activeSection === 'appearance' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="App appearance" description="Choose how NTK Note looks. The preview changes immediately so you can see what each option does.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ThemeChoice label="Light" description="Bright and clean" selected={settings.theme === 'light'} onClick={() => setTheme('light')} preview="light" icon={<Sun className="h-5 w-5 no-transition" />} />
                <ThemeChoice label="Dark" description="Low-glare at night" selected={settings.theme === 'dark'} onClick={() => setTheme('dark')} preview="dark" icon={<Moon className="h-5 w-5 no-transition" />} />
                <ThemeChoice label="Use device setting" description={`Currently ${systemPrefersDark ? 'dark' : 'light'}`} selected={settings.theme === 'system'} onClick={() => setTheme('system')} preview="system" icon={<Monitor className="h-5 w-5 no-transition" />} />
              </div>
              <p className="mt-3 text-xs leading-5 text-theme-tertiary">{settings.theme === 'system' ? `NTK Note is following this device and is currently showing ${systemPrefersDark ? 'dark' : 'light'} mode.` : `${settings.theme === 'dark' ? 'Dark' : 'Light'} mode is fixed until you change it here.`}</p>
            </SettingCard>

            <SettingCard title="Accent colour" description="This changes buttons, highlights, selected items, links, and focus rings. It adapts automatically in dark mode so it stays visible.">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(Object.keys(accentColors) as ThemeAccent[]).map(color => (
                  <button key={color} type="button" onClick={() => setAccent(color)} aria-pressed={settings.accent === color} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-sm font-medium transition-all" style={{ borderColor: settings.accent === color ? 'var(--accent-primary)' : 'var(--card-border)', backgroundColor: settings.accent === color ? 'var(--active-bg)' : 'var(--card-bg)', color: 'var(--text-secondary)' }}>
                    <span className={`h-5 w-5 shrink-0 rounded-full ${accentColors[color].bg}`} aria-hidden="true" /><span className="capitalize">{color}</span>{settings.accent === color && <CheckCircle2 className="ml-auto h-4 w-4 accent-text no-transition" />}
                  </button>
                ))}
              </div>
            </SettingCard>

            <SettingCard title="Default note style" description="This is the background style new notes start with. Existing notes keep their own style unless you change them individually.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(Object.entries(noteThemes) as [NoteTheme, typeof noteThemes.canvas][]).map(([key, theme]) => (
                  <button key={key} type="button" onClick={() => updateSettings({ defaultNoteTheme: key })} className="text-left rounded-xl border p-3 transition-all theme-hover" style={{ borderColor: settings.defaultNoteTheme === key ? 'var(--accent-primary)' : 'var(--card-border)', backgroundColor: settings.defaultNoteTheme === key ? 'var(--active-bg)' : 'var(--card-bg)' }}>
                    <span data-note-theme={key} className="note-theme-editor block h-12 rounded-lg mb-2 border p-2" style={{ backgroundColor: 'var(--note-theme-bg)', borderColor: 'var(--note-theme-border)' }}>
                      <span className="block h-1.5 w-2/3 rounded-full" style={{ backgroundColor: theme.accent, opacity: 0.8 }} /><span className="mt-2 block h-1 w-4/5 rounded-full" style={{ backgroundColor: 'var(--text-muted)', opacity: 0.45 }} />
                    </span>
                    <span className="block text-sm font-semibold text-theme-primary">{theme.label}</span><span className="block text-xs text-theme-tertiary mt-0.5">{theme.description}</span>
                  </button>
                ))}
              </div>
            </SettingCard>

            <SettingCard title="Notes layout" description="These controls change how your notes are displayed. They do not change the content inside your notes.">
              <ToggleSetting label="Default notes view" description="How All Notes opens" value={settings.noteViewMode} options={[{ value: 'grid', label: 'Cards' }, { value: 'list', label: 'List' }, { value: 'kanban', label: 'Board' }]} onChange={v => updateSettings({ noteViewMode: v as 'grid' | 'list' | 'kanban' })} />
              <ToggleSetting label="Note card spacing" description="How much space note cards use" value={settings.density} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }]} onChange={v => updateSettings({ density: v as 'compact' | 'comfortable' | 'spacious' })} />
              <div className="mt-4 rounded-xl border theme-border p-3" style={{ backgroundColor: 'var(--app-bg-subtle)' }}><p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-theme-muted">Spacing preview</p><div className={`rounded-xl border theme-card ${settings.density === 'compact' ? 'p-2.5' : settings.density === 'spacious' ? 'p-5' : 'p-3.5'}`}><p className="text-sm font-semibold text-theme-primary">Example note</p><p className="mt-1 text-xs text-theme-tertiary">This preview shows how much room each note card will use.</p></div></div>

              <details className="mt-4 rounded-xl border theme-border p-3.5">
                <summary className="cursor-pointer text-sm font-semibold text-theme-secondary">Desktop panel controls</summary><p className="mt-1 text-xs leading-5 text-theme-tertiary">These options only matter on wide desktop screens. On phones and tablets, NTK Note arranges panels automatically.</p>
                <div className="mt-3 space-y-1 border-t pt-3 theme-divider">
                  <FriendlySwitch label="Use a smaller sidebar" description="Show an icon rail instead of the full desktop menu." checked={settings.sidebarCollapsed} onChange={() => updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })} />
                  <FriendlySwitch label="Hide the notes list panel" description="Keep the editor wider and leave a control to reopen the list." checked={settings.noteListCollapsed} onChange={() => updateSettings({ noteListCollapsed: !settings.noteListCollapsed, editorPanelCollapsed: !settings.noteListCollapsed ? false : settings.editorPanelCollapsed })} />
                  <FriendlySwitch label="Hide the editor panel" description="Focus on the notes list and reopen the editor when needed." checked={settings.editorPanelCollapsed} onChange={() => updateSettings({ editorPanelCollapsed: !settings.editorPanelCollapsed, noteListCollapsed: !settings.editorPanelCollapsed ? false : settings.noteListCollapsed })} />
                </div>
              </details>
              <button type="button" onClick={() => { setTheme('system'); setAccent('indigo'); updateSettings({ defaultNoteTheme: 'canvas', noteViewMode: 'grid', density: 'comfortable', sidebarCollapsed: false, noteListCollapsed: false, editorPanelCollapsed: false }); }} className="mt-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-theme-secondary theme-hover"><RotateCcw className="h-3.5 w-3.5 no-transition" />Reset look & layout to recommended</button>
            </SettingCard>
          </div>
        )}

        {/* Writing Section */}
        {activeSection === 'editor' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Writing comfort" description="Make the editor comfortable to read and write in. The sample below changes immediately so you can see the effect before opening a note.">
              <div className="mb-5 rounded-xl border theme-border p-4" style={{ backgroundColor: 'var(--input-bg)', fontFamily: settings.editorFontFamily, fontSize: `${settings.editorFontSize}px` }} aria-label="Writing settings preview">
                <p className="font-semibold text-theme-primary">This is how your writing will feel.</p><p className="mt-1 leading-7 text-theme-secondary">A clear, comfortable editor helps you focus on your ideas instead of the controls around them.</p>{settings.showWordCount && <p className="mt-3 text-xs text-theme-tertiary">18 words · word count is visible</p>}
              </div>
              <div><div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="settings-editor-font-size" className="text-sm font-medium text-theme-secondary">Writing text size</label><span className="rounded-lg px-2 py-1 text-xs font-semibold accent-soft accent-text">{settings.editorFontSize}px</span></div><input id="settings-editor-font-size" type="range" min="12" max="24" value={settings.editorFontSize} onChange={e => updateSettings({ editorFontSize: parseInt(e.target.value) })} className="w-full accent-range" /><div className="mt-1 flex justify-between text-xs text-theme-tertiary"><span>Smaller</span><span>Larger</span></div></div>
              <div className="mt-5"><label htmlFor="settings-editor-font-family" className="mb-2 block text-sm font-medium text-theme-secondary">Writing font</label><select id="settings-editor-font-family" value={settings.editorFontFamily} onChange={e => updateSettings({ editorFontFamily: e.target.value })} className="w-full rounded-lg border theme-input accent-focus px-3 py-2.5 text-sm focus:outline-none">{displayedFonts.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select><button type="button" onClick={() => setShowAllFonts(value => !value)} className="mt-2 text-xs font-semibold accent-text">{showAllFonts ? 'Show recommended fonts only' : `Show all ${premiumFontFamilies.length} fonts`}</button></div>
              <div className="mt-5 space-y-1 border-t pt-3 theme-divider">
                <FriendlySwitch label="Show word count" description="Shows words and characters at the bottom of the editor." checked={settings.showWordCount} onChange={() => updateSettings({ showWordCount: !settings.showWordCount })} />
                <FriendlySwitch label="Check spelling" description="Let your browser underline words that may be misspelled." checked={settings.spellCheck} onChange={() => updateSettings({ spellCheck: !settings.spellCheck })} />
                <FriendlySwitch label="Save while I type" description={settings.autoSave ? 'Recommended. NTK Note saves your changes automatically while you write.' : 'Off. Your note still saves when you leave the field or press Ctrl/Cmd + S.'} checked={settings.autoSave} onChange={() => updateSettings({ autoSave: !settings.autoSave })} />
              </div>
            </SettingCard>

            <SettingCard title="When I create a new note" description="Choose sensible defaults so you do not have to make the same choices every time. You can still change an individual note later.">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="mb-1 block text-sm font-medium text-theme-secondary">Start with</span><select value={settings.defaultNoteType} onChange={e => updateSettings({ defaultNoteType: e.target.value as 'note' | 'checklist' | 'markdown' })} className="w-full rounded-lg border theme-input accent-focus px-3 py-2.5 text-sm focus:outline-none"><option value="note">Normal note</option><option value="checklist">Checklist</option><option value="markdown">Markdown note (advanced)</option></select><span className="mt-1 block text-xs text-theme-tertiary">For most people, Normal note is the easiest choice.</span></label>
                <label className="block"><span className="mb-1 block text-sm font-medium text-theme-secondary">Put new notes in</span><select value={settings.defaultNotebook || 'default'} onChange={e => updateSettings({ defaultNotebook: e.target.value || 'default' })} className="w-full rounded-lg border theme-input accent-focus px-3 py-2.5 text-sm focus:outline-none"><option value="default">My Notebook</option>{notebooks.filter(notebook => !notebook.trashed && notebook.id !== 'default').map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}</select><span className="mt-1 block text-xs text-theme-tertiary">Useful if most of your notes belong in one notebook.</span></label>
              </div>
              <button type="button" onClick={() => { const inter = premiumFontFamilies.find(font => font.label === 'Inter'); updateSettings({ editorFontSize: 16, editorFontFamily: inter?.value || 'Inter, ui-sans-serif, system-ui, sans-serif', showWordCount: true, autoSave: true, spellCheck: true, defaultNoteType: 'note', defaultNotebook: 'default' }); }} className="mt-5 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-theme-secondary theme-hover"><RotateCcw className="h-3.5 w-3.5 no-transition" />Reset writing settings to recommended</button>
            </SettingCard>
          </div>
        )}

        {/* Tag Manager Section */}
        {activeSection === 'tags' && (() => {
          const tagCounts: { [tag: string]: number } = {};
          notes.forEach(note => {
            if (!note.trashed) {
              note.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              });
            }
          });
          const uniqueTags = Object.keys(tagCounts).sort();

          return (
            <div className="space-y-6 animate-fade-in">
              <SettingCard title="Bulk Tag Manager">
                <p className="text-sm text-theme-tertiary mb-4">
                  Manage all unique tags in your second brain. Renaming or deleting tags here will bulk-update all notes containing them.
                </p>
                {uniqueTags.length === 0 ? (
                  <div className="text-center py-8 text-sm text-theme-muted italic">
                    No tags created yet. Add tags to your notes to manage them here.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {uniqueTags.map(tag => (
                      <div
                        key={tag}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border theme-border bg-[var(--input-bg)]/20"
                      >
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold" style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}>
                            <Tag className="w-3.5 h-3.5" />
                            {tag}
                          </span>
                          <span className="text-xs text-theme-tertiary">
                            Used in {tagCounts[tag]} {tagCounts[tag] === 1 ? 'note' : 'notes'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => {
                              const newTag = prompt(`Rename tag "${tag}" to:`, tag);
                              if (!newTag || !newTag.trim() || newTag.trim() === tag) return;
                              const trimmedNew = newTag.trim();
                              notes.forEach(n => {
                                if (n.tags.includes(tag)) {
                                  const updated = n.tags.map(t => t === tag ? trimmedNew : t);
                                  void updateNote(n.id, { tags: Array.from(new Set(updated)) });
                                }
                              });
                            }}
                            className="px-2.5 py-1.5 rounded-lg border theme-border theme-hover text-xs font-semibold text-theme-secondary transition-colors cursor-pointer"
                          >
                            Rename
                          </button>
                          <button
                            onClick={() => {
                              const targetTag = prompt(`Merge all notes tagged "${tag}" into which tag?`);
                              if (!targetTag || !targetTag.trim() || targetTag.trim() === tag) return;
                              const trimmedTarget = targetTag.trim();
                              notes.forEach(n => {
                                if (n.tags.includes(tag)) {
                                  const updated = n.tags.map(t => t === tag ? trimmedTarget : t);
                                  void updateNote(n.id, { tags: Array.from(new Set(updated)) });
                                }
                              });
                            }}
                            className="px-2.5 py-1.5 rounded-lg border theme-border theme-hover text-xs font-semibold text-theme-secondary transition-colors cursor-pointer"
                          >
                            Merge
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Remove tag "${tag}" from all notes?`)) {
                                notes.forEach(n => {
                                  if (n.tags.includes(tag)) {
                                    void updateNote(n.id, { tags: n.tags.filter(t => t !== tag) });
                                  }
                                });
                              }
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-950/40 text-red-600 hover:bg-red-500/10 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SettingCard>
            </div>
          );
        })()}

        {/* Analytics Section */}
        {activeSection === 'analytics' && (() => {
          let totalWords = 0;
          let activeNotesCount = 0;
          let totalTasks = 0;
          let completedTasks = 0;
          const priorityCounts = { low: 0, medium: 0, high: 0, urgent: 0, none: 0 };
          const themeCounts: { [theme: string]: number } = {};

          notes.forEach(n => {
            if (!n.trashed) {
              activeNotesCount++;
              totalWords += n.wordCount || 0;
              
              if (n.priority) {
                priorityCounts[n.priority]++;
              } else {
                priorityCounts.none++;
              }

              const theme = n.theme || 'canvas';
              themeCounts[theme] = (themeCounts[theme] || 0) + 1;

              if (n.checklist) {
                n.checklist.forEach(item => {
                  totalTasks++;
                  if (item.checked) completedTasks++;
                });
              }
            }
          });

          const avgWords = activeNotesCount > 0 ? Math.round(totalWords / activeNotesCount) : 0;
          const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

          const days: Date[] = [];
          for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            days.push(d);
          }
          const dailyCreations = days.map(day => {
            const dayStr = day.toDateString();
            return notes.filter(n => {
              if (n.trashed) return false;
              const createdDate = new Date(n.createdAt);
              return createdDate.toDateString() === dayStr;
            }).length;
          });

          const maxCount = Math.max(...dailyCreations, 1);
          const chartHeight = 120;
          const chartWidth = 350;
          const barWidth = 35;
          const gap = 12;

          return (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl theme-card border p-4 text-center">
                  <p className="text-2xl font-black text-theme-primary">{totalWords.toLocaleString()}</p>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-theme-tertiary mt-1">Total Words Typed</p>
                </div>
                <div className="rounded-xl theme-card border p-4 text-center">
                  <p className="text-2xl font-black text-theme-primary">{avgWords}</p>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-theme-tertiary mt-1">Avg Words / Note</p>
                </div>
                <div className="rounded-xl theme-card border p-4 text-center">
                  <p className="text-2xl font-black text-theme-primary">{taskCompletionRate}%</p>
                  <p className="text-[10px] uppercase font-bold tracking-wider text-theme-tertiary mt-1">Task Completion Rate</p>
                </div>
              </div>

              <SettingCard title="Weekly Productivity Trend">
                <p className="text-xs text-theme-tertiary mb-6">Note creation volume over the last 7 days</p>
                <div className="flex items-center justify-center p-4 bg-[var(--input-bg)]/10 border theme-border rounded-xl">
                  <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 35}`} className="w-full h-48 overflow-visible max-w-lg">
                    {dailyCreations.map((count, i) => {
                      const barHeight = (count / maxCount) * chartHeight;
                      const x = i * (barWidth + gap) + 15;
                      const y = chartHeight - barHeight + 10;
                      const dayName = days[i].toLocaleDateString(undefined, { weekday: 'short' });
                      
                      return (
                        <g key={i} className="group">
                          <rect
                            x={x - 2}
                            y={10}
                            width={barWidth + 4}
                            height={chartHeight}
                            fill="transparent"
                            className="hover:fill-[var(--accent-primary)]/5 transition-colors cursor-pointer rounded-lg"
                          />
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={barHeight}
                            rx={5}
                            fill="var(--accent-primary, #6366f1)"
                            className="transition-all duration-500 ease-out"
                          />
                          <text
                            x={x + barWidth / 2}
                            y={y - 6}
                            textAnchor="middle"
                            className="text-[10px] font-bold fill-theme-primary opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            {count}
                          </text>
                          <text
                            x={x + barWidth / 2}
                            y={chartHeight + 25}
                            textAnchor="middle"
                            className="text-[10px] fill-theme-tertiary font-bold"
                          >
                            {dayName}
                          </text>
                        </g>
                      );
                    })}
                    <line
                      x1={5}
                      y1={chartHeight + 10}
                      x2={chartWidth - 5}
                      y2={chartHeight + 10}
                      stroke="var(--card-border)"
                      strokeWidth={1.5}
                    />
                  </svg>
                </div>
              </SettingCard>

              <SettingCard title="Priority Distribution">
                <div className="space-y-4">
                  {(Object.keys(priorityCounts) as (keyof typeof priorityCounts)[]).map(priority => {
                    const count = priorityCounts[priority];
                    const pct = activeNotesCount > 0 ? Math.round((count / activeNotesCount) * 100) : 0;
                    
                    let color = 'bg-gray-400';
                    if (priority === 'low') color = 'bg-blue-400';
                    if (priority === 'medium') color = 'bg-yellow-400';
                    if (priority === 'high') color = 'bg-orange-400';
                    if (priority === 'urgent') color = 'bg-red-500';

                    return (
                      <div key={priority} className="space-y-1">
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="capitalize text-theme-secondary">{priority === 'none' ? 'General (No Priority)' : priority}</span>
                          <span className="text-theme-tertiary">{count} notes ({pct}%)</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-[var(--app-bg-subtle)]/40 overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SettingCard>

              <SettingCard title="Theme Usage Popularity">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(noteThemes).map(([key, theme]) => {
                    const count = themeCounts[key] || 0;
                    return (
                      <div key={key} className="flex items-center gap-2.5 p-2.5 rounded-xl border theme-border bg-[var(--input-bg)]/25">
                        <span className="w-5 h-5 rounded-md border shrink-0" style={{ background: theme.preview }} />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-theme-primary truncate">{theme.label}</p>
                          <p className="text-[10px] text-theme-tertiary">{count} notes</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SettingCard>
            </div>
          );
        })()}

        {/* Shortcuts Section */}
        {activeSection === 'shortcuts' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Keyboard Shortcuts">
              <div className="space-y-2">
                {shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <span className="text-sm text-theme-secondary">{s.desc}</span>
                    <kbd
                      className="px-2 py-1 rounded-md border text-xs font-mono"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        borderColor: 'var(--card-border)',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </SettingCard>
          </div>
        )}

        {/* Notifications Section */}
        {activeSection === 'notifications' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Alerts on this device" description="Choose whether NTK Note should show reminders and updates inside the app and, when your browser allows it, as system alerts.">
              <div className="space-y-1">
                <FriendlySwitch label="Use notifications in NTK Note" description="Keeps reminder and collaboration messages in the NTK Note notification inbox." checked={settings.notificationsEnabled} onChange={() => updateSettings({ notificationsEnabled: !settings.notificationsEnabled })} />
                <FriendlySwitch label="Show browser alerts on this device" description={notificationPermission === 'unsupported' ? 'This browser does not support system notifications.' : notificationPermission === 'denied' ? 'Blocked by your browser. Change the site permission in your browser if you want system alerts.' : notificationPermission === 'granted' ? 'Allowed on this device. Quiet hours and the choices below still apply.' : 'Your browser will ask permission the first time you turn this on.'} checked={settings.browserNotificationsEnabled} onChange={() => void handleBrowserNotificationToggle()} disabled={notificationPermission === 'unsupported'} />
              </div>
              {notificationStatus && <p className="mt-3 rounded-lg px-3 py-2 text-xs text-theme-tertiary" style={{ backgroundColor: 'var(--input-bg)' }} role="status">{notificationStatus}</p>}
            </SettingCard>

            <SettingCard title="What should alert me?" description="Turn off anything you do not want to be interrupted by. These choices control alerts; they do not delete reminders or shared activity.">
              <div className={`space-y-1 ${settings.notificationsEnabled ? '' : 'opacity-60'}`}>
                <FriendlySwitch label="Reminders" description="Standalone reminders and reminders attached to notes." checked={settings.reminderNotificationsEnabled} onChange={() => updateSettings({ reminderNotificationsEnabled: !settings.reminderNotificationsEnabled })} disabled={!settings.notificationsEnabled} />
                <FriendlySwitch label="Calendar celebrations" description="Your daily celebration message from the calendar." checked={settings.celebrationNotificationsEnabled} onChange={() => updateSettings({ celebrationNotificationsEnabled: !settings.celebrationNotificationsEnabled })} disabled={!settings.notificationsEnabled} />
                <FriendlySwitch label="Shared-note activity" description="Updates about notes and team spaces shared with you." checked={settings.collaborationNotificationsEnabled} onChange={() => updateSettings({ collaborationNotificationsEnabled: !settings.collaborationNotificationsEnabled })} disabled={!settings.notificationsEnabled} />
              </div>
              {!settings.notificationsEnabled && <p className="mt-2 text-xs text-theme-tertiary">Turn on “Use notifications in NTK Note” to change these choices.</p>}
            </SettingCard>

            <SettingCard title="When should alerts stay quiet?" description="Quiet hours stop browser pop-ups during the times you choose. Your reminders remain visible in NTK Note.">
              <FriendlySwitch label="Use quiet hours" description={settings.quietHoursEnabled ? `Browser alerts stay quiet from ${settings.quietHoursStart} to ${settings.quietHoursEnd}.` : 'Off. Browser alerts may appear at any time if you have allowed them.'} checked={settings.quietHoursEnabled} onChange={() => updateSettings({ quietHoursEnabled: !settings.quietHoursEnabled })} />
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block"><span className="mb-1 block text-sm font-medium text-theme-secondary">Quiet time starts</span><input type="time" value={settings.quietHoursStart} disabled={!settings.quietHoursEnabled} onChange={e => updateSettings({ quietHoursStart: e.target.value })} className="w-full rounded-lg border theme-input accent-focus px-3 py-2.5 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" /></label>
                <label className="block"><span className="mb-1 block text-sm font-medium text-theme-secondary">Quiet time ends</span><input type="time" value={settings.quietHoursEnd} disabled={!settings.quietHoursEnabled} onChange={e => updateSettings({ quietHoursEnd: e.target.value })} className="w-full rounded-lg border theme-input accent-focus px-3 py-2.5 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50" /></label>
              </div>
              <div className="mt-5"><ToggleSetting label="Default snooze" description="You can still choose a different snooze time on an individual reminder." value={String(settings.defaultSnoozeMinutes)} options={[{ value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '30', label: '30 min' }, { value: '60', label: '1 hour' }]} onChange={value => updateSettings({ defaultSnoozeMinutes: Number(value) })} /></div>
              <label className={`mt-4 block ${settings.celebrationNotificationsEnabled ? '' : 'opacity-60'}`}><span className="mb-1 block text-sm font-medium text-theme-secondary">Daily calendar reminder time</span><input type="time" value={settings.celebrationReminderTime} disabled={!settings.celebrationNotificationsEnabled} onChange={e => updateSettings({ celebrationReminderTime: e.target.value })} className="w-full rounded-lg border theme-input accent-focus px-3 py-2.5 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-xs" /><span className="mt-1 block text-xs text-theme-tertiary">Used only when Calendar celebrations are turned on.</span></label>
            </SettingCard>
          </div>
        )}

        {/* Sync Section */}
        {activeSection === 'sync' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="Keep my devices up to date" description="NTK Note syncs automatically when you are signed in. Manual Sync is there when you want to check immediately — it does not replace automatic sync.">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border theme-border p-4" style={{ backgroundColor: 'var(--input-bg)' }}><p className="text-xs font-semibold uppercase tracking-wide text-theme-muted">Account</p><p className="mt-1 text-sm font-semibold text-theme-primary">{uid ? 'Signed in' : 'This device only'}</p><p className="mt-1 text-xs leading-5 text-theme-tertiary">{uid ? 'Your signed-in notes can sync with your other signed-in devices.' : 'Sign in when you want cross-device syncing. Local notes remain available on this device.'}</p></div>
                <div className="rounded-xl border theme-border p-4" style={{ backgroundColor: 'var(--input-bg)' }}><p className="text-xs font-semibold uppercase tracking-wide text-theme-muted">Connection</p><p className={`mt-1 text-sm font-semibold ${online ? 'text-emerald-500' : 'text-amber-500'}`}>{online ? 'Online' : 'Offline'}</p><p className="mt-1 text-xs leading-5 text-theme-tertiary">{online ? 'Automatic sync can send and receive changes now.' : 'Safe edits stay local until your connection returns.'}</p></div>
              </div>
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <div className="flex-1"><ManualSyncButton variant="full" /></div>
                <button
                  type="button"
                  onClick={() => setSyncCenterOpen(true)}
                  className="px-4 py-3 rounded-xl border theme-border theme-hover text-xs font-semibold text-theme-secondary flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 accent-text" />
                  <span>Open Sync & Offline Center</span>
                </button>
              </div>
            </SettingCard>

            <SettingCard title="Offline & install" description="Offline support works automatically where your browser supports it. There is no technical switch you need to manage.">
              <div className="flex items-start gap-3 rounded-xl border theme-border p-4" style={{ backgroundColor: 'var(--input-bg)' }}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg accent-soft accent-text"><Wifi className="h-4 w-4 no-transition" /></div><div><p className="text-sm font-semibold text-theme-primary">Offline support</p><p className="mt-1 text-xs leading-5 text-theme-tertiary">{offlineStatus}</p></div></div>
              <button onClick={handleInstallPwa} className="mt-3 flex w-full items-center gap-3 rounded-xl border theme-border px-4 py-3 text-left transition-colors theme-hover"><DownloadCloud className="h-5 w-5 shrink-0 accent-text no-transition" /><div className="min-w-0"><p className="text-sm font-semibold text-theme-primary">Install NTK Note on this device</p><p className="text-xs leading-5 text-theme-tertiary">{installPrompt ? 'Ready to install as an app from this browser.' : 'If your browser supports installation, NTK Note can appear like an app on your home screen or desktop.'}</p></div><ChevronRight className="ml-auto h-4 w-4 shrink-0 text-theme-tertiary no-transition" /></button>
              {installMessage && <p className="mt-2 text-xs text-theme-tertiary" role="status">{installMessage}</p>}
            </SettingCard>

            <SettingCard title="When two copies changed at once" description="This is rare. If NTK Note cannot safely decide which version to keep, it asks you instead of silently overwriting your work.">
              {syncConflicts.length === 0 ? (
                <div className="flex items-start gap-3 rounded-xl p-4" style={{ backgroundColor: 'var(--input-bg)' }}>
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500 no-transition" />
                  <div>
                    <p className="text-sm font-semibold text-theme-primary">Nothing needs your attention</p>
                    <p className="mt-1 text-xs text-theme-tertiary">Your local and cloud copies are not reporting any unresolved conflicts.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {syncConflicts.map(conflict => (
                    <div key={conflict.id} className="rounded-xl border theme-divider p-4" style={{ backgroundColor: 'var(--input-bg)' }}>
                      <div className="mb-3 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500 no-transition" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-theme-primary">{conflict.local.title || conflict.remote?.title || 'Untitled note'}</p>
                          <p className="mt-1 text-xs text-theme-tertiary">
                            {conflict.deletedRemotely
                              ? 'This note was deleted on another device. Your unsynced edits are preserved as a new note.'
                              : 'This note also changed on another device. NTK Note safely preserves both versions.'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => void resolveSyncConflict(conflict.id, 'auto_safe')}
                          className="rounded-lg accent-button px-4 py-2 text-xs sm:text-sm font-semibold cursor-pointer min-h-[44px]"
                        >
                          Safely preserve edits
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SettingCard>

            <details className="rounded-xl border theme-border theme-card p-4"><summary className="cursor-pointer text-sm font-semibold text-theme-secondary">Technical sync details</summary><p className="mt-1 text-xs leading-5 text-theme-tertiary">Useful when troubleshooting. Most users do not need to change anything here.</p><div className="mt-4 border-t pt-4 theme-divider"><QuotaDashboard /></div></details>
          </div>
        )}

        {/* Data Section */}
        {activeSection === 'data' && (
          <div className="space-y-6 animate-fade-in">
            {/* Import from other apps */}
            <SettingCard title="Import from Other Apps">
              <p className="text-sm text-theme-tertiary mb-4">
                Import your notes from Evernote, Google Keep, Notion, OneNote, Simplenote, and 10+ other apps.
              </p>
              <button
                onClick={() => setShowImportManager(true)}
                className="w-full flex items-center gap-3 px-4 py-4 rounded-xl accent-gradient text-white transition-all shadow-lg"
              >
                <FolderInput className="w-5 h-5 no-transition" />
                <div className="text-left">
                  <p className="font-medium">Import from Other Apps</p>
                  <p className="text-xs opacity-75">Evernote, Google Keep, Notion, OneNote, and more...</p>
                </div>
                <ChevronRight className="w-4 h-4 ml-auto no-transition" />
              </button>
            </SettingCard>

            <SettingCard title="Cloud backup" description="Save a restorable copy to your signed-in NTK Note account. NTK Note keeps a small recent history so this stays lightweight.">
              <p className="text-sm text-theme-tertiary mb-4">
                Use this before a major cleanup or whenever you want extra peace of mind. Restore it later from any signed-in device.
              </p>
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleSnapshotBackup}
                    disabled={!uid || snapshotRunning}
                    title={uid ? undefined : 'Sign in to enable cloud backup'}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl accent-gradient text-white shadow-lg transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {snapshotRunning ? (
                      <RefreshCw className="w-5 h-5 no-transition animate-spin" />
                    ) : (
                      <CloudUpload className="w-5 h-5 no-transition" />
                    )}
                    <div className="text-left">
                      <p className="font-bold text-sm">Backup now</p>
                      <p className="text-xs opacity-80">
                        {snapshotRunning ? 'Creating snapshot...' : 'One click, fully automatic'}
                      </p>
                    </div>
                  </button>

                  <button
                    onClick={() => setShowBackupCenter(true)}
                    disabled={!uid}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-xl border theme-border theme-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <ArchiveRestore className="w-5 h-5 accent-text no-transition" />
                    <div className="text-left">
                      <p className="font-bold text-sm text-theme-primary">Restore backup</p>
                      <p className="text-xs text-theme-tertiary">Browse snapshots and restore</p>
                    </div>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs text-theme-tertiary">
                  <DatabaseBackup className="w-3.5 h-3.5 no-transition" />
                  {settings.lastBackupAt
                    ? `Last snapshot: ${new Date(settings.lastBackupAt).toLocaleString()}`
                    : 'No snapshot yet — your first backup is one click away.'}
                </div>

                <div className="rounded-xl border theme-border px-3 py-2">
                  <ToggleSetting
                    label="Remind me to make a backup"
                    description="Shows a gentle reminder when it has been this long since your last backup."
                    value={String(settings.backupReminderDays)}
                    options={[{ value: '7', label: 'Weekly' }, { value: '14', label: '2 weeks' }, { value: '30', label: 'Monthly' }, { value: '90', label: '3 months' }]}
                    onChange={value => updateSettings({ backupReminderDays: Number(value) })}
                  />
                </div>

                <div className="pt-2 border-t theme-divider space-y-2">
                  <p className="text-xs font-semibold text-theme-secondary">External storage backup</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label htmlFor="external-backup-retention" className="text-xs text-theme-tertiary">Retention:</label>
                      <select
                        id="external-backup-retention"
                        value={externalBackupRetention}
                        onChange={e => setExternalBackupRetention(Number(e.target.value))}
                        className="px-2 py-1 rounded-lg border theme-border bg-[var(--input-bg)] text-xs text-theme-primary"
                      >
                        <option value={3}>Latest 3</option>
                        <option value={5}>Latest 5</option>
                        <option value={10}>Latest 10</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleExternalStorageBackup}
                      disabled={!uid || externalBackupRunning}
                      aria-label={externalBackupRunning ? 'Saving backup to external storage' : 'Save backup to external storage'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border theme-border theme-hover text-xs font-medium text-theme-primary disabled:opacity-50"
                    >
                      {externalBackupRunning ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <HardDrive className="w-3.5 h-3.5 accent-text" />
                          Save backup to external storage
                        </>
                      )}
                    </button>
                  </div>
                  {externalBackupStatus && (
                    <p className="text-xs text-theme-tertiary">{externalBackupStatus}</p>
                  )}
                </div>

                {snapshotStatus && (
                  <p
                    className={`text-sm font-medium flex items-center gap-1.5 ${snapshotStatus.tone === 'ok' ? 'text-emerald-500' : 'text-red-500'}`}
                    role="status"
                  >
                    {snapshotStatus.tone === 'ok'
                      ? <CheckCircle2 className="w-4 h-4 no-transition" />
                      : <AlertTriangle className="w-4 h-4 no-transition" />}
                    {snapshotStatus.text}
                  </p>
                )}
              </div>
            </SettingCard>

            <SettingCard title="Download, restore & cloud copies" description="Use a backup file when you want a copy you control, or send that same restore-ready ZIP to your cloud storage.">
              <div className="space-y-3">
                <button
                  onClick={handleExport}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                  style={{ backgroundColor: 'rgba(99, 102, 241, 0.08)', color: 'var(--badge-text)' }}
                >
                  <Download className="w-5 h-5 no-transition" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Download backup ZIP</p>
                    <p className="text-xs opacity-75">A restore-ready copy of your notes and workspace data</p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>

                <button
                  onClick={handleGoogleDriveExport}
                  disabled={cloudExporting || cloudSharing}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'rgba(59, 130, 246, 0.08)', color: '#3b82f6' }}
                >
                  {cloudExporting ? (
                    <RefreshCw className="w-5 h-5 no-transition animate-spin" />
                  ) : (
                    <Cloud className="w-5 h-5 no-transition" />
                  )}
                  <div className="text-left">
                    <p className="font-medium text-sm">Export to Google Drive</p>
                    <p className="text-xs opacity-75">Save a ZIP backup to your Drive</p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>

                <button
                  onClick={handleCloudShare}
                  disabled={cloudExporting || cloudSharing}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'rgba(14, 165, 233, 0.08)', color: '#0ea5e9' }}
                >
                  {cloudSharing ? (
                    <RefreshCw className="w-5 h-5 no-transition animate-spin" />
                  ) : (
                    <DownloadCloud className="w-5 h-5 no-transition" />
                  )}
                  <div className="text-left">
                    <p className="font-medium text-sm">Share to cloud app</p>
                    <p className="text-xs opacity-75">Use your device share sheet when available</p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>

                <button
                  onClick={handleConnectedStorageExport}
                  disabled={connectedExportRunning || cloudExporting || cloudSharing}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'rgba(168, 85, 247, 0.08)', color: '#a855f7' }}
                >
                  {connectedExportRunning ? (
                    <RefreshCw className="w-5 h-5 no-transition animate-spin" />
                  ) : (
                    <HardDrive className="w-5 h-5 no-transition" />
                  )}
                  <div className="text-left">
                    <p className="font-medium text-sm">Save export to connected storage</p>
                    <p className="text-xs opacity-75">Send ZIP workspace export to configured storage (Retention: {connectedExportRetention} days)</p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>
                <div className="flex items-center gap-2 px-2">
                  <label className="text-xs text-theme-tertiary whitespace-nowrap">Retention</label>
                  <select
                    value={connectedExportRetention}
                    onChange={e => setConnectedExportRetention(Number(e.target.value))}
                    className="text-xs rounded-lg px-2 py-1 border theme-border bg-transparent text-theme-secondary"
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </div>
                {connectedExportStatus && (
                  <p className="text-xs text-theme-tertiary px-2">{connectedExportStatus}</p>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                  style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', color: '#10b981' }}
                >
                  <Upload className="w-5 h-5 no-transition" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Restore from a backup file</p>
                    <p className="text-xs opacity-75">Choose an NTK Note ZIP or JSON backup</p>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto no-transition" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.json"
                  onChange={handleImport}
                  className="hidden"
                />

                {importResult && (
                  <p className={`text-sm font-medium ${importResult.includes('success') ? 'text-emerald-500' : 'text-red-500'}`}>
                    {importResult}
                  </p>
                )}

                {cloudExportStatus && (
                  <div className="rounded-xl border theme-border px-3 py-2 text-sm text-theme-secondary">
                    <p>{cloudExportStatus}</p>
                    {cloudExportLink && (
                      <a
                        href={cloudExportLink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-500 hover:underline"
                      >
                        Open in Drive <ExternalLink className="w-3 h-3 no-transition" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </SettingCard>

            <SettingCard title="Storage cleanup" description="Find unusually large notes and safely reduce storage when needed. You can ignore this section unless NTK Note warns that storage is getting heavy.">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border theme-border p-3" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <p className="text-xs text-theme-tertiary">Very large notes</p>
                    <p className={`text-xl font-bold ${oversizedNotes.length ? 'text-red-500' : 'text-emerald-500'}`}>{oversizedNotes.length}</p>
                  </div>
                  <div className="rounded-xl border theme-border p-3" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <p className="text-xs text-theme-tertiary">Notes with images</p>
                    <p className="text-xl font-bold text-theme-primary">{imageHeavyNotes.length}</p>
                  </div>
                  <div className="rounded-xl border theme-border p-3" style={{ backgroundColor: 'var(--input-bg)' }}>
                    <p className="text-xs text-theme-tertiary">Largest note size</p>
                    <p className="text-xl font-bold text-theme-primary">{storageHeavyNotes[0] ? formatBytes(storageHeavyNotes[0].bytes) : '0 B'}</p>
                  </div>
                </div>

                {storageHeavyNotes.length > 0 && (
                  <div className="rounded-xl border theme-border overflow-hidden">
                    {storageHeavyNotes.map(({ note, bytes }) => (
                      <button
                        key={note.id}
                        onClick={() => selectNote(note.id)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 border-b last:border-b-0 theme-divider theme-hover text-left"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-theme-primary truncate">{note.title || 'Untitled'}</span>
                          <span className="block text-xs text-theme-tertiary">{countInlineImages(note.content)} inline image{countInlineImages(note.content) === 1 ? '' : 's'}</span>
                        </span>
                        <span className={`text-xs font-semibold shrink-0 ${bytes >= 900000 ? 'text-red-500' : 'text-theme-tertiary'}`}>
                          {formatBytes(bytes)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => void handleCompressInlineImages()}
                    disabled={compressingImages || imageHeavyNotes.length === 0}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'rgba(59, 130, 246, 0.08)', color: '#3b82f6' }}
                  >
                    <RefreshCw className={`w-5 h-5 no-transition ${compressingImages ? 'animate-spin' : ''}`} />
                    <div className="text-left">
                      <p className="font-medium text-sm">Compress inline images</p>
                      <p className="text-xs opacity-75">Make embedded images smaller to save storage and data</p>
                    </div>
                  </button>

                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      value={cleanupDays}
                      onChange={event => setCleanupDays(Number(event.target.value))}
                      className="w-20 px-3 py-2 rounded-xl theme-input border text-sm focus:outline-none accent-focus"
                      aria-label="Trash retention days"
                    />
                    <button
                      onClick={() => void handleCleanupOldTrash()}
                      className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                      style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#ef4444' }}
                    >
                      <Trash2 className="w-5 h-5 no-transition" />
                      <div className="text-left">
                        <p className="font-medium text-sm">Clean old trash</p>
                        <p className="text-xs opacity-75">Older than {cleanupDays} days</p>
                      </div>
                    </button>
                  </div>
                </div>

                {cleanupStatus && (
                  <p className="rounded-lg px-3 py-2 text-xs text-theme-tertiary" style={{ backgroundColor: 'var(--input-bg)' }}>
                    {cleanupStatus}
                  </p>
                )}
              </div>
            </SettingCard>

            <SettingCard title="Erase NTK Note data" description="Only use this when you intentionally want to start over. Make a backup first if there is anything you may want later.">
              {!showResetConfirm ? (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', color: '#ef4444' }}
                >
                  <Trash2 className="w-5 h-5 no-transition" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Erase my NTK Note data</p>
                    <p className="text-xs opacity-75">Permanently remove notes, notebooks and settings, then start fresh</p>
                  </div>
                </button>
              ) : (
                <div className="p-4 rounded-xl border" style={{ backgroundColor: 'rgba(239, 68, 68, 0.06)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                  <p className="text-sm font-medium text-red-500 mb-3">
                    ⚠️ This will permanently delete all your notes, notebooks, and settings. This action cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { resetApp(); setShowResetConfirm(false); }}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                    >
                      Yes, delete everything
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      className="px-4 py-2 rounded-lg text-sm font-medium theme-hover"
                      style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text-secondary)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </SettingCard>
          </div>
        )}

        {/* About Section */}
        {activeSection === 'about' && (
          <div className="space-y-6 animate-fade-in">
            <SettingCard title="About NTK Note">
              <div className="text-center py-4">
                <BrandMark className="w-16 h-16 mx-auto mb-4 rounded-2xl" />
                <h3 className="text-xl font-bold text-theme-primary">NTK Note</h3>
                <p className="text-theme-tertiary text-sm mt-1">Your Second Brain</p>
                <p className="text-xs text-theme-muted mt-2">Version 2.1.0</p>
                <p className="text-xs text-theme-tertiary mt-4 max-w-sm mx-auto">
                  A private, local-first note and reminder app designed to stay useful on phones, tablets and computers — without making everyday writing feel technical.
                </p>
                <button
                  type="button"
                  onClick={() => updateSettings({ hasSeenTour: false })}
                  className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border theme-border px-4 text-sm font-semibold text-theme-secondary theme-hover"
                >
                  <Sparkles className="h-4 w-4 accent-text no-transition" />
                  Show the getting-started guide again
                </button>
                <p className="mt-2 text-xs text-theme-muted">Useful if you want a quick refresher on notes, templates, reminders, and navigation.</p>
              </div>
            </SettingCard>
          </div>
        )}
      </div>

      {/* Backup & Restore Center */}
      {showBackupCenter && (
        <BackupCenterModal isOpen={showBackupCenter} onClose={() => setShowBackupCenter(false)} />
      )}

      {/* Import Manager Modal */}
      {showImportManager && (
        <ImportManager onClose={() => setShowImportManager(false)} />
      )}
    </div>
  );
}

function SettingCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl theme-card border p-5">
      <div className="mb-4">
        <h3 className="font-semibold text-theme-primary">{title}</h3>
        {description && <p className="mt-1 text-xs leading-5 text-theme-tertiary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SettingsStatus({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border theme-border theme-card px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wide text-theme-muted">{label}</p><p className="mt-0.5 truncate text-xs font-semibold text-theme-secondary" title={value}>{value}</p></div>;
}

function ThemeChoice({ label, description, selected, onClick, preview, icon }: { label: string; description: string; selected: boolean; onClick: () => void; preview: 'light' | 'dark' | 'system'; icon: React.ReactNode }) {
  const surface = preview === 'dark'
    ? { background: '#111827', foreground: '#f8fafc', muted: '#334155' }
    : preview === 'light'
      ? { background: '#ffffff', foreground: '#0f172a', muted: '#e2e8f0' }
      : { background: 'linear-gradient(135deg, #ffffff 0 50%, #111827 50% 100%)', foreground: '#6366f1', muted: '#cbd5e1' };
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="rounded-xl border p-3 text-left transition-all" style={{ borderColor: selected ? 'var(--accent-primary)' : 'var(--card-border)', backgroundColor: selected ? 'var(--active-bg)' : 'var(--card-bg)' }}>
      <span className="mb-3 block h-16 rounded-lg border p-2" style={{ background: surface.background, borderColor: preview === 'dark' ? '#334155' : '#dbe2ea' }} aria-hidden="true"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: surface.foreground }} /><span className="h-1.5 w-12 rounded-full" style={{ backgroundColor: surface.muted }} /></span><span className="mt-3 block h-1.5 w-3/4 rounded-full" style={{ backgroundColor: surface.foreground, opacity: 0.75 }} /><span className="mt-2 block h-1.5 w-1/2 rounded-full" style={{ backgroundColor: surface.muted }} /></span>
      <span className="flex items-center gap-2 text-sm font-semibold text-theme-primary">{icon}{label}{selected && <CheckCircle2 className="ml-auto h-4 w-4 accent-text no-transition" />}</span><span className="mt-1 block text-xs text-theme-tertiary">{description}</span>
    </button>
  );
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button type="button" onClick={onChange} disabled={disabled} className="relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40" role="switch" aria-checked={checked} aria-label={label} style={{ backgroundColor: checked ? 'var(--accent-primary)' : 'var(--text-muted)' }}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} /></button>;
}

function FriendlySwitch({ label, description, checked, onChange, disabled = false }: { label: string; description: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return <div className={`flex items-start justify-between gap-4 py-2.5 ${disabled ? 'opacity-60' : ''}`}><div className="min-w-0"><p className="text-sm font-medium text-theme-secondary">{label}</p><p className="mt-0.5 text-xs leading-5 text-theme-tertiary">{description}</p></div><Switch label={label} checked={checked} onChange={onChange} disabled={disabled} /></div>;
}

function ToggleSetting({ label, description, value, options, onChange }: { label: string; description: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-2 border-b py-3 last:border-0 theme-divider sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0"><p className="text-sm font-medium text-theme-secondary">{label}</p><p className="text-xs leading-5 text-theme-tertiary">{description}</p></div>
      <div className="flex max-w-full flex-wrap gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--input-bg)' }}>
        {options.map(opt => <button type="button" key={opt.value} onClick={() => onChange(opt.value)} aria-pressed={value === opt.value} className="min-h-9 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors" style={{ backgroundColor: value === opt.value ? 'var(--card-bg)' : 'transparent', color: value === opt.value ? 'var(--text-primary)' : 'var(--text-tertiary)', boxShadow: value === opt.value ? 'var(--card-shadow)' : 'none' }}>{opt.label}</button>)}
      </div>
    </div>
  );
}
