import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import { db } from '@/utils/firebase';
import { auth } from '@/utils/firebase';
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { premiumFontFamilies } from '@/utils/fonts';
import { encryptNoteData, decryptNoteData } from '@/utils/crypto';
import {
  getEntityParticipants,
  legacyEmailsToShareAccess,
  normalizeEmail,
  normalizeShareAccess,
  shareAccessToRoleArrays,
} from '@/utils/collaboration';
import type {
  Note, Notebook, Tag, NoteColor, Priority,
  ChecklistItem, UserProfile, AppSettings, SidebarView,
  SearchFilters, ThemeMode, ThemeAccent, NoteTheme, Reminder, NoteTemplate, Section,
  SavedSearch, SyncConflict, SyncQueueItem, ShareAccess, TeamSpace, ActivityItem,
  AppNotification
} from '@/types';

// ── Helpers ──
const now = () => new Date().toISOString();
const loadJSON = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const saveJSON = (key: string, data: unknown) => {
  localStorage.setItem(key, JSON.stringify(data));
};

const stripUndefined = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const definedOnly = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

const fontValue = (label: string): string => {
  const normalized = label === 'system-ui' ? 'System Default' : label;
  return premiumFontFamilies.find(font => font.label === normalized || font.value === normalized)?.value
    || premiumFontFamilies.find(font => font.label === 'Inter')?.value
    || 'Inter, ui-sans-serif, system-ui, sans-serif';
};

const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
const countChars = (text: string) => text.length;

const syncTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const activityThrottle: Record<string, number> = {};
const NOTIFICATION_LIMIT = 300;

const sortNotifications = (items: AppNotification[]) =>
  [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

const capNotifications = (items: AppNotification[]) => sortNotifications(items).slice(0, NOTIFICATION_LIMIT);

// ── Default Data ──
const defaultNotebook: Notebook = {
  id: 'default',
  name: 'My Notebook',
  parentId: null,
  color: 'indigo',
  icon: '📓',
  createdAt: now(),
  order: 0,
  sections: [],
};

const defaultProfile: UserProfile = {
  name: '',
  email: '',
  initials: '',
  createdAt: now(),
};

const defaultSettings: AppSettings = {
  theme: 'light',
  accent: 'indigo',
  sidebarCollapsed: false,
  noteListCollapsed: false,
  editorPanelCollapsed: false,
  defaultNoteType: 'note',
  defaultNoteTheme: 'canvas',
  defaultNotebook: 'default',
  editorFontSize: 16,
  editorFontFamily: fontValue('Inter'),
  density: 'comfortable',
  showWordCount: true,
  autoSave: true,
  spellCheck: true,
  zenMode: false,
  noteViewMode: 'grid',
  notebookSortBy: 'manual',
  notebookSortDir: 'asc',
  offlineModeEnabled: false,
  notificationsEnabled: true,
  browserNotificationsEnabled: false,
  reminderNotificationsEnabled: true,
  celebrationNotificationsEnabled: true,
  collaborationNotificationsEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  celebrationReminderTime: '08:00',
  defaultSnoozeMinutes: 10,
  hasSeenTour: false,
  backupReminderDays: 14,
};

const defaultSearchFilters: SearchFilters = {
  query: '',
  tags: [],
  notebooks: [],
  colors: [],
  types: [],
  priorities: [],
  hasReminder: null,
  hasChecklist: null,
  dateRange: null,
  sharedBy: [],
  sortBy: 'updatedAt',
  sortDir: 'desc',
};

const defaultTemplates: NoteTemplate[] = [
  {
    id: 'tpl-meeting',
    name: 'Meeting Notes',
    description: 'Structure for capturing meeting details',
    icon: '🤝',
    content: '# Meeting Notes\n\n**Date:** \n**Attendees:** \n**Agenda:**\n\n---\n\n## Discussion Points\n\n1. \n\n## Action Items\n\n- [ ] \n\n## Next Steps\n\n',
    type: 'note',
    tags: ['meeting'],
    checklist: [],
  },
  {
    id: 'tpl-journal',
    name: 'Daily Journal',
    description: 'Daily reflection and gratitude',
    icon: '📔',
    content: '# Daily Journal\n\n**Date:** \n\n## 🙏 Gratitude\n\n1. \n2. \n3. \n\n## 📝 Today\'s Highlights\n\n\n\n## 💡 Ideas & Insights\n\n\n\n## 🎯 Tomorrow\'s Goals\n\n- [ ] \n',
    type: 'note',
    tags: ['journal', 'daily'],
    checklist: [],
  },
  {
    id: 'tpl-project',
    name: 'Project Plan',
    description: 'Project planning template',
    icon: '🚀',
    content: '# Project: [Name]\n\n## Overview\n\n**Goal:** \n**Deadline:** \n**Status:** 🟡 In Progress\n\n## Milestones\n\n- [ ] Phase 1: \n- [ ] Phase 2: \n- [ ] Phase 3: \n\n## Resources\n\n\n## Notes\n\n',
    type: 'note',
    tags: ['project'],
    checklist: [],
  },
  {
    id: 'tpl-todo',
    name: 'To-Do List',
    description: 'Simple task checklist',
    icon: '✅',
    content: '',
    type: 'checklist',
    tags: ['todo'],
    checklist: [
      { id: uuid(), text: 'Task 1', checked: false, order: 0 },
      { id: uuid(), text: 'Task 2', checked: false, order: 1 },
      { id: uuid(), text: 'Task 3', checked: false, order: 2 },
    ],
  },
  {
    id: 'tpl-weekly',
    name: 'Weekly Review',
    description: 'Weekly reflection and planning',
    icon: '📅',
    content: '# Weekly Review\n\n**Week of:** \n\n## ✅ Accomplishments\n\n\n\n## 🚧 Challenges\n\n\n\n## 📊 Key Metrics\n\n\n\n## 🎯 Next Week\'s Priorities\n\n1. \n2. \n3. \n\n## 💭 Reflections\n\n',
    type: 'note',
    tags: ['weekly', 'review'],
    checklist: [],
  },
  {
    id: 'tpl-brainstorm',
    name: 'Brainstorm',
    description: 'Free-form idea generation',
    icon: '💡',
    content: '# Brainstorm: [Topic]\n\n## Core Idea\n\n\n\n## Related Ideas\n\n- \n- \n- \n\n## Pros & Cons\n\n| Pros | Cons |\n|------|------|\n|  |  |\n\n## Next Steps\n\n',
    type: 'note',
    tags: ['brainstorm', 'ideas'],
    checklist: [],
  },
];

const checklist = (...items: string[]): ChecklistItem[] =>
  items.map((text, order) => ({ id: uuid(), text, checked: false, order }));

const premiumTemplates: NoteTemplate[] = [
  {
    id: 'tpl-executive-brief',
    name: 'Executive Brief',
    description: 'One-page leadership summary for decisions and updates',
    icon: 'BR',
    content: '# Executive Brief\n\n## Context\n\n## Key Takeaways\n\n1. \n2. \n3. \n\n## Decision Needed\n\n## Risks\n\n## Recommended Next Step\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['brief', 'leadership'],
    checklist: [],
  },
  {
    id: 'tpl-product-requirements',
    name: 'Product Requirements',
    description: 'PRD structure for features, scope, risks, and launch criteria',
    icon: 'PR',
    content: '# Product Requirements\n\n## Problem\n\n## Goals\n\n## Non-Goals\n\n## User Stories\n\n- As a user, I want to...\n\n## Requirements\n\n| Priority | Requirement | Notes |\n| --- | --- | --- |\n| Must |  |  |\n\n## Success Metrics\n\n## Launch Checklist\n\n',
    type: 'markdown',
    theme: 'ocean',
    tags: ['product', 'prd'],
    checklist: [],
  },
  {
    id: 'tpl-sprint-plan',
    name: 'Sprint Plan',
    description: 'Plan team commitments, blockers, and delivery focus',
    icon: 'SP',
    content: '# Sprint Plan\n\n## Sprint Goal\n\n## Committed Work\n\n## Dependencies\n\n## Risks\n\n## Demo Plan\n\n',
    type: 'checklist',
    theme: 'mint',
    tags: ['sprint', 'planning'],
    checklist: checklist('Confirm sprint goal', 'Prioritize backlog', 'Assign owners', 'Review dependencies', 'Schedule demo'),
  },
  {
    id: 'tpl-client-crm',
    name: 'Client CRM Note',
    description: 'Relationship snapshot for accounts, contacts, and follow-ups',
    icon: 'CRM',
    content: '# Client: [Name]\n\n## Contacts\n\n## Current Needs\n\n## Conversation Notes\n\n## Opportunities\n\n## Follow-up Plan\n\n',
    type: 'markdown',
    theme: 'canvas',
    tags: ['client', 'crm'],
    checklist: [],
  },
  {
    id: 'tpl-research-brief',
    name: 'Research Brief',
    description: 'Capture sources, insights, evidence, and synthesis',
    icon: 'RS',
    content: '# Research Brief\n\n## Question\n\n## Sources\n\n| Source | Finding | Confidence |\n| --- | --- | --- |\n|  |  |  |\n\n## Insights\n\n## Open Questions\n\n## Summary\n\n',
    type: 'markdown',
    theme: 'ocean',
    tags: ['research'],
    checklist: [],
  },
  {
    id: 'tpl-content-calendar',
    name: 'Content Calendar',
    description: 'Plan publish dates, channels, assets, and approvals',
    icon: 'CC',
    content: '# Content Calendar\n\n## Month\n\n| Date | Channel | Topic | Owner | Status |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |\n\n## Themes\n\n## Asset Needs\n\n',
    type: 'markdown',
    theme: 'sunset',
    tags: ['content', 'calendar'],
    checklist: [],
  },
  {
    id: 'tpl-meeting-decision-log',
    name: 'Decision Log',
    description: 'Track major decisions with rationale and owners',
    icon: 'DL',
    content: '# Decision Log\n\n| Date | Decision | Rationale | Owner | Review Date |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |\n\n## Notes\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['decision', 'log'],
    checklist: [],
  },
  {
    id: 'tpl-goal-system',
    name: 'Goal System',
    description: 'Plan outcomes, milestones, habits, and review rhythm',
    icon: 'GS',
    content: '# Goal System\n\n## Outcome\n\n## Why It Matters\n\n## Milestones\n\n## Habits\n\n## Weekly Review Questions\n\n',
    type: 'checklist',
    theme: 'forest',
    tags: ['goals', 'review'],
    checklist: checklist('Define measurable outcome', 'Set first milestone', 'Choose weekly review time', 'Identify blockers'),
  },
  {
    id: 'tpl-study-notes',
    name: 'Study Notes',
    description: 'Structured learning notes with recall and summary prompts',
    icon: 'ST',
    content: '# Study Notes\n\n## Topic\n\n## Core Concepts\n\n## Examples\n\n## Questions to Revisit\n\n## Five-Sentence Summary\n\n',
    type: 'markdown',
    theme: 'lavender',
    tags: ['study', 'learning'],
    checklist: [],
  },
  {
    id: 'tpl-book-notes',
    name: 'Book Notes',
    description: 'Capture highlights, arguments, quotes, and action ideas',
    icon: 'BK',
    content: '# Book Notes\n\n## Book\n\n## Big Idea\n\n## Key Arguments\n\n## Quotes\n\n## Ideas to Apply\n\n## Final Summary\n\n',
    type: 'markdown',
    theme: 'parchment',
    tags: ['book', 'reading'],
    checklist: [],
  },
  {
    id: 'tpl-habit-tracker',
    name: 'Habit Tracker',
    description: 'Daily habit checklist with reflection prompts',
    icon: 'HT',
    content: '# Habit Tracker\n\n## Week Of\n\n## Reflection\n\nWhat worked?\n\nWhat needs adjustment?\n\n',
    type: 'checklist',
    theme: 'mint',
    tags: ['habits', 'routine'],
    checklist: checklist('Morning review', 'Deep work block', 'Movement', 'Reading', 'Evening shutdown'),
  },
  {
    id: 'tpl-budget-review',
    name: 'Budget Review',
    description: 'Monthly finance review for income, spend, and priorities',
    icon: 'BR',
    content: '# Budget Review\n\n## Month\n\n## Income\n\n## Expenses\n\n| Category | Planned | Actual | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Savings Goals\n\n## Next Month Adjustments\n\n',
    type: 'markdown',
    theme: 'forest',
    tags: ['finance', 'budget'],
    checklist: [],
  },
  {
    id: 'tpl-wellness-log',
    name: 'Wellness Log',
    description: 'Gentle personal check-in for health, energy, and mood',
    icon: 'WL',
    content: '# Wellness Log\n\n## Today\n\nEnergy:\nMood:\nSleep:\n\n## What Helped\n\n## What Felt Heavy\n\n## One Kind Next Step\n\n',
    type: 'markdown',
    theme: 'rose',
    tags: ['wellness', 'personal'],
    checklist: [],
  },
  {
    id: 'tpl-travel-plan',
    name: 'Travel Plan',
    description: 'Itinerary, bookings, packing, and local notes',
    icon: 'TP',
    content: '# Travel Plan\n\n## Destination\n\n## Itinerary\n\n| Day | Plan | Booking | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Packing\n\n## Important Details\n\n',
    type: 'checklist',
    theme: 'sunset',
    tags: ['travel'],
    checklist: checklist('Confirm dates', 'Book accommodation', 'Save tickets', 'Pack essentials', 'Share itinerary'),
  },
  {
    id: 'tpl-investor-update',
    name: 'Investor Update',
    description: 'Monthly traction, wins, risks, and asks for stakeholders',
    icon: 'IU',
    content: '# Investor Update\n\n## Highlights\n\n## Metrics\n\n| Metric | Current | Previous | Notes |\n| --- | --- | --- | --- |\n| Revenue |  |  |  |\n| Users |  |  |  |\n\n## Wins\n\n## Risks\n\n## Asks\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['investor', 'update'],
    checklist: [],
  },
  {
    id: 'tpl-board-meeting',
    name: 'Board Meeting',
    description: 'Agenda, resolutions, questions, and follow-up owners',
    icon: 'BM',
    content: '# Board Meeting\n\n## Agenda\n\n## Pre-Reads\n\n## Decisions\n\n## Questions\n\n## Follow-ups\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['board', 'meeting'],
    checklist: [],
  },
  {
    id: 'tpl-sales-call',
    name: 'Sales Call Brief',
    description: 'Discovery notes, pain points, objections, and next steps',
    icon: 'SC',
    content: '# Sales Call Brief\n\n## Account\n\n## Stakeholders\n\n## Pain Points\n\n## Current Process\n\n## Objections\n\n## Next Step\n\n',
    type: 'markdown',
    theme: 'canvas',
    tags: ['sales', 'crm'],
    checklist: [],
  },
  {
    id: 'tpl-customer-support',
    name: 'Support Case',
    description: 'Issue diagnosis, reproduction, resolution, and follow-up',
    icon: 'CS',
    content: '# Support Case\n\n## Customer\n\n## Issue\n\n## Steps to Reproduce\n\n## Investigation\n\n## Resolution\n\n## Follow-up\n\n',
    type: 'checklist',
    theme: 'ocean',
    tags: ['support', 'customer'],
    checklist: checklist('Confirm issue details', 'Reproduce issue', 'Document workaround', 'Confirm resolution'),
  },
  {
    id: 'tpl-launch-plan',
    name: 'Launch Plan',
    description: 'Premium go-to-market launch checklist and command center',
    icon: 'LP',
    content: '# Launch Plan\n\n## Objective\n\n## Audience\n\n## Messaging\n\n## Channels\n\n## Timeline\n\n## Launch Risks\n\n',
    type: 'checklist',
    theme: 'sunset',
    tags: ['launch', 'marketing'],
    checklist: checklist('Finalize positioning', 'Approve assets', 'Schedule launch comms', 'Prepare support notes', 'Review launch metrics'),
  },
  {
    id: 'tpl-marketing-campaign',
    name: 'Marketing Campaign',
    description: 'Campaign strategy, audience, assets, budget, and measurement',
    icon: 'MC',
    content: '# Marketing Campaign\n\n## Campaign Goal\n\n## Audience\n\n## Offer\n\n## Channels\n\n## Asset List\n\n## Budget\n\n## Success Metrics\n\n',
    type: 'markdown',
    theme: 'lavender',
    tags: ['marketing', 'campaign'],
    checklist: [],
  },
  {
    id: 'tpl-brand-voice',
    name: 'Brand Voice',
    description: 'Tone, language, proof points, and messaging guardrails',
    icon: 'BV',
    content: '# Brand Voice\n\n## Personality\n\n## Tone Guidelines\n\n## Words We Use\n\n## Words We Avoid\n\n## Proof Points\n\n## Sample Copy\n\n',
    type: 'markdown',
    theme: 'rose',
    tags: ['brand', 'copy'],
    checklist: [],
  },
  {
    id: 'tpl-interview-notes',
    name: 'Interview Notes',
    description: 'Candidate scorecard, questions, signals, and decision notes',
    icon: 'IN',
    content: '# Interview Notes\n\n## Candidate\n\n## Role\n\n## Scorecard\n\n| Signal | Evidence | Rating |\n| --- | --- | --- |\n| Skill |  |  |\n| Culture |  |  |\n\n## Decision\n\n',
    type: 'markdown',
    theme: 'canvas',
    tags: ['hiring', 'interview'],
    checklist: [],
  },
  {
    id: 'tpl-onboarding-plan',
    name: 'Onboarding Plan',
    description: 'First-week plan for a new hire, client, or project member',
    icon: 'OP',
    content: '# Onboarding Plan\n\n## Person / Team\n\n## Outcomes\n\n## Day 1\n\n## Week 1\n\n## First 30 Days\n\n## Resources\n\n',
    type: 'checklist',
    theme: 'mint',
    tags: ['onboarding', 'people'],
    checklist: checklist('Send welcome packet', 'Schedule intro meetings', 'Share key documents', 'Set first milestone'),
  },
  {
    id: 'tpl-retrospective',
    name: 'Retrospective',
    description: 'Thoughtful team retro for lessons, decisions, and actions',
    icon: 'RT',
    content: '# Retrospective\n\n## What Went Well\n\n## What Was Hard\n\n## What We Learned\n\n## Actions\n\n',
    type: 'checklist',
    theme: 'forest',
    tags: ['retro', 'team'],
    checklist: checklist('Collect wins', 'Collect pain points', 'Choose top actions', 'Assign owners'),
  },
  {
    id: 'tpl-incident-report',
    name: 'Incident Report',
    description: 'Production incident timeline, impact, root cause, and actions',
    icon: 'IR',
    content: '# Incident Report\n\n## Summary\n\n## Impact\n\n## Timeline\n\n| Time | Event |\n| --- | --- |\n|  |  |\n\n## Root Cause\n\n## Corrective Actions\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['incident', 'engineering'],
    checklist: [],
  },
  {
    id: 'tpl-postmortem',
    name: 'Postmortem',
    description: 'Blameless review for system failures and process gaps',
    icon: 'PM',
    content: '# Postmortem\n\n## What Happened\n\n## Detection\n\n## Response\n\n## Root Causes\n\n## What Worked\n\n## What Changes\n\n',
    type: 'markdown',
    theme: 'midnight',
    tags: ['postmortem', 'ops'],
    checklist: [],
  },
  {
    id: 'tpl-api-design',
    name: 'API Design',
    description: 'Endpoint design, contracts, errors, auth, and examples',
    icon: 'API',
    content: '# API Design\n\n## Goal\n\n## Endpoints\n\n| Method | Path | Purpose |\n| --- | --- | --- |\n| GET |  |  |\n\n## Request / Response\n\n## Errors\n\n## Security\n\n',
    type: 'markdown',
    theme: 'ocean',
    tags: ['api', 'engineering'],
    checklist: [],
  },
  {
    id: 'tpl-writing-brief',
    name: 'Writing Brief',
    description: 'Editorial brief for essays, articles, and long-form writing',
    icon: 'WB',
    content: '# Writing Brief\n\n## Thesis\n\n## Audience\n\n## Outline\n\n## Sources\n\n## Draft Notes\n\n## Revision Checklist\n\n',
    type: 'markdown',
    theme: 'parchment',
    tags: ['writing', 'editorial'],
    checklist: [],
  },
  {
    id: 'tpl-podcast-episode',
    name: 'Podcast Episode',
    description: 'Episode rundown, guest prep, segments, and production notes',
    icon: 'PE',
    content: '# Podcast Episode\n\n## Episode Topic\n\n## Guest\n\n## Segments\n\n## Questions\n\n## Sponsor / CTA\n\n## Production Notes\n\n',
    type: 'checklist',
    theme: 'lavender',
    tags: ['podcast', 'content'],
    checklist: checklist('Confirm guest', 'Prepare questions', 'Record episode', 'Edit audio', 'Publish assets'),
  },
  {
    id: 'tpl-course-lesson',
    name: 'Course Lesson',
    description: 'Lesson plan with objectives, examples, exercises, and recap',
    icon: 'CL',
    content: '# Course Lesson\n\n## Learning Objective\n\n## Concept\n\n## Example\n\n## Exercise\n\n## Recap\n\n## Homework\n\n',
    type: 'markdown',
    theme: 'mint',
    tags: ['course', 'education'],
    checklist: [],
  },
  {
    id: 'tpl-legal-review',
    name: 'Legal Review',
    description: 'Contract or policy review with risks, clauses, and decisions',
    icon: 'LR',
    content: '# Legal Review\n\n## Document\n\n## Business Context\n\n## Key Clauses\n\n## Risks\n\n## Questions\n\n## Decision\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['legal', 'review'],
    checklist: [],
  },
  {
    id: 'tpl-real-estate-tour',
    name: 'Property Tour',
    description: 'Compare properties, notes, costs, pros, and cons',
    icon: 'PT',
    content: '# Property Tour\n\n## Property\n\n## Price / Terms\n\n## Pros\n\n## Cons\n\n## Questions\n\n## Follow-up\n\n',
    type: 'checklist',
    theme: 'forest',
    tags: ['property', 'planning'],
    checklist: checklist('Confirm address', 'Take photos', 'Estimate costs', 'Compare options'),
  },
  {
    id: 'tpl-event-plan',
    name: 'Event Plan',
    description: 'Venue, schedule, vendors, budget, guests, and run of show',
    icon: 'EV',
    content: '# Event Plan\n\n## Event Goal\n\n## Venue\n\n## Guest List\n\n## Run of Show\n\n## Budget\n\n## Vendor Notes\n\n',
    type: 'checklist',
    theme: 'sunset',
    tags: ['event', 'planning'],
    checklist: checklist('Confirm venue', 'Invite guests', 'Book vendors', 'Finalize run of show', 'Prepare day-of kit'),
  },
  {
    id: 'tpl-family-command-center',
    name: 'Family Command Center',
    description: 'Household planning, errands, meals, appointments, and reminders',
    icon: 'FC',
    content: '# Family Command Center\n\n## Week Of\n\n## Appointments\n\n## Meals\n\n## Errands\n\n## Notes\n\n',
    type: 'checklist',
    theme: 'rose',
    tags: ['family', 'home'],
    checklist: checklist('Plan meals', 'Review appointments', 'List errands', 'Check school/work notes'),
  },
];

// ── Store Interface ──
interface AppState {
  // Data
  notes: Note[];
  notebooks: Notebook[];
  tags: Tag[];
  templates: NoteTemplate[];
  savedSearches: SavedSearch[];
  teamSpaces: TeamSpace[];
  activityItems: ActivityItem[];
  notifications: AppNotification[];
  profile: UserProfile;
  settings: AppSettings;
  
  // UI State
  currentView: SidebarView;
  selectedNoteId: string | null;
  selectedNotebookId: string | null;
  selectedTagId: string | null;
  editingNote: boolean;
  searchFilters: SearchFilters;
  isOnboarded: boolean;
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  syncQueue: SyncQueueItem[];
  syncConflicts: SyncConflict[];
  online: boolean;
  unlockedNotes: Record<string, { title: string; content: string; checklist: ChecklistItem[]; password: string }>;
  
  // Scratch pad
  scratchPad: string;
  
  // Actions — Auth & Sync
  uid: string | null;
  unsubscribeNotes: (() => void) | null;
  unsubscribeNotebooks: (() => void) | null;
  unsubscribeSettings: (() => void) | null;
  unsubscribeTeamSpaces: (() => void) | null;
  unsubscribeActivity: (() => void) | null;
  unsubscribeNotifications: (() => void) | null;
  unsubscribeSharedNotes: (() => void) | null;
  unsubscribeSharedNotebooks: (() => void) | null;
  initFirestore: (uid: string) => void;
  clearAuth: () => void;

  // Actions — Profile
  setProfile: (profile: Partial<UserProfile>) => void;
  completeOnboarding: (name: string, email?: string) => void;
  
  // Actions — Settings
  updateSettings: (settings: Partial<AppSettings>) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  setNoteTheme: (id: string, theme: NoteTheme) => Promise<void>;
  toggleZenMode: () => void;
  flushSyncQueue: () => Promise<void>;
  resolveSyncConflict: (conflictId: string, strategy: 'local' | 'remote') => Promise<void>;
  setOnlineStatus: (online: boolean) => void;

  // Actions — Notifications
  addNotification: (notification: Omit<AppNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) => AppNotification;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  dismissNotification: (id: string) => void;
  snoozeNotification: (id: string, minutes: number) => void;
  recordNotificationDelivery: (id: string) => void;
  clearDismissedNotifications: () => void;
  
  // Actions — Notes
  createNote: (partial: Partial<Note>) => Promise<Note>;
  updateNote: (id: string, updates: Partial<Note>, immediateSync?: boolean) => Promise<void>;
  trashNote: (id: string) => Promise<void>;
  bulkTrashNotes: (ids: string[]) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  bulkDeleteNotes: (ids: string[]) => Promise<void>;
  emptyTrash: () => Promise<void>;
  cleanupTrashOlderThan: (days: number) => Promise<{ notes: number; notebooks: number }>;
  archiveNote: (id: string) => Promise<void>;
  unarchiveNote: (id: string) => Promise<void>;
  pinNote: (id: string) => Promise<void>;
  starNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<Note | null>;
  moveNote: (noteId: string, notebookId: string) => Promise<void>;
  setNoteColor: (id: string, color: NoteColor) => Promise<void>;
  setNotePriority: (id: string, priority: Priority | null) => Promise<void>;
  addNoteTag: (noteId: string, tag: string) => Promise<void>;
  removeNoteTag: (noteId: string, tag: string) => Promise<void>;
  setNoteReminder: (noteId: string, reminder: Reminder | undefined) => Promise<void>;
  reorderNotes: (noteIds: string[]) => Promise<void>;
  lockNote: (noteId: string, password: string, hint?: string) => Promise<boolean>;
  unlockNote: (noteId: string, password: string) => Promise<boolean>;
  relockNote: (noteId: string) => void;
  updateUnlockedNote: (noteId: string, updates: { title?: string; content?: string; checklist?: ChecklistItem[] }, immediateSync?: boolean) => Promise<void>;
  
  // Actions — Checklist
  addChecklistItem: (noteId: string, text: string) => Promise<void>;
  updateChecklistItem: (noteId: string, itemId: string, updates: Partial<ChecklistItem>) => Promise<void>;
  removeChecklistItem: (noteId: string, itemId: string) => Promise<void>;
  reorderChecklist: (noteId: string, itemIds: string[]) => Promise<void>;
  
  // Actions — Notebooks
  createNotebook: (name: string, parentId?: string | null, icon?: string) => Notebook;
  updateNotebook: (id: string, updates: Partial<Notebook>) => void;
  reorderNotebook: (id: string, parentId: string | null, targetIndex: number) => void;
  deleteNotebook: (id: string) => void;
  restoreNotebook: (id: string) => void;
  permanentlyDeleteNotebook: (id: string) => void;
  addSection: (notebookId: string, name: string) => Section;
  updateSection: (notebookId: string, sectionId: string, updates: Partial<Section>) => void;
  deleteSection: (notebookId: string, sectionId: string) => void;
  
  // Actions — Tags
  createTag: (name: string, color?: NoteColor) => Tag;
  deleteTag: (id: string) => void;
  renameTag: (id: string, name: string) => void;
  
  // Actions — Search & Navigation
  setSearchFilters: (filters: Partial<SearchFilters>) => void;
  clearSearch: () => void;
  setCurrentView: (view: SidebarView) => void;
  selectNote: (id: string | null) => void;
  selectNotebook: (id: string | null) => void;
  selectTag: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setEditingNote: (editing: boolean) => void;
  saveCurrentSearch: (name: string) => SavedSearch;
  applySavedSearch: (id: string) => void;
  deleteSavedSearch: (id: string) => void;

  // Actions — Scratch Pad
  updateScratchPad: (content: string) => void;
  
  // Actions — Templates
  createFromTemplate: (templateId: string) => Promise<Note | null>;
  
  createTeamSpace: (name: string, notebookIds?: string[]) => TeamSpace;
  updateTeamSpace: (id: string, updates: Partial<TeamSpace>) => void;
  deleteTeamSpace: (id: string) => void;
  addActivity: (item: Omit<ActivityItem, 'id' | 'createdAt' | 'actorEmail' | 'actorName'> & { actorEmail?: string; actorName?: string }) => Promise<ActivityItem>;
  shareNote: (noteId: string, sharedWith: string[], isPublished: boolean, shareAccess?: ShareAccess[]) => Promise<void>;
  shareNotebook: (notebookId: string, sharedWith: string[], shareAccess?: ShareAccess[]) => Promise<void>;
  
  // Actions — Export/Import
  exportAllNotes: () => string;
  importNotes: (json: string) => boolean;
  resetApp: () => Promise<void>;
  
  // Computed
  getFilteredNotes: () => Note[];
  getRecentNotes: (limit?: number) => Note[];
  getPinnedNotes: () => Note[];
  getStarredNotes: () => Note[];
  getArchivedNotes: () => Note[];
  getTrashedNotes: () => Note[];
  getNotesByNotebook: (notebookId: string) => Note[];
  getNotesByTag: (tag: string) => Note[];
  getNoteById: (id: string) => Note | undefined;
  getNotebookById: (id: string) => Notebook | undefined;
  getChildNotebooks: (parentId: string | null) => Notebook[];
  getAllTags: () => Tag[];
  getStats: () => { notes: number; words: number; tags: number; notebooks: number; tasks: number; completedTasks: number; };
  getReminders: () => Reminder[];
}

export const useStore = create<AppState>((set, get) => {
  // Load initial state from localStorage
  const initialNotes = loadJSON<Note[]>('ntk-notes', []);
  const initialNotebooks = loadJSON<Notebook[]>('ntk-notebooks', [defaultNotebook]);
  const initialProfile = loadJSON<UserProfile>('ntk-profile', defaultProfile);
  const initialSettings = { ...defaultSettings, ...loadJSON<Partial<AppSettings>>('ntk-settings', {}) };
  initialSettings.editorFontFamily = fontValue(initialSettings.editorFontFamily);
  const initialOnboarded = loadJSON<boolean>('ntk-onboarded', false);
  const initialScratchPad = loadJSON<string>('ntk-scratchpad', '');
  const initialSavedSearches = loadJSON<SavedSearch[]>('ntk-saved-searches', []);
  const initialTeamSpaces = loadJSON<TeamSpace[]>('ntk-team-spaces', []);
  const initialActivityItems = loadJSON<ActivityItem[]>('ntk-activity-items', []);
  const initialNotifications = capNotifications(loadJSON<AppNotification[]>('ntk-notifications', []));
  const initialSyncQueue = loadJSON<SyncQueueItem[]>('ntk-sync-queue', []);
  const initialSyncConflicts = loadJSON<SyncConflict[]>('ntk-sync-conflicts', []);

  // Persist helper
  const persist = () => {
    const state = get();
    saveJSON('ntk-notes', state.notes);
    saveJSON('ntk-notebooks', state.notebooks);
    saveJSON('ntk-profile', state.profile);
    saveJSON('ntk-settings', state.settings);
    saveJSON('ntk-onboarded', state.isOnboarded);
    saveJSON('ntk-scratchpad', state.scratchPad);
    saveJSON('ntk-saved-searches', state.savedSearches);
    saveJSON('ntk-team-spaces', state.teamSpaces);
    saveJSON('ntk-activity-items', state.activityItems.slice(0, 200));
    saveJSON('ntk-notifications', capNotifications(state.notifications));
    saveJSON('ntk-sync-queue', state.syncQueue);
    saveJSON('ntk-sync-conflicts', state.syncConflicts);
  };

  // Rebuild tags from notes
  const rebuildTags = (notes: Note[]): Tag[] => {
    const tagMap = new Map<string, number>();
    notes.filter(n => !n.trashed).forEach(n => {
      n.tags.forEach(t => tagMap.set(t, (tagMap.get(t) || 0) + 1));
    });
    return Array.from(tagMap.entries()).map(([name, count]) => ({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      color: 'default' as NoteColor,
      count,
    }));
  };

  const enqueueSync = (noteId: string, operation: SyncQueueItem['operation'], entityType: SyncQueueItem['entityType'] = 'note') => {
    set(s => {
      const queue = s.syncQueue.filter(item => !(item.noteId === noteId && (item.entityType || 'note') === entityType));
      return {
        syncQueue: [
          ...queue,
          { id: uuid(), noteId, operation, createdAt: now(), attempts: 0, entityType },
        ],
      };
    });
    persist();
  };

  const flushQueuedSync = async () => {
    const state = get();
    if (!state.uid || !state.online || state.syncQueue.length === 0) return;

    for (const item of [...state.syncQueue]) {
      const isNotebook = item.entityType === 'notebook';
      const isTeamSpace = item.entityType === 'teamSpace';
      const isNotification = item.entityType === 'notification';
      if (!isNotebook && !isTeamSpace && !isNotification && get().syncConflicts.some(conflict => conflict.noteId === item.noteId)) {
        continue;
      }

      try {
        if (isNotification) {
          const notification = get().notifications.find(itemRecord => itemRecord.id === item.noteId);
          if (item.operation === 'delete') {
            await deleteDoc(doc(db, `users/${state.uid}/notifications`, item.noteId));
          } else if (notification) {
            await setDoc(doc(db, `users/${state.uid}/notifications`, item.noteId), stripUndefined(notification));
          }
        } else if (isTeamSpace) {
          const teamSpace = get().teamSpaces.find(space => space.id === item.noteId);
          if (item.operation === 'delete') {
            await deleteDoc(doc(db, `users/${state.uid}/team_spaces`, item.noteId));
          } else if (teamSpace) {
            await setDoc(doc(db, `users/${state.uid}/team_spaces`, item.noteId), stripUndefined(teamSpace));
          }
        } else if (isNotebook) {
          const nb = get().notebooks.find(n => n.id === item.noteId);
          if (item.operation === 'delete') {
            if (nb?.isShared) {
              await deleteDoc(doc(db, 'shared_notebooks', item.noteId));
            } else {
              await deleteDoc(doc(db, `users/${state.uid}/notebooks`, item.noteId));
            }
          } else {
            if (nb) {
              if (nb.isShared) {
                await setDoc(doc(db, 'shared_notebooks', item.noteId), stripUndefined(nb));
              } else {
                await setDoc(doc(db, `users/${state.uid}/notebooks`, item.noteId), stripUndefined(nb));
              }
            }
          }
        } else {
          const note = get().notes.find(n => n.id === item.noteId);
          if (item.operation === 'delete') {
            if (note?.isShared) {
              await deleteDoc(doc(db, 'shared_notes', item.noteId));
            } else {
              await deleteDoc(doc(db, `users/${state.uid}/notes`, item.noteId));
            }
          } else {
            if (note) {
              if (note.isShared) {
                await setDoc(doc(db, 'shared_notes', item.noteId), stripUndefined(note));
              } else {
                await setDoc(doc(db, `users/${state.uid}/notes`, item.noteId), stripUndefined(note));
              }
            }
          }
        }
        set(s => ({ syncQueue: s.syncQueue.filter(queued => queued.id !== item.id) }));
        persist();
      } catch (error) {
        console.warn('Sync queued for retry:', error);
        set(s => ({
          syncQueue: s.syncQueue.map(queued =>
            queued.id === item.id ? { ...queued, attempts: queued.attempts + 1 } : queued
          ),
        }));
        persist();
        break;
      }
    }
  };

  const syncNoteToFirestore = (noteId: string, debounceMs = 0) => {
    if (syncTimers[noteId]) {
      clearTimeout(syncTimers[noteId]);
      delete syncTimers[noteId];
    }
    if (debounceMs > 0) {
      syncTimers[noteId] = setTimeout(() => {
        delete syncTimers[noteId];
        enqueueSync(noteId, 'upsert');
        void flushQueuedSync();
      }, debounceMs);
    } else {
      enqueueSync(noteId, 'upsert');
      void flushQueuedSync();
    }
  };

  const deleteNoteFromFirestore = (noteId: string) => {
    enqueueSync(noteId, 'delete');
    void flushQueuedSync();
  };

  const syncNotebookToFirestore = (notebookId: string) => {
    enqueueSync(notebookId, 'upsert', 'notebook');
    void flushQueuedSync();
  };

  const deleteNotebookFromFirestore = (notebookId: string) => {
    enqueueSync(notebookId, 'delete', 'notebook');
    void flushQueuedSync();
  };

  const syncTeamSpaceToFirestore = (teamSpaceId: string) => {
    enqueueSync(teamSpaceId, 'upsert', 'teamSpace');
    void flushQueuedSync();
  };

  const deleteTeamSpaceFromFirestore = (teamSpaceId: string) => {
    enqueueSync(teamSpaceId, 'delete', 'teamSpace');
    void flushQueuedSync();
  };

  const syncNotificationToFirestore = (notificationId: string) => {
    enqueueSync(notificationId, 'upsert', 'notification');
    void flushQueuedSync();
  };

  const deleteNotificationFromFirestore = (notificationId: string) => {
    enqueueSync(notificationId, 'delete', 'notification');
    void flushQueuedSync();
  };

  const syncSettingsToFirestore = (settings?: AppSettings) => {
    const { uid } = get();
    if (!uid) return;
    void setDoc(doc(db, `users/${uid}/meta/settings`), stripUndefined(settings || get().settings), { merge: true }).catch(console.error);
  };

  const getNotebookTreeIds = (notebookId: string) => {
    const ids = new Set([notebookId]);
    let changed = true;
    while (changed) {
      changed = false;
      get().notebooks.forEach(nb => {
        if (nb.parentId && ids.has(nb.parentId) && !ids.has(nb.id)) {
          ids.add(nb.id);
          changed = true;
        }
      });
    }
    return ids;
  };

  const sortNotebooksByOrder = (items: Notebook[]) =>
    [...items].sort((a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.name.localeCompare(b.name)
    );

  return {
    notes: initialNotes,
    notebooks: initialNotebooks.length ? initialNotebooks : [defaultNotebook],
    tags: rebuildTags(initialNotes),
    templates: [...defaultTemplates, ...premiumTemplates],
    savedSearches: initialSavedSearches,
    teamSpaces: initialTeamSpaces,
    activityItems: initialActivityItems,
    notifications: initialNotifications,
    profile: initialProfile,
    settings: initialSettings,
    currentView: 'home',
    selectedNoteId: null,
    selectedNotebookId: null,
    selectedTagId: null,
    editingNote: false,
    searchFilters: defaultSearchFilters,
    isOnboarded: initialOnboarded,
    sidebarOpen: false,
    commandPaletteOpen: false,
    syncQueue: initialSyncQueue,
    syncConflicts: initialSyncConflicts,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    unlockedNotes: {},
    uid: null,
    unsubscribeNotes: null,
    unsubscribeNotebooks: null,
    unsubscribeSettings: null,
    unsubscribeTeamSpaces: null,
    unsubscribeActivity: null,
    unsubscribeNotifications: null,
    unsubscribeSharedNotes: null,
    unsubscribeSharedNotebooks: null,
    
    initFirestore: (uid) => {
      set({ uid });
      const notesRef = collection(db, `users/${uid}/notes`);
      
      let isFirstNotesSnapshot = true;
      const unsubscribe = onSnapshot(notesRef, (snapshot) => {
        const notes = snapshot.docs.map(doc => doc.data() as Note);
        set(s => {
          const pendingIds = new Set(s.syncQueue.filter(item => (item.entityType || 'note') === 'note').map(item => item.noteId));
          const remoteIds = new Set(notes.map(note => note.id));
          const conflicts = [...s.syncConflicts];
          const merged = [...s.notes];

          // Upload any local notes initially to avoid accidental data loss
          if (isFirstNotesSnapshot) {
            s.notes.forEach(note => {
              if (!remoteIds.has(note.id) && !pendingIds.has(note.id)) {
                void setDoc(doc(db, `users/${uid}/notes`, note.id), stripUndefined(note)).catch(console.error);
                remoteIds.add(note.id);
              }
            });
            isFirstNotesSnapshot = false;
          }

          notes.forEach(remote => {
            const idx = merged.findIndex(note => note.id === remote.id);
            if (idx >= 0) {
              const local = merged[idx];
              if (pendingIds.has(remote.id) && local.updatedAt !== remote.updatedAt) {
                const exists = conflicts.some(conflict =>
                  conflict.noteId === remote.id &&
                  conflict.local.updatedAt === local.updatedAt &&
                  conflict.remote.updatedAt === remote.updatedAt
                );
                if (!exists) {
                  conflicts.push({ id: uuid(), noteId: remote.id, local, remote, detectedAt: now() });
                }
              } else {
                merged[idx] = remote;
              }
            } else {
              merged.push(remote);
            }
          });

          const withPending = remoteIds.size === 0
            ? merged
            : merged.filter(note => remoteIds.has(note.id) || pendingIds.has(note.id));
          return { notes: withPending, tags: rebuildTags(withPending), syncConflicts: conflicts };
        });
        persist();
        void flushQueuedSync();
      }, (error) => {
        console.error("Firestore sync error:", error);
      });

      // Synchronize notebooks
      const notebooksRef = collection(db, `users/${uid}/notebooks`);
      
      let isFirstNbsSnapshot = true;
      const unsubscribeNbs = onSnapshot(notebooksRef, (snapshot) => {
        const remoteNbs = snapshot.docs.map(doc => doc.data() as Notebook);
        set(s => {
          const merged = [...s.notebooks];
          const remoteIds = new Set(remoteNbs.map(nb => nb.id));
          const pendingIds = new Set(s.syncQueue.filter(item => item.entityType === 'notebook').map(item => item.noteId));

          if (remoteNbs.length === 0) {
            // Empty remote: sync local notebooks up to remote
            s.notebooks.forEach(nb => {
              void setDoc(doc(db, `users/${uid}/notebooks`, nb.id), stripUndefined(nb)).catch(console.error);
            });
            isFirstNbsSnapshot = false;
            return {};
          }

          // Upload any local notebooks initially to avoid accidental data loss
          if (isFirstNbsSnapshot) {
            s.notebooks.forEach(nb => {
              if (nb.id !== 'default' && !remoteIds.has(nb.id) && !pendingIds.has(nb.id)) {
                void setDoc(doc(db, `users/${uid}/notebooks`, nb.id), stripUndefined(nb)).catch(console.error);
                remoteIds.add(nb.id);
              }
            });
            isFirstNbsSnapshot = false;
          }

          remoteNbs.forEach(remote => {
            const idx = merged.findIndex(nb => nb.id === remote.id);
            if (idx >= 0) {
              if (!pendingIds.has(remote.id)) {
                merged[idx] = remote;
              }
            } else {
              merged.push(remote);
            }
          });

          const finalNbs = merged.filter(nb => remoteIds.has(nb.id) || pendingIds.has(nb.id) || nb.id === 'default');
          return { notebooks: finalNbs };
        });
        saveJSON('ntk-notebooks', get().notebooks);
        void flushQueuedSync();
      }, (error) => {
        console.error("Firestore notebooks sync error:", error);
      });

      const settingsRef = doc(db, `users/${uid}/meta/settings`);
      let isFirstSettingsSnapshot = true;
      const unsubscribeSettings = onSnapshot(settingsRef, (snapshot) => {
        if (snapshot.exists()) {
          const remoteSettings = snapshot.data() as Partial<AppSettings>;
          set(s => {
            const settings = { ...s.settings, ...remoteSettings };
            settings.editorFontFamily = fontValue(settings.editorFontFamily);
            return { settings };
          });
          persist();
        } else if (isFirstSettingsSnapshot) {
          void setDoc(settingsRef, stripUndefined(get().settings), { merge: true }).catch(console.error);
        }
        isFirstSettingsSnapshot = false;
      }, (error) => {
        console.error("Firestore settings sync error:", error);
      });

      const teamSpacesRef = collection(db, `users/${uid}/team_spaces`);
      let isFirstTeamSpacesSnapshot = true;
      const unsubscribeTeamSpaces = onSnapshot(teamSpacesRef, (snapshot) => {
        const remoteSpaces = snapshot.docs.map(doc => doc.data() as TeamSpace);
        set(s => {
          const merged = [...s.teamSpaces];
          const remoteIds = new Set(remoteSpaces.map(space => space.id));
          const pendingIds = new Set(s.syncQueue.filter(item => item.entityType === 'teamSpace').map(item => item.noteId));

          if (isFirstTeamSpacesSnapshot) {
            s.teamSpaces.forEach(space => {
              if (!remoteIds.has(space.id) && !pendingIds.has(space.id)) {
                void setDoc(doc(db, `users/${uid}/team_spaces`, space.id), stripUndefined(space)).catch(console.error);
                remoteIds.add(space.id);
              }
            });
            isFirstTeamSpacesSnapshot = false;
          }

          remoteSpaces.forEach(remote => {
            const idx = merged.findIndex(space => space.id === remote.id);
            if (idx >= 0) {
              if (!pendingIds.has(remote.id)) {
                merged[idx] = remote;
              }
            } else {
              merged.push(remote);
            }
          });

          return {
            teamSpaces: remoteIds.size === 0
              ? merged
              : merged.filter(space => remoteIds.has(space.id) || pendingIds.has(space.id)),
          };
        });
        saveJSON('ntk-team-spaces', get().teamSpaces);
        void flushQueuedSync();
      }, (error) => {
        console.error("Firestore team spaces sync error:", error);
      });

      const notificationsRef = collection(db, `users/${uid}/notifications`);
      let isFirstNotificationsSnapshot = true;
      const unsubscribeNotifications = onSnapshot(notificationsRef, (snapshot) => {
        const remoteNotifications = snapshot.docs.map(doc => doc.data() as AppNotification);
        set(s => {
          const merged = new Map<string, AppNotification>();
          s.notifications.forEach(notification => merged.set(notification.id, notification));
          const remoteIds = new Set(remoteNotifications.map(notification => notification.id));
          const pendingIds = new Set(s.syncQueue.filter(item => item.entityType === 'notification').map(item => item.noteId));

          if (isFirstNotificationsSnapshot) {
            s.notifications.forEach(notification => {
              if (!remoteIds.has(notification.id) && !pendingIds.has(notification.id)) {
                void setDoc(doc(db, `users/${uid}/notifications`, notification.id), stripUndefined(notification)).catch(console.error);
                remoteIds.add(notification.id);
              }
            });
            isFirstNotificationsSnapshot = false;
          }

          remoteNotifications.forEach(remote => {
            if (!pendingIds.has(remote.id)) {
              merged.set(remote.id, remote);
            }
          });

          return { notifications: capNotifications([...merged.values()]) };
        });
        saveJSON('ntk-notifications', get().notifications);
        void flushQueuedSync();
      }, (error) => {
        console.error("Firestore notifications sync error:", error);
      });

      // Synchronize shared notes & notebooks real-time
      const email = auth.currentUser?.email;
      let unsubscribeSharedNotes = () => {};
      let unsubscribeSharedNotebooks = () => {};
      let unsubscribeActivity = () => {};

      if (email) {
        const normalizedEmail = normalizeEmail(email);
        const sharedNotesQuery = query(collection(db, 'shared_notes'), where('sharedWith', 'array-contains', normalizedEmail));
        unsubscribeSharedNotes = onSnapshot(sharedNotesQuery, (snapshot) => {
          const sharedNotes = snapshot.docs.map(doc => ({
            ...doc.data(),
            isShared: true
          } as Note));
          
          set(s => {
            const privateNotes = s.notes.filter(n => !n.isShared);
            const merged = [...privateNotes];
            
            sharedNotes.forEach(shared => {
              const idx = merged.findIndex(n => n.id === shared.id);
              if (idx >= 0) {
                merged[idx] = shared;
              } else {
                merged.push(shared);
              }
            });
            return { notes: merged, tags: rebuildTags(merged) };
          });
        }, (error) => {
          console.error("Firestore shared notes sync error:", error);
        });

        const sharedNotebooksQuery = query(collection(db, 'shared_notebooks'), where('sharedWith', 'array-contains', normalizedEmail));
        unsubscribeSharedNotebooks = onSnapshot(sharedNotebooksQuery, (snapshot) => {
          const sharedNotebooks = snapshot.docs.map(doc => ({
            ...doc.data(),
            isShared: true
          } as Notebook));
          
          set(s => {
            const privateNbs = s.notebooks.filter(nb => !nb.isShared);
            const merged = [...privateNbs];
            
            sharedNotebooks.forEach(shared => {
              const idx = merged.findIndex(nb => nb.id === shared.id);
              if (idx >= 0) {
                merged[idx] = shared;
              } else {
                merged.push(shared);
              }
            });
            return { notebooks: merged };
          });
        }, (error) => {
          console.error("Firestore shared notebooks sync error:", error);
        });

        const activityQuery = query(collection(db, 'activity_feed'), where('participants', 'array-contains', normalizedEmail));
        unsubscribeActivity = onSnapshot(activityQuery, (snapshot) => {
          const remoteActivity = snapshot.docs.map(doc => doc.data() as ActivityItem);
          set(s => {
            const merged = new Map<string, ActivityItem>();
            [...remoteActivity, ...s.activityItems].forEach(item => merged.set(item.id, item));
            return {
              activityItems: [...merged.values()]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 200),
            };
          });
          saveJSON('ntk-activity-items', get().activityItems.slice(0, 200));
        }, (error) => {
          console.error("Firestore activity feed sync error:", error);
        });
      }

      set({
        unsubscribeNotes: unsubscribe,
        unsubscribeNotebooks: unsubscribeNbs,
        unsubscribeSettings,
        unsubscribeTeamSpaces,
        unsubscribeActivity,
        unsubscribeNotifications,
        unsubscribeSharedNotes,
        unsubscribeSharedNotebooks
      });
      void flushQueuedSync();
    },

    clearAuth: () => {
      const { unsubscribeNotes, unsubscribeNotebooks, unsubscribeSettings, unsubscribeTeamSpaces, unsubscribeActivity, unsubscribeNotifications, unsubscribeSharedNotes, unsubscribeSharedNotebooks } = get();
      if (unsubscribeNotes) unsubscribeNotes();
      if (unsubscribeNotebooks) unsubscribeNotebooks();
      if (unsubscribeSettings) unsubscribeSettings();
      if (unsubscribeTeamSpaces) unsubscribeTeamSpaces();
      if (unsubscribeActivity) unsubscribeActivity();
      if (unsubscribeNotifications) unsubscribeNotifications();
      if (unsubscribeSharedNotes) unsubscribeSharedNotes();
      if (unsubscribeSharedNotebooks) unsubscribeSharedNotebooks();
      // Clear persisted auth / onboarding state
      localStorage.removeItem('ntk-onboarded');
      localStorage.removeItem('ntk-profile');
      set({
        uid: null,
        unsubscribeNotes: null,
        unsubscribeNotebooks: null,
        unsubscribeSettings: null,
        unsubscribeTeamSpaces: null,
        unsubscribeActivity: null,
        unsubscribeNotifications: null,
        unsubscribeSharedNotes: null,
        unsubscribeSharedNotebooks: null,
        isOnboarded: false,
        profile: defaultProfile,
        currentView: 'home',
        selectedNoteId: null,
        editingNote: false,
      });
    },

    scratchPad: initialScratchPad,

    // ── Profile ──
    setProfile: (updates) => {
      set(s => {
        const profile = { ...s.profile, ...updates };
        if (profile.name) {
          const parts = profile.name.trim().split(' ');
          profile.initials = parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : parts[0].slice(0, 2).toUpperCase();
        }
        return { profile };
      });
      persist();
    },

    completeOnboarding: (name, email) => {
      const parts = name.trim().split(' ');
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0].slice(0, 2).toUpperCase();
      const profile = { name, email: email || '', initials, createdAt: now() };
      set({
        isOnboarded: true,
        profile
      });
      persist();
      if (email) {
        void setDoc(doc(db, 'users_directory', email), {
          name,
          email,
          initials,
          updatedAt: now()
        }).catch(console.error);
      }
    },

    // ── Settings ──
    updateSettings: (updates) => {
      set(s => ({ settings: { ...s.settings, ...updates } }));
      persist();
      syncSettingsToFirestore();
    },
    setTheme: (theme) => {
      set(s => ({ settings: { ...s.settings, theme } }));
      persist();
      syncSettingsToFirestore();
    },
    setAccent: (accent) => {
      set(s => ({ settings: { ...s.settings, accent } }));
      persist();
      syncSettingsToFirestore();
    },
    setNoteTheme: async (id, theme) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, theme, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },
    toggleZenMode: () => {
      set(s => ({ settings: { ...s.settings, zenMode: !s.settings.zenMode } }));
      persist();
      syncSettingsToFirestore();
    },
    flushSyncQueue: flushQueuedSync,
    resolveSyncConflict: async (conflictId, strategy) => {
      const conflict = get().syncConflicts.find(item => item.id === conflictId);
      if (!conflict) return;
      const chosen = strategy === 'local' ? conflict.local : conflict.remote;
      set(s => ({
        notes: s.notes.map(n => n.id === conflict.noteId ? chosen : n),
        syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
        syncQueue: strategy === 'remote'
          ? s.syncQueue.filter(item => item.noteId !== conflict.noteId)
          : s.syncQueue,
      }));
      persist();
      if (strategy === 'local') syncNoteToFirestore(conflict.noteId);
    },
    setOnlineStatus: (online) => {
      set({ online });
      if (online) void flushQueuedSync();
    },

    // ── Notifications ──
    addNotification: (input) => {
      let result: AppNotification = {
        ...input,
        id: input.id || uuid(),
        createdAt: input.createdAt || now(),
        priority: input.priority || 'normal',
        deliveryCount: input.deliveryCount || 0,
      };

      set(s => {
        const existing = s.notifications.find(notification => notification.id === result.id);
        const nextNotification = existing
          ? {
              ...existing,
              ...result,
              readAt: existing.readAt,
              dismissedAt: existing.dismissedAt,
              snoozedUntil: existing.snoozedUntil,
              lastDeliveredAt: existing.lastDeliveredAt,
              deliveryCount: existing.deliveryCount,
            }
          : result;

        result = nextNotification;

        return {
          notifications: capNotifications(existing
            ? s.notifications.map(notification => notification.id === nextNotification.id ? nextNotification : notification)
            : [nextNotification, ...s.notifications]),
        };
      });
      persist();
      syncNotificationToFirestore(result.id);
      return result;
    },

    markNotificationRead: (id) => {
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id || notification.readAt) return notification;
          changed = true;
          return { ...notification, readAt: now() };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    markAllNotificationsRead: () => {
      const timestamp = now();
      const changedIds: string[] = [];
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.readAt || notification.dismissedAt) return notification;
          changedIds.push(notification.id);
          return { ...notification, readAt: timestamp };
        }),
      }));
      if (changedIds.length) {
        persist();
        changedIds.forEach(id => syncNotificationToFirestore(id));
      }
    },

    dismissNotification: (id) => {
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id || notification.dismissedAt) return notification;
          changed = true;
          return {
            ...notification,
            readAt: notification.readAt || now(),
            dismissedAt: now(),
            snoozedUntil: undefined,
          };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    snoozeNotification: (id, minutes) => {
      const timestamp = new Date(Date.now() + Math.max(minutes, 1) * 60 * 1000).toISOString();
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id) return notification;
          changed = true;
          return {
            ...notification,
            readAt: notification.readAt || now(),
            dismissedAt: undefined,
            snoozedUntil: timestamp,
          };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    recordNotificationDelivery: (id) => {
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id) return notification;
          changed = true;
          return {
            ...notification,
            lastDeliveredAt: now(),
            deliveryCount: (notification.deliveryCount || 0) + 1,
            snoozedUntil: undefined,
          };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    clearDismissedNotifications: () => {
      const dismissedIds = get().notifications
        .filter(notification => notification.dismissedAt)
        .map(notification => notification.id);

      if (!dismissedIds.length) return;
      set(s => ({
        notifications: s.notifications.filter(notification => !notification.dismissedAt),
      }));
      persist();
      dismissedIds.forEach(id => deleteNotificationFromFirestore(id));
    },

    // ── Notes ──
    createNote: (partial) => {
      const id = uuid();
      const cleanPartial = definedOnly(partial as Record<string, unknown>) as Partial<Note>;
      const note: Note = {
        id,
        title: '',
        content: '',
        color: 'default',
        tags: [],
        pinned: false,
        starred: false,
        archived: false,
        trashed: false,
        locked: false,
        checklist: [],
        priority: null,
        createdAt: now(),
        updatedAt: now(),
        wordCount: 0,
        charCount: 0,
        linkedNoteIds: [],
        order: 0,
        ...cleanPartial,
        type: cleanPartial.type || get().settings.defaultNoteType,
        theme: cleanPartial.theme || get().settings.defaultNoteTheme,
        notebookId: cleanPartial.notebookId || get().settings.defaultNotebook,
      };
      set(s => {
        const notes = [note, ...s.notes];
        return { notes, tags: rebuildTags(notes), selectedNoteId: note.id, editingNote: true };
      });
      persist();
      syncNoteToFirestore(id);
      return Promise.resolve(note);
    },

    updateNote: async (id, updates, immediateSync = false) => {
      let activityMessage = '';
      let activityShared = false;
      let activityParticipants: string[] = [];
      set(s => {
        const notes = s.notes.map(n => {
          if (n.id !== id) return n;
          const updated = { ...n, ...updates, updatedAt: now() };
          if (updates.content !== undefined || updates.title !== undefined) {
            const fullText = (updates.title ?? n.title) + ' ' + (updates.content ?? n.content);
            updated.wordCount = countWords(fullText);
            updated.charCount = countChars(updates.content ?? n.content);
          }
          if (updated.isShared) {
            const isTextEdit = updates.title !== undefined || updates.content !== undefined;
            const throttleKey = `edit-${id}`;
            const canLogTextEdit = !isTextEdit || Date.now() - (activityThrottle[throttleKey] || 0) > 5 * 60 * 1000;
            if (canLogTextEdit) {
              activityThrottle[throttleKey] = Date.now();
              activityShared = true;
              activityParticipants = getEntityParticipants(updated, updated.sharedBy || s.profile.email);
              if (updates.notebookId !== undefined) activityMessage = `Moved ${updated.title || 'Untitled note'} to another notebook.`;
              else if (updates.archived !== undefined) activityMessage = `${updates.archived ? 'Archived' : 'Unarchived'} ${updated.title || 'Untitled note'}.`;
              else if (updates.trashed !== undefined) activityMessage = `${updates.trashed ? 'Moved' : 'Restored'} ${updated.title || 'Untitled note'} ${updates.trashed ? 'to trash' : 'from trash'}.`;
              else activityMessage = `Edited ${updated.title || 'Untitled note'}.`;
            }
          }
          return updated;
        });
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      const isTextEdit = updates.title !== undefined || updates.content !== undefined;
      syncNoteToFirestore(id, (isTextEdit && !immediateSync) ? 5000 : 0);
      if (activityShared && activityMessage) {
        void get().addActivity({
          entityType: 'note',
          entityId: id,
          noteId: id,
          action: 'note-updated',
          message: activityMessage,
          participants: activityParticipants,
          shared: true,
        });
      }
    },

    deleteNote: async (id) => {
      set(s => {
        const notes = s.notes.filter(n => n.id !== id);
        return {
          notes,
          tags: rebuildTags(notes),
          selectedNoteId: s.selectedNoteId === id ? null : s.selectedNoteId,
          editingNote: s.selectedNoteId === id ? false : s.editingNote,
        };
      });
      persist();
      deleteNoteFromFirestore(id);
    },

    bulkDeleteNotes: async (ids) => {
      set(s => {
        const notes = s.notes.filter(n => !ids.includes(n.id));
        return {
          notes,
          tags: rebuildTags(notes),
          selectedNoteId: ids.includes(s.selectedNoteId || '') ? null : s.selectedNoteId,
          editingNote: ids.includes(s.selectedNoteId || '') ? false : s.editingNote,
        };
      });
      persist();
      ids.forEach(id => deleteNoteFromFirestore(id));
    },

    trashNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? { ...n, trashed: true, trashedAt: now(), pinned: false } : n
        );
        return {
          notes,
          tags: rebuildTags(notes),
          selectedNoteId: s.selectedNoteId === id ? null : s.selectedNoteId,
          editingNote: s.selectedNoteId === id ? false : s.editingNote,
        };
      });
      persist();
      syncNoteToFirestore(id);
    },

    bulkTrashNotes: async (ids) => {
      set(s => {
        const notes = s.notes.map(n =>
          ids.includes(n.id) ? { ...n, trashed: true, trashedAt: now(), pinned: false } : n
        );
        return {
          notes,
          tags: rebuildTags(notes),
          selectedNoteId: ids.includes(s.selectedNoteId || '') ? null : s.selectedNoteId,
          editingNote: ids.includes(s.selectedNoteId || '') ? false : s.editingNote,
        };
      });
      persist();
      ids.forEach(id => syncNoteToFirestore(id));
    },

    restoreNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? {
            ...n,
            trashed: false,
            trashedAt: undefined,
            ...(s.notebooks.some(nb => nb.id === n.notebookId && nb.trashed)
              ? { notebookId: 'default', sectionId: undefined }
              : {}),
          } : n
        );
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(id);
    },

    emptyTrash: async () => {
      const { notes, notebooks, uid } = get();
      const trashedNotes = notes.filter(n => n.trashed);
      const trashedNotebooks = notebooks.filter(nb => nb.trashed);
      
      set(s => {
        const remainingNotes = s.notes.filter(n => !n.trashed);
        const remainingNotebooks = s.notebooks.filter(nb => !nb.trashed);
        return { 
          notes: remainingNotes, 
          tags: rebuildTags(remainingNotes),
          notebooks: remainingNotebooks
        };
      });
      persist();
      
      if (uid) {
        trashedNotes.forEach(n => deleteNoteFromFirestore(n.id));
        trashedNotebooks.forEach(nb => deleteNotebookFromFirestore(nb.id));
      }
    },

    cleanupTrashOlderThan: async (days) => {
      const cutoff = Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000;
      const { notes, notebooks, uid } = get();
      const expiredNotes = notes.filter(n =>
        n.trashed &&
        n.trashedAt &&
        new Date(n.trashedAt).getTime() <= cutoff
      );
      const expiredNotebooks = notebooks.filter(nb =>
        nb.trashed &&
        nb.trashedAt &&
        new Date(nb.trashedAt).getTime() <= cutoff
      );
      const expiredNoteIds = new Set(expiredNotes.map(note => note.id));
      const expiredNotebookIds = new Set(expiredNotebooks.map(nb => nb.id));

      set(s => {
        const remainingNotes = s.notes.filter(note => !expiredNoteIds.has(note.id));
        return {
          notes: remainingNotes,
          tags: rebuildTags(remainingNotes),
          notebooks: s.notebooks.filter(nb => !expiredNotebookIds.has(nb.id)),
          selectedNoteId: expiredNoteIds.has(s.selectedNoteId || '') ? null : s.selectedNoteId,
          editingNote: expiredNoteIds.has(s.selectedNoteId || '') ? false : s.editingNote,
          selectedNotebookId: expiredNotebookIds.has(s.selectedNotebookId || '') ? null : s.selectedNotebookId,
        };
      });
      persist();

      if (uid) {
        expiredNotes.forEach(note => deleteNoteFromFirestore(note.id));
        expiredNotebooks.forEach(nb => deleteNotebookFromFirestore(nb.id));
      }

      return { notes: expiredNotes.length, notebooks: expiredNotebooks.length };
    },

    archiveNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? { ...n, archived: true, pinned: false } : n
        );
        return {
          notes,
          selectedNoteId: s.selectedNoteId === id ? null : s.selectedNoteId,
        };
      });
      persist();
      syncNoteToFirestore(id);
    },

    unarchiveNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? { ...n, archived: false } : n
        );
        return { notes };
      });
      persist();
      syncNoteToFirestore(id);
    },

    pinNote: async (id) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    starNote: async (id) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, starred: !n.starred } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    duplicateNote: (id) => {
      const note = get().notes.find(n => n.id === id);
      if (!note) return Promise.resolve(null);
      const dup: Note = {
        ...note,
        id: uuid(),
        title: note.title + ' (Copy)',
        pinned: false,
        createdAt: now(),
        updatedAt: now(),
      };
      set(s => {
        const notes = [dup, ...s.notes];
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(dup.id);
      return Promise.resolve(dup);
    },

    moveNote: async (noteId, notebookId) => {
      const previous = get().notes.find(n => n.id === noteId);
      set(s => ({
        notes: s.notes.map(n => n.id === noteId ? { ...n, notebookId, sectionId: undefined, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(noteId);
      const updated = get().notes.find(n => n.id === noteId);
      if (updated?.isShared && previous?.notebookId !== notebookId) {
        const targetNotebook = get().notebooks.find(nb => nb.id === notebookId);
        void get().addActivity({
          entityType: 'note',
          entityId: noteId,
          noteId,
          notebookId,
          action: 'note-moved',
          message: `Moved ${updated.title || 'Untitled note'} to ${targetNotebook?.name || 'another notebook'}.`,
          participants: getEntityParticipants(updated, updated.sharedBy || get().profile.email),
          shared: true,
        });
      }
    },

    setNoteColor: async (id, color) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, color, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    setNotePriority: async (id, priority) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, priority, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    addNoteTag: async (noteId, tag) => {
      set(s => {
        const notes = s.notes.map(n => {
          if (n.id !== noteId || n.tags.includes(tag)) return n;
          return { ...n, tags: [...n.tags, tag], updatedAt: now() };
        });
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(noteId);
    },

    removeNoteTag: async (noteId, tag) => {
      set(s => {
        const notes = s.notes.map(n => {
          if (n.id !== noteId) return n;
          return { ...n, tags: n.tags.filter(t => t !== tag), updatedAt: now() };
        });
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(noteId);
    },

    setNoteReminder: async (noteId, reminder) => {
      set(s => ({
        notes: s.notes.map(n => n.id === noteId ? { ...n, reminder, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    reorderNotes: async (noteIds) => {
      set(s => ({
        notes: s.notes.map(n => {
          const idx = noteIds.indexOf(n.id);
          return idx >= 0 ? { ...n, order: idx } : n;
        })
      }));
      persist();
      noteIds.forEach(id => syncNoteToFirestore(id));
    },

    // ── Checklist ──
    lockNote: async (noteId, password, hint = '') => {
      const note = get().notes.find(n => n.id === noteId);
      if (!note || !password.trim()) return false;
      const unlocked = get().unlockedNotes[noteId];
      const payload = await encryptNoteData({
        title: unlocked?.title ?? note.title,
        content: unlocked?.content ?? note.content,
        checklist: unlocked?.checklist ?? note.checklist,
      }, password);

      set(s => ({
        notes: s.notes.map(n => n.id === noteId ? {
          ...n,
          title: unlocked?.title ?? note.title,
          content: '',
          checklist: [],
          locked: true,
          encrypted: true,
          encryptedPayload: payload,
          lockHint: hint,
          updatedAt: now(),
        } : n),
        unlockedNotes: Object.fromEntries(Object.entries(s.unlockedNotes).filter(([id]) => id !== noteId)),
      }));
      persist();
      syncNoteToFirestore(noteId);
      return true;
    },
    unlockNote: async (noteId, password) => {
      const note = get().notes.find(n => n.id === noteId);
      if (!note?.encryptedPayload) return false;
      try {
        const data = await decryptNoteData(note.encryptedPayload, password);
        set(s => ({
          unlockedNotes: {
            ...s.unlockedNotes,
            [noteId]: {
              title: data.title,
              content: data.content,
              checklist: (data.checklist || []) as ChecklistItem[],
              password,
            },
          },
        }));
        return true;
      } catch {
        return false;
      }
    },
    relockNote: (noteId) => {
      set(s => ({
        unlockedNotes: Object.fromEntries(Object.entries(s.unlockedNotes).filter(([id]) => id !== noteId)),
      }));
    },
    updateUnlockedNote: async (noteId, updates, immediateSync = false) => {
      const unlocked = get().unlockedNotes[noteId];
      if (!unlocked) return;
      const next = { ...unlocked, ...updates };
      const payload = await encryptNoteData({
        title: next.title,
        content: next.content,
        checklist: next.checklist,
      }, next.password);
      set(s => ({
        unlockedNotes: { ...s.unlockedNotes, [noteId]: next },
        notes: s.notes.map(n => n.id === noteId ? {
          ...n,
          encryptedPayload: payload,
          updatedAt: now(),
          wordCount: countWords(`${next.title} ${next.content}`),
          charCount: countChars(next.content),
        } : n),
      }));
      persist();
      const isTextEdit = updates.title !== undefined || updates.content !== undefined;
      syncNoteToFirestore(noteId, (isTextEdit && !immediateSync) ? 5000 : 0);
    },

    addChecklistItem: async (noteId, text) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          const item: ChecklistItem = {
            id: uuid(),
            text,
            checked: false,
            order: n.checklist.length,
          };
          return { ...n, checklist: [...n.checklist, item], updatedAt: now() };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    updateChecklistItem: async (noteId, itemId, updates) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          return {
            ...n,
            checklist: n.checklist.map(i => i.id === itemId ? { ...i, ...updates } : i),
            updatedAt: now(),
          };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    removeChecklistItem: async (noteId, itemId) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          return { ...n, checklist: n.checklist.filter(i => i.id !== itemId), updatedAt: now() };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    reorderChecklist: async (noteId, itemIds) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          return {
            ...n,
            checklist: n.checklist.map(i => {
              const idx = itemIds.indexOf(i.id);
              return idx >= 0 ? { ...i, order: idx } : i;
            }).sort((a, b) => a.order - b.order),
            updatedAt: now(),
          };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    // ── Notebooks ──
    createNotebook: (name, parentId = null, icon = '📓') => {
      const siblingCount = get().notebooks.filter(nb => nb.parentId === parentId && !nb.trashed).length;
      const nb: Notebook = {
        id: uuid(),
        name,
        parentId,
        color: 'default',
        icon,
        createdAt: now(),
        order: siblingCount,
        sections: [],
      };
      set(s => ({ notebooks: [...s.notebooks, nb] }));
      persist();
      syncNotebookToFirestore(nb.id);
      return nb;
    },

    updateNotebook: (id, updates) => {
      set(s => ({
        notebooks: s.notebooks.map(nb => nb.id === id ? { ...nb, ...updates } : nb)
      }));
      persist();
      syncNotebookToFirestore(id);
    },

    reorderNotebook: (id, parentId, targetIndex) => {
      const state = get();
      const moving = state.notebooks.find(nb => nb.id === id && !nb.trashed);
      if (!moving) return;
      if (moving.id === 'default' && parentId !== null) return;
      if (parentId === id) return;
      if (parentId && !state.notebooks.some(nb => nb.id === parentId && !nb.trashed)) return;

      const childIds = getNotebookTreeIds(id);
      if (parentId && childIds.has(parentId)) return;

      const previous = new Map(state.notebooks.map(nb => [nb.id, { parentId: nb.parentId, order: nb.order }]));
      let changedIds: string[] = [];

      set(s => {
        const oldParentId = moving.parentId;
        const active = s.notebooks.filter(nb => !nb.trashed);
        const oldSiblings = sortNotebooksByOrder(
          active.filter(nb => nb.parentId === oldParentId && nb.id !== id)
        );
        const targetSiblings = sortNotebooksByOrder(
          active.filter(nb => nb.parentId === parentId && nb.id !== id)
        );

        let insertIndex = Math.max(0, Math.min(targetIndex, targetSiblings.length));
        if (oldParentId === parentId) {
          const currentIndex = sortNotebooksByOrder(
            active.filter(nb => nb.parentId === oldParentId)
          ).findIndex(nb => nb.id === id);
          if (currentIndex >= 0 && currentIndex < insertIndex) {
            insertIndex -= 1;
          }
        }

        const targetOrder = [
          ...targetSiblings.slice(0, insertIndex),
          { ...moving, parentId },
          ...targetSiblings.slice(insertIndex),
        ];
        const updates = new Map<string, Partial<Notebook>>();

        targetOrder.forEach((nb, order) => {
          updates.set(nb.id, { parentId, order });
        });

        if (oldParentId !== parentId) {
          oldSiblings.forEach((nb, order) => {
            updates.set(nb.id, { parentId: oldParentId, order });
          });
        }

        const notebooks = s.notebooks.map(nb => {
          const update = updates.get(nb.id);
          return update ? { ...nb, ...update } : nb;
        });

        changedIds = notebooks
          .filter(nb => {
            const before = previous.get(nb.id);
            return before && (before.parentId !== nb.parentId || before.order !== nb.order);
          })
          .map(nb => nb.id);

        return { notebooks };
      });

      if (changedIds.length === 0) return;
      persist();
      changedIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
    },

    deleteNotebook: (id) => {
      if (id === 'default') return;
      const notebookIds = getNotebookTreeIds(id);
      const trashedAt = now();
      const affectedNoteIds = get().notes.filter(n => notebookIds.has(n.notebookId)).map(n => n.id);
      set(s => ({
        notebooks: s.notebooks.map(nb => notebookIds.has(nb.id) ? { ...nb, trashed: true, trashedAt } : nb),
        notes: s.notes.map(n => notebookIds.has(n.notebookId) ? { ...n, trashed: true, trashedAt, pinned: false } : n),
        selectedNotebookId: notebookIds.has(s.selectedNotebookId || '') ? null : s.selectedNotebookId,
        selectedNoteId: affectedNoteIds.includes(s.selectedNoteId || '') ? null : s.selectedNoteId,
        editingNote: affectedNoteIds.includes(s.selectedNoteId || '') ? false : s.editingNote,
      }));
      persist();
      notebookIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
      affectedNoteIds.forEach(noteId => syncNoteToFirestore(noteId));
    },

    restoreNotebook: (id) => {
      const notebookIds = getNotebookTreeIds(id);
      const affectedNoteIds = get().notes.filter(n => notebookIds.has(n.notebookId) && n.trashed).map(n => n.id);
      set(s => {
        const notebooks = s.notebooks.map(nb => notebookIds.has(nb.id) ? { ...nb, trashed: false, trashedAt: undefined } : nb);
        const notes = s.notes.map(n => notebookIds.has(n.notebookId) ? { ...n, trashed: false, trashedAt: undefined } : n);
        return { notebooks, notes, tags: rebuildTags(notes) };
      });
      persist();
      notebookIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
      affectedNoteIds.forEach(noteId => syncNoteToFirestore(noteId));
    },

    permanentlyDeleteNotebook: (id) => {
      const notebookIds = getNotebookTreeIds(id);
      const affectedNoteIds = get().notes.filter(n => notebookIds.has(n.notebookId)).map(n => n.id);
      set(s => {
        const notes = s.notes.filter(n => !notebookIds.has(n.notebookId));
        return {
          notebooks: s.notebooks.filter(nb => !notebookIds.has(nb.id)),
          notes,
          tags: rebuildTags(notes),
          selectedNotebookId: notebookIds.has(s.selectedNotebookId || '') ? null : s.selectedNotebookId,
          selectedNoteId: affectedNoteIds.includes(s.selectedNoteId || '') ? null : s.selectedNoteId,
          editingNote: affectedNoteIds.includes(s.selectedNoteId || '') ? false : s.editingNote,
        };
      });
      persist();
      notebookIds.forEach(notebookId => deleteNotebookFromFirestore(notebookId));
      affectedNoteIds.forEach(noteId => deleteNoteFromFirestore(noteId));
    },

    addSection: (notebookId, name) => {
      const section: Section = {
        id: uuid(),
        name,
        notebookId,
        order: 0,
        color: 'default',
      };
      set(s => ({
        notebooks: s.notebooks.map(nb => {
          if (nb.id !== notebookId) return nb;
          const sections = [...(nb.sections || []), { ...section, order: (nb.sections || []).length }];
          return { ...nb, sections };
        })
      }));
      persist();
      syncNotebookToFirestore(notebookId);
      return section;
    },

    updateSection: (notebookId, sectionId, updates) => {
      set(s => ({
        notebooks: s.notebooks.map(nb => {
          if (nb.id !== notebookId) return nb;
          return {
            ...nb,
            sections: (nb.sections || []).map(sec =>
              sec.id === sectionId ? { ...sec, ...updates } : sec
            ),
          };
        })
      }));
      persist();
      syncNotebookToFirestore(notebookId);
    },

    deleteSection: (notebookId, sectionId) => {
      const affectedNoteIds = get().notes.filter(n => n.sectionId === sectionId).map(n => n.id);
      set(s => ({
        notebooks: s.notebooks.map(nb => {
          if (nb.id !== notebookId) return nb;
          return { ...nb, sections: (nb.sections || []).filter(sec => sec.id !== sectionId) };
        }),
        notes: s.notes.map(n =>
          n.sectionId === sectionId ? { ...n, sectionId: undefined } : n
        ),
      }));
      persist();
      syncNotebookToFirestore(notebookId);
      affectedNoteIds.forEach(noteId => syncNoteToFirestore(noteId));
    },

    // ── Tags ──
    createTag: (name, color = 'default') => {
      const tag: Tag = { id: name.toLowerCase().replace(/\s+/g, '-'), name, color, count: 0 };
      set(s => {
        if (s.tags.find(t => t.name.toLowerCase() === name.toLowerCase())) return s;
        return { tags: [...s.tags, tag] };
      });
      return { id: name.toLowerCase().replace(/\s+/g, '-'), name, color, count: 0 };
    },

    deleteTag: (id) => {
      const tag = get().tags.find(t => t.id === id);
      if (!tag) return;
      set(s => ({
        tags: s.tags.filter(t => t.id !== id),
        notes: s.notes.map(n => ({
          ...n,
          tags: n.tags.filter(t => t !== tag.name),
        })),
      }));
      persist();
    },

    renameTag: (id, name) => {
      const oldTag = get().tags.find(t => t.id === id);
      if (!oldTag) return;
      set(s => ({
        tags: s.tags.map(t => t.id === id ? { ...t, name, id: name.toLowerCase().replace(/\s+/g, '-') } : t),
        notes: s.notes.map(n => ({
          ...n,
          tags: n.tags.map(t => t === oldTag.name ? name : t),
        })),
      }));
      persist();
    },

    // ── Search & Navigation ──
    saveCurrentSearch: (name) => {
      const saved: SavedSearch = {
        id: uuid(),
        name: name.trim() || 'Saved search',
        filters: { ...get().searchFilters },
        createdAt: now(),
      };
      set(s => ({ savedSearches: [saved, ...s.savedSearches] }));
      persist();
      return saved;
    },
    applySavedSearch: (id) => {
      const saved = get().savedSearches.find(item => item.id === id);
      if (!saved) return;
      set({ searchFilters: { ...saved.filters }, currentView: 'search', selectedNoteId: null, editingNote: false });
    },
    deleteSavedSearch: (id) => {
      set(s => ({ savedSearches: s.savedSearches.filter(item => item.id !== id) }));
      persist();
    },
    setSearchFilters: (filters) => {
      set(s => ({ searchFilters: { ...s.searchFilters, ...filters } }));
    },
    clearSearch: () => set({ searchFilters: defaultSearchFilters }),
    setCurrentView: (view) => set({ currentView: view, selectedNoteId: null, editingNote: false }),
    selectNote: (id) => set({ selectedNoteId: id, editingNote: !!id }),
    selectNotebook: (id) => set({ selectedNotebookId: id }),
    selectTag: (id) => set({ selectedTagId: id }),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setEditingNote: (editing) => set({ editingNote: editing }),

    // ── Scratch Pad ──
    updateScratchPad: (content) => {
      set({ scratchPad: content });
      persist();
    },

    // ── Templates ──
    createFromTemplate: (templateId) => {
      const template = get().templates.find(t => t.id === templateId);
      if (!template) return Promise.resolve(null);
      return get().createNote({
        title: template.name,
        content: template.content,
        type: template.type,
        theme: template.theme || get().settings.defaultNoteTheme,
        tags: [...template.tags],
        checklist: template.checklist.map(c => ({ ...c, id: uuid() })),
      });
    },

    createTeamSpace: (name, notebookIds = []) => {
      const { uid, profile } = get();
      const trimmed = name.trim() || 'Team Space';
      const teamSpace: TeamSpace = {
        id: uuid(),
        name: trimmed,
        icon: '\uD83C\uDFE2',
        color: 'blue',
        pinned: true,
        notebookIds,
        members: [],
        ownerId: uid || undefined,
        createdAt: now(),
        updatedAt: now(),
      };

      set(s => ({ teamSpaces: [teamSpace, ...s.teamSpaces] }));
      persist();
      syncTeamSpaceToFirestore(teamSpace.id);

      notebookIds.forEach(notebookId => {
        const notebook = get().notebooks.find(nb => nb.id === notebookId);
        if (notebook) {
          get().updateNotebook(notebookId, { teamSpaceId: teamSpace.id });
        }
      });

      void get().addActivity({
        entityType: 'team-space',
        entityId: teamSpace.id,
        teamSpaceId: teamSpace.id,
        action: 'team-space-created',
        message: `Created team space ${trimmed}.`,
        participants: [profile.email],
      });

      return teamSpace;
    },

    updateTeamSpace: (id, updates) => {
      set(s => ({
        teamSpaces: s.teamSpaces.map(space =>
          space.id === id ? { ...space, ...updates, updatedAt: now() } : space
        ),
      }));
      persist();
      syncTeamSpaceToFirestore(id);
    },

    deleteTeamSpace: (id) => {
      const affectedNotebookIds = get().notebooks
        .filter(nb => nb.teamSpaceId === id)
        .map(nb => nb.id);
      set(s => ({
        teamSpaces: s.teamSpaces.filter(space => space.id !== id),
        notebooks: s.notebooks.map(nb => nb.teamSpaceId === id ? { ...nb, teamSpaceId: null } : nb),
      }));
      persist();
      deleteTeamSpaceFromFirestore(id);
      affectedNotebookIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
    },

    addActivity: async (item) => {
      const { uid, profile } = get();
      const participants = [...new Set(item.participants.map(normalizeEmail).filter(Boolean))];
      const activity: ActivityItem = {
        ...item,
        id: uuid(),
        actorEmail: normalizeEmail(item.actorEmail || profile.email || 'local'),
        actorName: item.actorName || profile.name,
        participants,
        createdAt: now(),
      };

      set(s => ({
        activityItems: [activity, ...s.activityItems.filter(existing => existing.id !== activity.id)].slice(0, 200),
      }));
      persist();

      if (uid && item.shared && participants.length > 1) {
        await setDoc(doc(db, 'activity_feed', activity.id), stripUndefined(activity)).catch(console.error);
      }

      return activity;
    },

    shareNote: async (noteId, sharedWith, isPublished, shareAccess) => {
      const { notes, uid, profile } = get();
      const note = notes.find(n => n.id === noteId);
      if (!note || !uid) return;

      const access = normalizeShareAccess(shareAccess || legacyEmailsToShareAccess(sharedWith, note.shareAccess));
      const roleArrays = shareAccessToRoleArrays(access);
      const isSharedOrPublished = roleArrays.sharedWith.length > 0 || isPublished;
      const sharedBy = note.sharedBy || profile.email || 'Anonymous';
      const updatedNote: Note = {
        ...note,
        ownerId: note.ownerId || uid,
        ...roleArrays,
        shareAccess: access,
        isPublished,
        isShared: isSharedOrPublished,
        sharedBy,
      };

      set(s => ({
        notes: s.notes.map(n => n.id === noteId ? updatedNote : n)
      }));
      persist();

      if (isSharedOrPublished) {
        await setDoc(doc(db, 'shared_notes', noteId), stripUndefined(updatedNote));
      } else {
        if (note.isShared) {
          await deleteDoc(doc(db, 'shared_notes', noteId));
        }
      }
      await setDoc(doc(db, `users/${uid}/notes`, noteId), stripUndefined(updatedNote));

      await get().addActivity({
        entityType: 'note',
        entityId: noteId,
        noteId,
        action: 'share-updated',
        message: isSharedOrPublished
          ? `Updated sharing for ${note.title || 'Untitled note'}.`
          : `Stopped sharing ${note.title || 'Untitled note'}.`,
        participants: getEntityParticipants(updatedNote, sharedBy),
        shared: isSharedOrPublished,
      });
    },

    shareNotebook: async (notebookId, sharedWith, shareAccess) => {
      const { notebooks, uid, profile } = get();
      const notebook = notebooks.find(nb => nb.id === notebookId);
      if (!notebook || !uid) return;

      const access = normalizeShareAccess(shareAccess || legacyEmailsToShareAccess(sharedWith, notebook.shareAccess));
      const roleArrays = shareAccessToRoleArrays(access);
      const isShared = roleArrays.sharedWith.length > 0;
      const sharedBy = notebook.sharedBy || profile.email || 'Anonymous';
      const updatedNotebook: Notebook = {
        ...notebook,
        ownerId: notebook.ownerId || uid,
        ...roleArrays,
        shareAccess: access,
        isShared,
        sharedBy,
      };

      set(s => ({
        notebooks: s.notebooks.map(nb => nb.id === notebookId ? updatedNotebook : nb)
      }));
      persist();

      if (isShared) {
        await setDoc(doc(db, 'shared_notebooks', notebookId), stripUndefined(updatedNotebook));
      } else {
        if (notebook.isShared) {
          await deleteDoc(doc(db, 'shared_notebooks', notebookId));
        }
      }
      await setDoc(doc(db, `users/${uid}/notebooks`, notebookId), stripUndefined(updatedNotebook));

      await get().addActivity({
        entityType: 'notebook',
        entityId: notebookId,
        notebookId,
        teamSpaceId: notebook.teamSpaceId || undefined,
        action: 'share-updated',
        message: isShared
          ? `Updated sharing for notebook ${notebook.name}.`
          : `Stopped sharing notebook ${notebook.name}.`,
        participants: getEntityParticipants(updatedNotebook, sharedBy),
        shared: isShared,
      });
    },

    // ── Export/Import ──
    exportAllNotes: () => {
      const { notes, notebooks, teamSpaces, activityItems, notifications, profile } = get();
      return JSON.stringify({ notes, notebooks, teamSpaces, activityItems, notifications, profile, exportedAt: now() }, null, 2);
    },

    importNotes: (json) => {
      try {
        const data = JSON.parse(json);
        if (data.notes && Array.isArray(data.notes)) {
          let importedNotes: Note[] = [];
          set(s => {
            const existingIds = new Set(s.notes.map(n => n.id));
            const newNotes = data.notes.filter((n: Note) => !existingIds.has(n.id));
            importedNotes = newNotes;
            const notes = [...s.notes, ...newNotes];
            const importedTeamSpaces = Array.isArray(data.teamSpaces)
              ? data.teamSpaces.filter((space: TeamSpace) => !s.teamSpaces.some(existing => existing.id === space.id))
              : [];
            const importedActivity = Array.isArray(data.activityItems)
              ? data.activityItems.filter((item: ActivityItem) => !s.activityItems.some(existing => existing.id === item.id))
              : [];
            const importedNotifications = Array.isArray(data.notifications)
              ? data.notifications.filter((item: AppNotification) => !s.notifications.some(existing => existing.id === item.id))
              : [];
            return {
              notes,
              tags: rebuildTags(notes),
              teamSpaces: [...s.teamSpaces, ...importedTeamSpaces],
              activityItems: [...importedActivity, ...s.activityItems].slice(0, 200),
              notifications: capNotifications([...importedNotifications, ...s.notifications]),
            };
          });
          if (data.notebooks && Array.isArray(data.notebooks)) {
            set(s => {
              const existingIds = new Set(s.notebooks.map(nb => nb.id));
              const newNbs = data.notebooks.filter((nb: Notebook) => !existingIds.has(nb.id));
              return { notebooks: [...s.notebooks, ...newNbs] };
            });
          }
          persist();
          importedNotes.forEach(note => syncNoteToFirestore(note.id));
          if (Array.isArray(data.teamSpaces)) {
            data.teamSpaces.forEach((space: TeamSpace) => syncTeamSpaceToFirestore(space.id));
          }
          if (Array.isArray(data.notifications)) {
            data.notifications.forEach((notification: AppNotification) => syncNotificationToFirestore(notification.id));
          }
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    resetApp: async () => {
      const {
        notes,
        uid,
        unsubscribeNotes,
        unsubscribeNotebooks,
        unsubscribeSettings,
        unsubscribeTeamSpaces,
        unsubscribeActivity,
        unsubscribeNotifications,
        unsubscribeSharedNotes,
        unsubscribeSharedNotebooks,
      } = get();
      if (unsubscribeNotes) unsubscribeNotes();
      if (unsubscribeNotebooks) unsubscribeNotebooks();
      if (unsubscribeSettings) unsubscribeSettings();
      if (unsubscribeTeamSpaces) unsubscribeTeamSpaces();
      if (unsubscribeActivity) unsubscribeActivity();
      if (unsubscribeNotifications) unsubscribeNotifications();
      if (unsubscribeSharedNotes) unsubscribeSharedNotes();
      if (unsubscribeSharedNotebooks) unsubscribeSharedNotebooks();
      if (uid) {
        await Promise.all(notes.map(note =>
          deleteDoc(doc(db, `users/${uid}/notes`, note.id)).catch(console.error)
        ));
        await signOut(auth).catch(console.error);
      }
      localStorage.removeItem('ntk-notes');
      localStorage.removeItem('ntk-notebooks');
      localStorage.removeItem('ntk-profile');
      localStorage.removeItem('ntk-settings');
      localStorage.removeItem('ntk-onboarded');
      localStorage.removeItem('ntk-scratchpad');
      localStorage.removeItem('ntk-saved-searches');
      localStorage.removeItem('ntk-team-spaces');
      localStorage.removeItem('ntk-activity-items');
      localStorage.removeItem('ntk-notifications');
      localStorage.removeItem('ntk-sync-queue');
      localStorage.removeItem('ntk-sync-conflicts');
      set({
        notes: [],
        notebooks: [defaultNotebook],
        tags: [],
        teamSpaces: [],
        activityItems: [],
        notifications: [],
        profile: defaultProfile,
        settings: defaultSettings,
        isOnboarded: false,
        uid: null,
        unsubscribeNotes: null,
        unsubscribeNotebooks: null,
        unsubscribeSettings: null,
        unsubscribeTeamSpaces: null,
        unsubscribeActivity: null,
        unsubscribeNotifications: null,
        unsubscribeSharedNotes: null,
        unsubscribeSharedNotebooks: null,
        currentView: 'home',
        selectedNoteId: null,
        editingNote: false,
        searchFilters: defaultSearchFilters,
        scratchPad: '',
        savedSearches: [],
        syncQueue: [],
        syncConflicts: [],
        unlockedNotes: {},
      });
    },

    // ── Computed ──
    getFilteredNotes: () => {
      const { notes, searchFilters, currentView, selectedNotebookId, selectedTagId } = get();
      let filtered = notes.filter(n => !n.trashed && !n.archived);
      if (currentView === 'shared') {
        filtered = filtered.filter(n => n.isShared);
      } else {
        filtered = filtered.filter(n => !n.isShared);
      }

      if (currentView === 'trash') filtered = notes.filter(n => n.trashed);
      else if (currentView === 'archived') filtered = notes.filter(n => n.archived && !n.trashed);
      else if (currentView === 'starred') filtered = notes.filter(n => n.starred && !n.trashed && !n.archived);
      else if (currentView === 'reminders') filtered = notes.filter(n => n.reminder && !n.trashed);
      else if (currentView === 'notebooks' && selectedNotebookId) {
        filtered = filtered.filter(n => n.notebookId === selectedNotebookId);
      }
      else if (currentView === 'tags' && selectedTagId) {
        const tag = get().tags.find(t => t.id === selectedTagId);
        if (tag) filtered = filtered.filter(n => n.tags.includes(tag.name));
      }

      const { query, tags, colors, types, priorities, hasReminder, hasChecklist, sortBy, sortDir, sharedBy } = searchFilters;
      
      if (query) {
        const q = query.toLowerCase();
        filtered = filtered.filter(n =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some(t => t.toLowerCase().includes(q))
        );
      }
      if (tags.length) filtered = filtered.filter(n => tags.some(t => n.tags.includes(t)));
      if (colors.length) filtered = filtered.filter(n => colors.includes(n.color));
      if (types.length) filtered = filtered.filter(n => types.includes(n.type));
      if (priorities.length) filtered = filtered.filter(n => n.priority && priorities.includes(n.priority));
      if (hasReminder === true) filtered = filtered.filter(n => n.reminder);
      if (hasReminder === false) filtered = filtered.filter(n => !n.reminder);
      if (hasChecklist === true) filtered = filtered.filter(n => n.type === 'checklist' || n.checklist.length > 0);
      if (sharedBy && sharedBy.length) filtered = filtered.filter(n => n.sharedBy && sharedBy.includes(n.sharedBy));

      filtered.sort((a, b) => {
        // Pinned always first
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        
        let cmp = 0;
        if (sortBy === 'order') cmp = (a.order ?? 0) - (b.order ?? 0);
        else if (sortBy === 'title') cmp = (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
        else if (sortBy === 'priority') {
          const pOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          const aP = a.priority ? pOrder[a.priority] : 0;
          const bP = b.priority ? pOrder[b.priority] : 0;
          cmp = aP - bP;
        }
        else if (sortBy === 'wordCount') cmp = (a.wordCount ?? 0) - (b.wordCount ?? 0);
        else cmp = new Date(a[sortBy]).getTime() - new Date(b[sortBy]).getTime();
        
        return sortDir === 'desc' ? -cmp : cmp;
      });

      return filtered;
    },

    getRecentNotes: (limit = 5) => {
      return get().notes
        .filter(n => !n.trashed && !n.archived)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
    },

    getPinnedNotes: () => get().notes.filter(n => n.pinned && !n.trashed && !n.archived),
    getStarredNotes: () => get().notes.filter(n => n.starred && !n.trashed && !n.archived),
    getArchivedNotes: () => get().notes.filter(n => n.archived && !n.trashed),
    getTrashedNotes: () => get().notes.filter(n => n.trashed),
    getNotesByNotebook: (notebookId) => get().notes.filter(n => n.notebookId === notebookId && !n.trashed),
    getNotesByTag: (tag) => get().notes.filter(n => n.tags.includes(tag) && !n.trashed),
    getNoteById: (id) => get().notes.find(n => n.id === id),
    getNotebookById: (id) => get().notebooks.find(nb => nb.id === id),
    getChildNotebooks: (parentId) => sortNotebooksByOrder(get().notebooks.filter(nb => nb.parentId === parentId)),

    getAllTags: () => get().tags,

    getStats: () => {
      const notes = get().notes.filter(n => !n.trashed);
      const allChecklist = notes.flatMap(n => n.checklist);
      return {
        notes: notes.filter(n => !n.archived).length,
        words: notes.reduce((sum, n) => sum + n.wordCount, 0),
        tags: get().tags.length,
        notebooks: get().notebooks.length,
        tasks: allChecklist.length,
        completedTasks: allChecklist.filter(c => c.checked).length,
      };
    },

    getReminders: () => {
      return get().notes
        .filter(n => n.reminder && !n.trashed)
        .map(n => n.reminder!)
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    },
  };
});
