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

export interface Reminder {
  id: string;
  noteId: string;
  time: string; // ISO string
  title: string;
  triggered: boolean;
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

export type ThemeMode = 'light' | 'dark';
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
  initials: string;
  createdAt: string;
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
  hasSeenTour: boolean;
  lastBackupAt?: string;
  backupReminderDays: number;
}

export type SidebarView = 
  | 'home' | 'all-notes' | 'notebooks' | 'tags' 
  | 'reminders' | 'starred' | 'archived' | 'trash'
  | 'templates' | 'search' | 'settings' | 'shared'
  | 'graph' | 'smart-folders';

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
  entityType?: 'note' | 'notebook' | 'teamSpace';
}

export interface SyncConflict {
  id: string;
  noteId: string;
  local: Note;
  remote: Note;
  detectedAt: string;
}
