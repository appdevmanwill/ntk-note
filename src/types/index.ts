export type NoteColor = 
  | 'default' | 'red' | 'orange' | 'yellow' | 'green' 
  | 'teal' | 'blue' | 'purple' | 'pink' | 'brown' 
  | 'gray' | 'indigo';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type NoteType = 'note' | 'checklist' | 'markdown';

export type ShareRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface ShareAccess {
  email: string;
  role: Exclude<ShareRole, 'owner'>;
  addedAt: string;
  uid?: string;
  displayName?: string;
  photoURL?: string;
}

export type NoteTheme =
  | 'canvas' | 'parchment' | 'midnight' | 'ocean' | 'forest'
  | 'sunset' | 'lavender' | 'graphite' | 'mint' | 'rose';

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  order: number;
}

export type ReminderStatus = 'active' | 'completed' | 'dismissed';

export interface Reminder {
  id: string;
  noteId: string;
  time: string; // ISO string
  title: string;
  triggered: boolean;
}

export interface AppReminder {
  id: string;
  ownerId?: string;
  noteId?: string; // Optional: linked note ID if attached to a note
  title: string;
  details?: string;
  dueAt: string; // ISO date-time string
  priority?: Priority;
  status: ReminderStatus;
  snoozedUntil?: string; // ISO date-time string if snoozed
  triggered?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StoragePurpose = 'profilePhotos' | 'images' | 'voiceNotes' | 'attachments' | 'backups' | 'exports';

export interface NoteAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  objectId?: string;
  storageKey?: string;
  url?: string;
  createdAt: string;
  pendingUpload?: boolean;
}

export interface NoteImage {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  objectId: string;
  storageKey?: string;
  caption?: string;
  width?: number;
  height?: number;
  createdAt: string;
  localDataUrl?: string;
  pendingUpload?: boolean;
}

export interface NoteVoiceNote {
  id: string;
  title: string;
  durationSeconds: number;
  size: number;
  mimeType: string;
  objectId: string;
  storageKey?: string;
  createdAt: string;
  localBlobUrl?: string;
  pendingUpload?: boolean;
  source?: 'recording' | 'generated-tts' | 'uploaded';
  transcript?: string;
  transcribedAt?: number;
}

export type AiCapability = 'text' | 'tts' | 'transcription' | 'vision' | 'image';

export interface AiCapabilities {
  text: boolean;
  tts: boolean;
  transcription: boolean;
  vision?: boolean;
  image?: boolean;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  type: NoteType;
  color: NoteColor;
  theme?: NoteTheme;
  tags: string[];
  notebookId: string;
  sectionId?: string;
  pinned: boolean;
  starred: boolean;
  archived: boolean;
  trashed: boolean;
  locked: boolean;
  encrypted?: boolean;
  encryptedPayload?: string;
  lockHint?: string;
  checklist: ChecklistItem[];
  reminder?: Reminder;
  priority: Priority | null;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  wordCount: number;
  charCount: number;
  linkedNoteIds: string[];
  order: number;
  ownerId?: string;
  sharedWith?: string[];
  shareAccess?: ShareAccess[];
  editors?: string[];
  commenters?: string[];
  viewers?: string[];
  isPublished?: boolean;
  isShared?: boolean;
  sharedBy?: string;
  attachments?: NoteAttachment[];
  images?: NoteImage[];
  photos?: NoteImage[];
  voiceNotes?: NoteVoiceNote[];
}

export interface Section {
  id: string;
  name: string;
  notebookId: string;
  order: number;
  color: NoteColor;
}

export interface Notebook {
  id: string;
  name: string;
  parentId: string | null;
  color: NoteColor;
  icon: string;
  createdAt: string;
  order: number;
  sections: Section[];
  ownerId?: string;
  sharedWith?: string[];
  shareAccess?: ShareAccess[];
  editors?: string[];
  commenters?: string[];
  viewers?: string[];
  isShared?: boolean;
  sharedBy?: string;
  trashed?: boolean;
  trashedAt?: string;
  teamSpaceId?: string | null;
}

export interface TeamSpace {
  id: string;
  name: string;
  icon: string;
  color: NoteColor;
  pinned: boolean;
  notebookIds: string[];
  members: ShareAccess[];
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityItem {
  id: string;
  entityType: 'note' | 'notebook' | 'team-space';
  entityId: string;
  noteId?: string;
  notebookId?: string;
  teamSpaceId?: string;
  action: string;
  message: string;
  actorEmail: string;
  actorName?: string;
  participants: string[];
  createdAt: string;
  shared?: boolean;
}

export interface NoteComment {
  id: string;
  noteId: string;
  body: string;
  authorEmail: string;
  authorName?: string;
  mentions: string[];
  participants: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: NoteColor;
  count: number;
}

export interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  content: string;
  type: NoteType;
  theme?: NoteTheme;
  tags: string[];
  checklist: ChecklistItem[];
}

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeAccent = 
  | 'indigo' | 'blue' | 'purple' | 'pink' | 'red' 
  | 'orange' | 'amber' | 'emerald' | 'teal' | 'cyan'
  | 'violet' | 'rose';

export type NoteSortBy = 'order' | 'updatedAt' | 'createdAt' | 'title' | 'priority' | 'wordCount';
export type SortDirection = 'asc' | 'desc';
export type NotebookSortBy = 'manual' | 'name' | 'createdAt' | 'recentNote' | 'noteCount';

export interface UserProfile {
  name: string;
  email: string;
  avatar?: string;
  avatarSource?: 'google' | 'builtin' | 'custom';
  initials: string;
  createdAt: string;
  discoverable?: boolean;
  allowMessageRequests?: boolean;
}

export interface AppSettings {
  theme: ThemeMode;
  accent: ThemeAccent;
  sidebarCollapsed: boolean;
  noteListCollapsed: boolean;
  editorPanelCollapsed: boolean;
  defaultNoteType: NoteType;
  defaultNoteTheme: NoteTheme;
  defaultNotebook: string;
  editorFontSize: number;
  editorFontFamily: string;
  density: 'compact' | 'comfortable' | 'spacious';
  showWordCount: boolean;
  autoSave: boolean;
  spellCheck: boolean;
  zenMode: boolean;
  noteViewMode: 'grid' | 'list' | 'kanban';
  notebookSortBy: NotebookSortBy;
  notebookSortDir: SortDirection;
  offlineModeEnabled: boolean;
  notificationsEnabled: boolean;
  browserNotificationsEnabled: boolean;
  reminderNotificationsEnabled: boolean;
  celebrationNotificationsEnabled: boolean;
  collaborationNotificationsEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  celebrationReminderTime: string;
  defaultSnoozeMinutes: number;
  hasSeenTour: boolean;
  lastBackupAt?: string;
  backupReminderDays: number;
  aiEnabled: boolean;
  aiDefaultScope: 'selection' | 'note';
  aiWritingStyle: 'natural' | 'professional' | 'simple' | 'detailed';
  aiConfirmWholeNote: boolean;
  storageGuardEnabled: boolean;
  storageGuardTargetGb: number;
  voiceNoteQuality: 'standard' | 'high';
  voiceNoteMaxDurationMinutes: number;
  listenLanguage?: string;
  listenAccent?: string;
  listenVoice?: string;
  listenStyle?: string;
  listenSpeed?: number;
  listenGender?: 'all' | 'female' | 'male';
  favouriteVoices?: string[];
  listenEngine?: ListenEngineConfig;
}

export type SpeechProviderKind = 'cloudflare' | 'google-speech';

export interface LanguageCapabilityItem {
  code: string;
  label: string;
  classification: 'NATIVE' | 'SUPPORTED' | 'CLOSEST MATCH' | 'UNAVAILABLE';
}

export interface SpeechProviderCapabilities {
  provider: SpeechProviderKind;
  providerLabel: string;
  model?: string;
  available: boolean;
  languages: LanguageCapabilityItem[];
  voiceSelection: boolean;
  genderSelection: boolean;
  speedControl: boolean;
  streaming: boolean;
  mp3: boolean;
  download: boolean;
  saveToR2: boolean;
  preview: boolean;
}

export interface ListenEngineConfig {
  mode: 'automatic' | 'cloudflare' | 'google' | 'custom';
  cloudflareEnabled: boolean;
  googleEnabled: boolean;
  preferredOrder: Array<'cloudflare' | 'google'>;
}

export type SidebarView = 
  | 'home' | 'all-notes' | 'notebooks' | 'tags' 
  | 'reminders' | 'starred' | 'archived' | 'trash'
  | 'templates' | 'search' | 'settings' | 'shared'
  | 'graph' | 'smart-folders' | 'notifications'
  | 'folders' | 'more' | 'ai' | 'profile' | 'messages';

export type AppNotificationType =
  | 'note-reminder'
  | 'celebration'
  | 'shared-activity'
  | 'backup'
  | 'sync-conflict'
  | 'system';

export type AppNotificationPriority = 'low' | 'normal' | 'high';

export type AppNotificationAction =
  | 'open-note'
  | 'open-reminder'
  | 'open-calendar'
  | 'open-share-center'
  | 'open-settings'
  | 'open-trash';

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  title: string;
  message: string;
  createdAt: string;
  dueAt?: string;
  readAt?: string;
  dismissedAt?: string;
  snoozedUntil?: string;
  lastDeliveredAt?: string;
  deliveryCount?: number;
  noteId?: string;
  entityId?: string;
  action?: AppNotificationAction;
  priority?: AppNotificationPriority;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SearchFilters {
  query: string;
  tags: string[];
  notebooks: string[];
  colors: NoteColor[];
  types: NoteType[];
  priorities: Priority[];
  hasReminder: boolean | null;
  hasChecklist: boolean | null;
  dateRange: { start: string; end: string } | null;
  sharedBy: string[];
  sortBy: NoteSortBy;
  sortDir: SortDirection;
}

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  description: string;
  action: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters;
  createdAt: string;
}

export interface SyncQueueItem {
  id: string;
  noteId: string;
  operation: 'upsert' | 'delete';
  createdAt: string;
  attempts: number;
  entityType?: 'note' | 'notebook' | 'teamSpace' | 'notification' | 'reminder';
  wasShared?: boolean;
  ownerId?: string;
  baseUpdatedAt?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'attention' | 'error' | 'offline' | 'saved_locally' | 'synced';

export type SyncConflictStrategy = 'auto_safe' | 'keep_local' | 'use_remote' | 'keep_both' | 'local' | 'remote' | 'keep_deleted' | 'recover_version';

export interface ManualSyncResult {
  queuedBefore: number;
  syncedChanges: number;
  remainingChanges: number;
  conflicts: number;
  syncedAt: string;
  mediaDetails?: {
    pendingTotal: number;
    waitingForBackoff: number;
    needsAttention: number;
    eligibleNow: number;
    authPaused: number;
  };
}

export interface SyncConflict {
  id: string;
  noteId: string;
  local: Note;
  remote?: Note;
  detectedAt: string;
  /** True when the remote note was deleted on another device while this client had pending edits. */
  deletedRemotely?: boolean;
}

export interface ConflictRecoveryNotice {
  id: string;
  conflictId?: string;
  type: 'concurrent_edit' | 'remote_deletion';
  title: string;
  message: string;
  recoveredNoteId: string;
  canonicalNoteId: string | null;
  recoveredNote?: Note;
  canonicalNote?: Note;
  localTitle?: string;
  remoteTitle?: string;
  localContent?: string;
  remoteContent?: string;
  detectedAt: string;
}

export type DirectChatStatus = 'active' | 'pending' | 'declined' | 'blocked';

export type ChatTimestamp = any;

export interface DirectChat {
  id: string;
  participantUids: string[];
  participantEmails: string[];
  participantData?: Record<string, { name?: string; email?: string; photoURL?: string }>;
  createdAt: ChatTimestamp;
  lastMessageAt: ChatTimestamp;
  lastMessagePreview: string;
  lastMessageSenderUid: string;
  status: DirectChatStatus;
  requestedByUid: string;
  requestPreview?: string;
  lastReadAtByUid?: Record<string, ChatTimestamp>;
  blockedByUids?: string[]; // UIDs of users who initiated a block
  acceptedAt?: ChatTimestamp;
  declinedAt?: ChatTimestamp;
  blockedAt?: ChatTimestamp;
  // Enriched in memory for display:
  otherParticipant?: {
    uid: string;
    displayName: string;
    email?: string;
    photoURL?: string;
  };
}

export interface DirectMessage {
  id: string;
  chatId?: string;
  senderUid: string;
  senderEmail?: string;
  text: string;
  createdAt: ChatTimestamp;
  type: 'text';
}

export interface AiThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview?: string;
  noteId?: string;
  noteTitle?: string;
}

export interface AiTurn {
  id: string;
  threadId?: string;
  userText: string;
  assistantText: string;
  createdAt: string;
  status: 'completed' | 'partial' | 'error' | 'stopped';
  model?: string;
  provider?: string;
}

export interface UserDirectoryEntry {
  uid?: string;
  name: string;
  email: string;
  initials: string;
  photoURL?: string;
  discoverable?: boolean;
  searchPrefixes?: string[];
  updatedAt?: string;
}

