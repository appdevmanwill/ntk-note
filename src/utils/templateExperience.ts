import type { ChecklistItem, NoteTemplate, NoteType } from '@/types';

export type TemplateCategory =
  | 'Quick start'
  | 'Meetings'
  | 'Planning'
  | 'Work'
  | 'Career'
  | 'Personal'
  | 'Study'
  | 'Content'
  | 'Finance'
  | 'Home & travel'
  | 'Technical';

export interface TemplateExperience {
  category: TemplateCategory;
  icon: string;
  friendlyDescription: string;
  titlePlaceholder: string;
  bestFor: string;
}

export interface TemplateDraft {
  title: string;
  content: string;
  type: NoteType;
  checklist: ChecklistItem[];
}

export type TemplateSetupInputType = 'text' | 'email' | 'tel' | 'date' | 'textarea';

export interface TemplateSetupField {
  key: string;
  label: string;
  placeholder: string;
  type?: TemplateSetupInputType;
  required?: boolean;
  profileValue?: 'name' | 'email';
  helper?: string;
}

export type TemplatePersonalizationValues = Record<string, string>;

const EXPERIENCE: Record<string, Partial<TemplateExperience>> = {
  'tpl-meeting': { category: 'Meetings', icon: '🤝', friendlyDescription: 'Keep the conversation, decisions, and next steps together.', titlePlaceholder: 'e.g. Weekly team meeting', bestFor: 'Team meetings, client calls, catch-ups' },
  'tpl-journal': { category: 'Personal', icon: '📔', friendlyDescription: 'A gentle place to reflect on your day and plan tomorrow.', titlePlaceholder: 'e.g. Today’s journal', bestFor: 'Reflection, gratitude, personal notes' },
  'tpl-project': { category: 'Planning', icon: '🚀', friendlyDescription: 'Turn an idea into a clear goal, milestones, and next actions.', titlePlaceholder: 'e.g. Website redesign', bestFor: 'Projects, launches, personal goals' },
  'tpl-todo': { category: 'Quick start', icon: '✅', friendlyDescription: 'Start with a clean checklist and add tasks as you go.', titlePlaceholder: 'e.g. Things to do today', bestFor: 'Errands, work tasks, quick lists' },
  'tpl-weekly': { category: 'Planning', icon: '📅', friendlyDescription: 'Look back at the week, learn from it, and choose what matters next.', titlePlaceholder: 'e.g. Weekly review', bestFor: 'Weekly planning and reflection' },
  'tpl-brainstorm': { category: 'Quick start', icon: '💡', friendlyDescription: 'Capture ideas freely, then turn the strongest ones into next steps.', titlePlaceholder: 'e.g. Ideas for the new website', bestFor: 'Ideas, problem solving, creative thinking' },
  'tpl-cv': { category: 'Career', icon: '📄', friendlyDescription: 'Start with a polished professional CV, then replace the sample details with your real experience.', titlePlaceholder: 'e.g. Ada Okafor — CV', bestFor: 'Job applications, career updates, professional profiles' },
  'tpl-cover-letter': { category: 'Career', icon: '✉️', friendlyDescription: 'Start with a professional cover letter that is already structured and easy to personalize.', titlePlaceholder: 'e.g. Product Designer — Cover Letter', bestFor: 'Job applications and introductions' },
  'tpl-executive-brief': { category: 'Work', icon: '📌', titlePlaceholder: 'e.g. August operations update', bestFor: 'Leadership updates and decisions' },
  'tpl-product-requirements': { category: 'Work', icon: '🧩', titlePlaceholder: 'e.g. Offline mode requirements', bestFor: 'Product and feature planning' },
  'tpl-sprint-plan': { category: 'Planning', icon: '🏃', titlePlaceholder: 'e.g. Sprint 12 plan', bestFor: 'Short delivery cycles and team planning' },
  'tpl-client-crm': { category: 'Work', icon: '👤', titlePlaceholder: 'e.g. Blossom Events', bestFor: 'Client relationships and follow-ups' },
  'tpl-research-brief': { category: 'Study', icon: '🔎', titlePlaceholder: 'e.g. Market research — Lagos events', bestFor: 'Research, evidence, and synthesis' },
  'tpl-content-calendar': { category: 'Content', icon: '🗓️', titlePlaceholder: 'e.g. September content plan', bestFor: 'Publishing and campaign planning' },
  'tpl-meeting-decision-log': { category: 'Meetings', icon: '⚖️', titlePlaceholder: 'e.g. Product decisions', bestFor: 'Important decisions and rationale' },
  'tpl-goal-system': { category: 'Planning', icon: '🎯', titlePlaceholder: 'e.g. Grow monthly sales', bestFor: 'Goals, habits, and progress reviews' },
  'tpl-study-notes': { category: 'Study', icon: '🎓', titlePlaceholder: 'e.g. Network security — Week 2', bestFor: 'Classes, courses, and revision' },
  'tpl-book-notes': { category: 'Study', icon: '📚', titlePlaceholder: 'e.g. Atomic Habits notes', bestFor: 'Books, articles, and reading notes' },
  'tpl-habit-tracker': { category: 'Personal', icon: '🌱', titlePlaceholder: 'e.g. Healthy habits — this week', bestFor: 'Simple routines and reflection' },
  'tpl-budget-review': { category: 'Finance', icon: '💰', titlePlaceholder: 'e.g. August budget review', bestFor: 'Monthly money check-ins' },
  'tpl-wellness-log': { category: 'Personal', icon: '🌿', titlePlaceholder: 'e.g. Today’s wellness check-in', bestFor: 'Energy, mood, and personal wellbeing' },
  'tpl-travel-plan': { category: 'Home & travel', icon: '✈️', titlePlaceholder: 'e.g. Lagos to London trip', bestFor: 'Trips, bookings, and packing' },
  'tpl-investor-update': { category: 'Work', icon: '📈', titlePlaceholder: 'e.g. August investor update', bestFor: 'Stakeholder progress updates' },
  'tpl-board-meeting': { category: 'Meetings', icon: '🏛️', titlePlaceholder: 'e.g. Q3 board meeting', bestFor: 'Formal meetings and resolutions' },
  'tpl-sales-call': { category: 'Work', icon: '☎️', titlePlaceholder: 'e.g. Discovery call — Client name', bestFor: 'Sales discovery and follow-up' },
  'tpl-customer-support': { category: 'Work', icon: '🛟', titlePlaceholder: 'e.g. Login issue — Customer name', bestFor: 'Customer issues and resolutions' },
  'tpl-launch-plan': { category: 'Planning', icon: '📣', titlePlaceholder: 'e.g. Product launch — October', bestFor: 'Launches and go-to-market work' },
  'tpl-marketing-campaign': { category: 'Content', icon: '📢', titlePlaceholder: 'e.g. Holiday campaign', bestFor: 'Campaign strategy and execution' },
  'tpl-brand-voice': { category: 'Content', icon: '🗣️', titlePlaceholder: 'e.g. NTK brand voice', bestFor: 'Brand language and messaging' },
  'tpl-interview-notes': { category: 'Work', icon: '🧑‍💼', titlePlaceholder: 'e.g. Interview — Candidate name', bestFor: 'Hiring interviews and decisions' },
  'tpl-onboarding-plan': { category: 'Planning', icon: '👋', titlePlaceholder: 'e.g. New team member onboarding', bestFor: 'New hires, clients, or project members' },
  'tpl-retrospective': { category: 'Meetings', icon: '🔄', titlePlaceholder: 'e.g. August team retrospective', bestFor: 'Team learning and improvement' },
  'tpl-incident-report': { category: 'Technical', icon: '🚨', titlePlaceholder: 'e.g. Login outage — Aug 29', bestFor: 'Operational incidents and follow-up' },
  'tpl-postmortem': { category: 'Technical', icon: '🧯', titlePlaceholder: 'e.g. Payment outage postmortem', bestFor: 'Learning from failures without blame' },
  'tpl-api-design': { category: 'Technical', icon: '🔌', titlePlaceholder: 'e.g. Notes sharing API', bestFor: 'Technical interface planning' },
  'tpl-writing-brief': { category: 'Content', icon: '✍️', titlePlaceholder: 'e.g. Article — Working title', bestFor: 'Articles, essays, and long-form writing' },
  'tpl-podcast-episode': { category: 'Content', icon: '🎙️', titlePlaceholder: 'e.g. Episode 12 — Working title', bestFor: 'Podcast planning and production' },
  'tpl-course-lesson': { category: 'Study', icon: '🧑‍🏫', titlePlaceholder: 'e.g. Lesson 4 — Network basics', bestFor: 'Teaching and lesson planning' },
  'tpl-legal-review': { category: 'Work', icon: '📄', titlePlaceholder: 'e.g. Service agreement review', bestFor: 'Contract and policy review notes' },
  'tpl-real-estate-tour': { category: 'Home & travel', icon: '🏠', titlePlaceholder: 'e.g. Lekki property shortlist', bestFor: 'Property comparison and follow-up' },
  'tpl-event-plan': { category: 'Planning', icon: '🎉', titlePlaceholder: 'e.g. Company end-of-year event', bestFor: 'Events, vendors, guests, and schedules' },
  'tpl-family-command-center': { category: 'Home & travel', icon: '🏡', titlePlaceholder: 'e.g. Family plan — this week', bestFor: 'Appointments, meals, errands, and home notes' },
};

const CATEGORY_DEFAULTS: Record<TemplateCategory, { icon: string; bestFor: string }> = {
  'Quick start': { icon: '✨', bestFor: 'Getting started quickly' },
  Meetings: { icon: '🤝', bestFor: 'Meetings and decisions' },
  Planning: { icon: '🗺️', bestFor: 'Planning and organization' },
  Work: { icon: '💼', bestFor: 'Professional notes and follow-up' },
  Career: { icon: '📄', bestFor: 'CVs, applications, and career documents' },
  Personal: { icon: '🌿', bestFor: 'Personal notes and reflection' },
  Study: { icon: '🎓', bestFor: 'Learning and research' },
  Content: { icon: '✍️', bestFor: 'Writing and publishing' },
  Finance: { icon: '💰', bestFor: 'Money planning and review' },
  'Home & travel': { icon: '🏡', bestFor: 'Home, family, and travel' },
  Technical: { icon: '🧰', bestFor: 'Technical planning and incident notes' },
};

const CATEGORY_BY_TAG: Array<[TemplateCategory, string[]]> = [
  ['Meetings', ['meeting', 'interview', 'retro', 'decision']],
  ['Planning', ['planning', 'project', 'goals', 'launch', 'onboarding']],
  ['Personal', ['personal', 'journal', 'wellness', 'habits', 'routine']],
  ['Study', ['study', 'learning', 'research', 'book', 'education']],
  ['Content', ['content', 'writing', 'podcast', 'marketing', 'brand', 'editorial']],
  ['Finance', ['finance', 'budget']],
  ['Home & travel', ['travel', 'family', 'home', 'property', 'event']],
  ['Technical', ['engineering', 'api', 'incident', 'postmortem', 'ops']],
  ['Career', ['career', 'cv', 'resume', 'job', 'application']],
  ['Work', ['brief', 'leadership', 'client', 'crm', 'sales', 'support', 'customer', 'legal', 'hiring']],
];

const SETUP_FIELDS: Record<string, TemplateSetupField[]> = {
  'tpl-cv': [
    { key: 'fullName', label: 'Your full name', placeholder: 'e.g. Ada Okafor', required: true, profileValue: 'name' },
    { key: 'targetRole', label: 'Role you want', placeholder: 'e.g. Operations Manager', required: true, helper: 'This becomes the professional headline at the top of the CV.' },
    { key: 'email', label: 'Email', placeholder: 'you@example.com', type: 'email', profileValue: 'email' },
    { key: 'phone', label: 'Phone', placeholder: 'e.g. +234 800 000 0000', type: 'tel' },
    { key: 'location', label: 'Location', placeholder: 'e.g. Lagos, Nigeria' },
    { key: 'yearsExperience', label: 'Years of experience', placeholder: 'e.g. 6' },
  ],
  'tpl-cover-letter': [
    { key: 'fullName', label: 'Your full name', placeholder: 'e.g. Ada Okafor', required: true, profileValue: 'name' },
    { key: 'email', label: 'Email', placeholder: 'you@example.com', type: 'email', profileValue: 'email' },
    { key: 'jobTitle', label: 'Job title', placeholder: 'e.g. Operations Manager', required: true },
    { key: 'companyName', label: 'Company', placeholder: 'e.g. Example Company' },
    { key: 'strength', label: 'Your strongest selling point', placeholder: 'e.g. improving operations and leading cross-functional teams', type: 'textarea' },
  ],
  'tpl-meeting': [
    { key: 'meetingTopic', label: 'Meeting topic', placeholder: 'e.g. Website launch planning' },
    { key: 'attendees', label: 'Who is attending?', placeholder: 'e.g. Ada, Tunde, Chika' },
  ],
  'tpl-project': [
    { key: 'projectGoal', label: 'What are you trying to achieve?', placeholder: 'e.g. Launch a simple new website for customers', type: 'textarea' },
    { key: 'deadline', label: 'Target date', placeholder: '', type: 'date' },
  ],
  'tpl-travel-plan': [
    { key: 'destination', label: 'Destination', placeholder: 'e.g. London, United Kingdom' },
    { key: 'travelDates', label: 'Travel dates', placeholder: 'e.g. 12–19 October' },
  ],
  'tpl-budget-review': [
    { key: 'income', label: 'Expected income', placeholder: 'e.g. ₦500,000' },
    { key: 'savingsGoal', label: 'Savings goal', placeholder: 'e.g. ₦100,000' },
  ],
};

export function getTemplateSetupFields(template: NoteTemplate): TemplateSetupField[] {
  return SETUP_FIELDS[template.id] || [];
}

export function getTemplateSetupDefaults(
  template: NoteTemplate,
  profile?: { name?: string; email?: string },
): TemplatePersonalizationValues {
  return getTemplateSetupFields(template).reduce<TemplatePersonalizationValues>((values, field) => {
    values[field.key] = '';
    if (field.profileValue === 'name' && profile?.name && profile.name !== 'User') values[field.key] = profile.name;
    if (field.profileValue === 'email' && profile?.email) values[field.key] = profile.email;
    return values;
  }, {});
}

const GUIDE_BY_HEADING: Record<string, string> = {
  overview: 'In a few lines, explain what this is about and why it matters.',
  context: 'What does someone need to know before reading the rest?',
  goal: 'What result are you trying to achieve?',
  goals: 'What results would make this successful?',
  outcome: 'Describe the result you want to reach.',
  objective: 'What is the main purpose?',
  'event goal': 'What should this event achieve for the people attending?',
  'campaign goal': 'What should this campaign change or achieve?',
  'learning objective': 'What should someone understand or be able to do afterward?',
  agenda: 'Add the topics you want to cover.',
  attendees: 'Who is taking part?',
  discussion: 'Capture the important points in your own words.',
  'discussion points': 'Write the key points as they come up.',
  decisions: 'Record what was agreed and why.',
  'decision needed': 'What decision needs to be made, and by whom?',
  'action items': 'Add the things that need to happen next.',
  'next steps': 'What should happen next? Add an owner or date if useful.',
  'next step': 'What is the clearest next action?',
  milestones: 'Break the work into a few meaningful stages.',
  resources: 'Add useful people, links, files, or tools.',
  notes: 'Add anything else you do not want to forget.',
  highlights: 'What stood out most?',
  'key takeaways': 'Write the few things someone should remember.',
  accomplishments: 'What went well or was completed?',
  challenges: 'What was difficult or slowed progress?',
  risks: 'What could cause problems, and what can you do about it?',
  reflections: 'What did you learn, notice, or want to change?',
  gratitude: 'Write a few things you appreciate today.',
  'today\'s highlights': 'What made today meaningful or important?',
  'ideas & insights': 'Capture new ideas, lessons, or observations.',
  'tomorrow\'s goals': 'Choose a few realistic priorities for tomorrow.',
  'core idea': 'Describe the idea simply. It does not need to be perfect yet.',
  'related ideas': 'Add anything connected, surprising, or worth exploring.',
  'pros & cons': 'What looks promising, and what could be difficult?',
  problem: 'What problem are you trying to solve?',
  'non-goals': 'What is intentionally outside this work?',
  'user stories': 'Describe what a person should be able to do and why.',
  requirements: 'List what must be true for this to work well.',
  'success metrics': 'How will you know this worked?',
  'launch checklist': 'List the checks that must be complete before launch.',
  'sprint goal': 'What should be meaningfully different when this sprint ends?',
  'committed work': 'What work is the team actually committing to?',
  dependencies: 'What are you waiting for from another person, team, or system?',
  'demo plan': 'What will you show at the end?',
  contacts: 'Add the people involved and the best way to reach them.',
  'current needs': 'What does the client or person need right now?',
  'conversation notes': 'Capture important details from the conversation.',
  opportunities: 'What useful next opportunity do you see?',
  'follow-up plan': 'What follow-up is needed, by whom, and when?',
  question: 'What exactly are you trying to understand?',
  sources: 'Add the sources you used and the important finding from each.',
  insights: 'What patterns or conclusions are emerging?',
  'open questions': 'What still needs an answer?',
  summary: 'Explain the most important points in plain language.',
  month: 'Use this section for the month or period you are planning.',
  themes: 'What topics or themes will guide the work?',
  'asset needs': 'What images, documents, audio, video, or approvals are needed?',
  'why it matters': 'Why is this worth doing now?',
  habits: 'Which repeatable actions will help you reach the goal?',
  'weekly review questions': 'What will you check each week to stay on track?',
  topic: 'What are you learning about?',
  'core concepts': 'Explain the main ideas in your own words.',
  examples: 'Add examples that make the ideas easier to remember.',
  'questions to revisit': 'What is still unclear or worth testing yourself on?',
  'five-sentence summary': 'Summarize the topic in five simple sentences.',
  book: 'Add the book title and author.',
  'big idea': 'What is the main idea of the book?',
  'key arguments': 'What important claims does the author make?',
  quotes: 'Save only the short quotes you truly want to remember.',
  'ideas to apply': 'What could you try in real life?',
  'final summary': 'What would you tell someone else about this book?',
  reflection: 'What worked, what did not, and what will you adjust?',
  today: 'How are you doing today?',
  'what helped': 'What supported your energy or mood?',
  'what felt heavy': 'What felt difficult or draining?',
  'one kind next step': 'Choose one manageable thing that could help next.',
  destination: 'Where are you going and for how long?',
  itinerary: 'Plan the important parts of each day.',
  packing: 'Add what you need to bring.',
  'important details': 'Save booking references, addresses, contacts, or other essentials.',
  metrics: 'Add the numbers that show progress.',
  wins: 'What improved or went especially well?',
  asks: 'What help, decision, introduction, or support do you need?',
  'pre-reads': 'Add documents people should review before the meeting.',
  questions: 'What needs discussion or clarification?',
  account: 'Which customer or organization is this about?',
  stakeholders: 'Who is involved in the decision?',
  'pain points': 'What is difficult for the customer today?',
  'current process': 'How are they handling it now?',
  objections: 'What concerns or reasons not to move forward came up?',
  customer: 'Who is affected?',
  issue: 'Describe the problem in the user’s own words.',
  'steps to reproduce': 'Write the simplest steps that show the problem.',
  investigation: 'What did you check and what did you learn?',
  resolution: 'What fixed the problem?',
  audience: 'Who is this for?',
  messaging: 'What should people understand or remember?',
  channels: 'Where will this be shared?',
  timeline: 'Add important dates and events in order.',
  offer: 'What are you asking people to consider or do?',
  'asset list': 'List the materials that need to be created.',
  budget: 'What can be spent and what has already been committed?',
  personality: 'How should the brand feel to people?',
  'tone guidelines': 'Describe how the brand should sound in different situations.',
  'words we use': 'Add words and phrases that fit the brand.',
  'words we avoid': 'Add language that feels wrong or misleading.',
  'proof points': 'What facts support the message?',
  'sample copy': 'Write a few examples in the intended voice.',
  candidate: 'Who are you speaking with?',
  role: 'Which role is this interview for?',
  scorecard: 'Record evidence, not just impressions.',
  'person / team': 'Who is being onboarded?',
  outcomes: 'What should they know or accomplish by the end?',
  'day 1': 'What will make the first day clear and welcoming?',
  'week 1': 'What should happen during the first week?',
  'first 30 days': 'What should be understood or completed in the first month?',
  'what went well': 'What should the team keep doing?',
  'what was hard': 'What created friction or slowed the team down?',
  'what we learned': 'What should change because of what happened?',
  actions: 'Choose a small number of concrete improvements.',
  impact: 'Who or what was affected, and how much?',
  'root cause': 'What underlying condition allowed this to happen?',
  'corrective actions': 'What changes will reduce the chance of this happening again?',
  'what happened': 'Describe the event clearly without blame.',
  detection: 'How did you first notice the problem?',
  response: 'What actions were taken during the incident?',
  'root causes': 'What underlying technical or process causes contributed?',
  'what worked': 'What helped limit the impact or speed recovery?',
  'what changes': 'What will you change after this review?',
  endpoints: 'List the main operations the interface needs to support.',
  'request / response': 'Describe the important inputs and outputs in plain language.',
  errors: 'What can go wrong and how should the caller understand it?',
  security: 'What authentication, authorization, and data protections are required?',
  thesis: 'What central point are you trying to make?',
  outline: 'List the main sections in the order you expect to write them.',
  'draft notes': 'Capture rough wording, examples, and ideas before polishing.',
  'revision checklist': 'What should you verify before publishing?',
  'episode topic': 'What is this episode really about?',
  guest: 'Who is joining and why are they relevant?',
  segments: 'Break the episode into a natural flow.',
  'sponsor / cta': 'Add any sponsor message or call to action.',
  'production notes': 'Record audio, editing, artwork, and publishing details.',
  concept: 'Explain the idea in simple language.',
  example: 'Give a concrete example that makes the lesson clear.',
  exercise: 'What should the learner try for themselves?',
  recap: 'Summarize the lesson in a few clear points.',
  homework: 'What should happen after the lesson?',
  document: 'What document or clause are you reviewing?',
  'business context': 'Why does this review matter to the business?',
  'key clauses': 'Which terms deserve the most attention?',
  property: 'Which property are you looking at?',
  'price / terms': 'Record the price, payment terms, fees, or key conditions.',
  pros: 'What do you like?',
  cons: 'What concerns you?',
  venue: 'Where will it happen and what needs confirmation?',
  'guest list': 'Who needs to be invited or confirmed?',
  'run of show': 'Put the key moments in order.',
  'vendor notes': 'Track suppliers, contacts, agreements, and follow-ups.',
  'week of': 'Use this for the current week or change it as needed.',
  appointments: 'Add important appointments and times.',
  meals: 'Plan meals only as far as it is useful.',
  errands: 'Add errands that need to happen this week.',
};

const EXAMPLE_BY_HEADING: Record<string, string> = {
  overview: 'Example — replace this: We are preparing a simple, mobile-friendly launch that customers can understand quickly.',
  goal: 'Example — replace this: Launch the first usable version by the end of September with the essential features working well.',
  goals: 'Example — replace this: Increase qualified enquiries, reduce manual follow-up, and make the experience easier on mobile.',
  agenda: 'Example — replace this: Progress update, decisions needed, blockers, and next actions.',
  attendees: 'Example — replace this: Ada — Project Lead; Tunde — Design; Chika — Operations.',
  'discussion points': 'Example — replace this: The launch date is achievable if final content is approved this week.',
  decisions: 'Example — replace this: We agreed to launch the core experience first and move optional features to the next update.',
  'action items': 'Example — replace this: Ada to approve final copy by Friday; Tunde to finish mobile screens by Monday.',
  milestones: 'Example — replace this: Planning → Design → Build → Testing → Launch.',
  resources: 'Example — replace this: Project folder, key contact, reference website, budget document.',
  accomplishments: 'Example — replace this: Finished the main user flow and resolved the highest-priority blockers.',
  challenges: 'Example — replace this: Approval took longer than expected and delayed one dependent task.',
  "next week's priorities": 'Example — replace this: Complete testing, resolve feedback, and prepare the release checklist.',
  reflection: 'Example — replace this: Shorter meetings and clearer owners helped us move faster this week.',
  'core idea': 'Example — replace this: Make the experience so simple that a first-time user can succeed without instructions.',
  'related ideas': 'Example — replace this: guided setup, sensible defaults, examples, and an undo option.',
  'next steps': 'Example — replace this: Choose the strongest idea, test it with one real user, then improve it.',
  summary: 'Example — replace this: The project is on track, with one decision needed before the next milestone.',
  audience: 'Example — replace this: Small-business owners who need a clear, mobile-first experience.',
  risks: 'Example — replace this: Late approval could push testing into the launch week.',
  'success metrics': 'Example — replace this: Faster completion time, fewer support questions, and higher task completion.',
  topic: 'Example — replace this: How network security protects everyday systems.',
  'core concepts': 'Example — replace this: authentication, authorization, encryption, and least privilege.',
  'big idea': 'Example — replace this: Small repeated improvements can compound into meaningful long-term change.',
  income: 'Example — replace this: Salary ₦350,000; side income ₦150,000.',
  expenses: 'Example — replace this: Housing, transport, food, utilities, business, and savings.',
  destination: 'Example — replace this: London, United Kingdom — 7 days.',
  itinerary: 'Example — replace this: Day 1 arrival and check-in; Day 2 appointments; Day 3 sightseeing.',
};

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  'Quick start',
  'Meetings',
  'Planning',
  'Work',
  'Career',
  'Personal',
  'Study',
  'Content',
  'Finance',
  'Home & travel',
  'Technical',
];

function fallbackCategory(template: NoteTemplate): TemplateCategory {
  const tags = template.tags.map(tag => tag.toLowerCase());
  for (const [category, candidates] of CATEGORY_BY_TAG) {
    if (candidates.some(candidate => tags.includes(candidate))) return category;
  }
  return 'Work';
}

export function getTemplateExperience(template: NoteTemplate): TemplateExperience {
  const configured = EXPERIENCE[template.id] || {};
  const category = configured.category || fallbackCategory(template);
  const defaults = CATEGORY_DEFAULTS[category];
  return {
    category,
    icon: configured.icon || defaults.icon,
    friendlyDescription: configured.friendlyDescription || template.description,
    titlePlaceholder: configured.titlePlaceholder || `e.g. ${template.name} — ${shortDate(new Date())}`,
    bestFor: configured.bestFor || defaults.bestFor,
  };
}

export function defaultTemplateTitle(template: NoteTemplate, date = new Date()): string {
  const day = shortDate(date);
  const month = date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  switch (template.id) {
    case 'tpl-meeting': return `Meeting — ${day}`;
    case 'tpl-journal': return `Journal — ${day}`;
    case 'tpl-todo': return `To-Do — ${day}`;
    case 'tpl-weekly': return `Weekly Review — ${day}`;
    case 'tpl-brainstorm': return `Ideas — ${day}`;
    case 'tpl-cv': return 'My Professional CV';
    case 'tpl-cover-letter': return 'Cover Letter';
    case 'tpl-budget-review': return `${month} Budget Review`;
    case 'tpl-content-calendar': return `${month} Content Plan`;
    case 'tpl-wellness-log': return `Wellness Check-In — ${day}`;
    case 'tpl-family-command-center': return `Family Plan — ${day}`;
    default: return `${template.name} — ${day}`;
  }
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function longDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function weekLabel(date: Date): string {
  const start = new Date(date);
  start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const startText = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endText = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startText} – ${endText}`;
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function isSeparatorRow(line: string): boolean {
  return /^\|?[\s:-]+(?:\|[\s:-]+)+\|?$/.test(line.trim());
}

function tableHeaders(line: string): string[] {
  return line.split('|').map(item => cleanInlineMarkdown(item)).filter(Boolean);
}

function humanizeMarkdownTable(lines: string[], start: number): { consumed: number; output: string[] } {
  const header = tableHeaders(lines[start]);
  if (header.length < 2 || !isSeparatorRow(lines[start + 1] || '')) {
    return { consumed: 1, output: [cleanInlineMarkdown(lines[start])] };
  }

  const output: string[] = [];
  if (header.length === 2 && header.map(h => h.toLowerCase()).includes('pros') && header.map(h => h.toLowerCase()).includes('cons')) {
    output.push('PROS', '• Add a benefit or opportunity…', '', 'CONS', '• Add a concern or drawback…');
  } else {
    output.push('FIRST ENTRY');
    header.forEach(label => output.push(`${label}: `));
    output.push('', 'Add more entries below when you need them.');
  }

  let consumed = 2;
  while (start + consumed < lines.length && lines[start + consumed].trim().startsWith('|')) consumed += 1;
  return { consumed, output };
}

export function buildFriendlyTemplateContent(template: NoteTemplate, title: string, date = new Date(), includeExamples = true): string {
  const lines = template.content.split('\n');
  const output: string[] = [];
  let firstHeadingSkipped = false;

  for (let index = 0; index < lines.length;) {
    const raw = lines[index];
    const line = raw.trim();

    if (!line || line === '---') {
      if (output.length > 0 && output[output.length - 1] !== '') output.push('');
      index += 1;
      continue;
    }

    if (line.startsWith('|')) {
      const table = humanizeMarkdownTable(lines, index);
      output.push(...table.output, '');
      index += table.consumed;
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const heading = cleanInlineMarkdown(headingMatch[1]).replace(/\[Name\]|\[Topic\]/gi, title).trim();
      if (!firstHeadingSkipped) {
        firstHeadingSkipped = true;
        index += 1;
        continue;
      }
      const normalized = heading.toLowerCase().replace(/^[^a-z0-9]+/i, '').trim();
      output.push(heading.toUpperCase());
      const guide = GUIDE_BY_HEADING[normalized];
      if (guide) output.push(guide);
      const example = includeExamples ? EXAMPLE_BY_HEADING[normalized] : undefined;
      if (example) output.push(example);
      output.push('');
      index += 1;
      continue;
    }

    if (/^- \[ \]\s*/.test(line)) {
      output.push(`☐ ${cleanInlineMarkdown(line.replace(/^- \[ \]\s*/, '')) || 'Add an action…'}`);
      index += 1;
      continue;
    }

    if (/^-\s*/.test(line)) {
      output.push(`• ${cleanInlineMarkdown(line.replace(/^-\s*/, '')) || 'Add an item…'}`);
      index += 1;
      continue;
    }

    const labelMatch = cleanInlineMarkdown(line).match(/^([^:]{2,40}):\s*$/);
    if (labelMatch) {
      const label = labelMatch[1];
      const normalized = label.toLowerCase();
      if (normalized === 'date') output.push(`Date: ${longDate(date)}`);
      else if (normalized === 'week of') output.push(`Week of: ${weekLabel(date)}`);
      else if (normalized === 'month') output.push(`Month: ${monthLabel(date)}`);
      else {
        output.push(`${label}: `);
        const guide = GUIDE_BY_HEADING[normalized];
        if (guide) output.push(guide);
        const example = includeExamples ? EXAMPLE_BY_HEADING[normalized] : undefined;
        if (example) output.push(example);
      }
      index += 1;
      continue;
    }

    if (/^\d+\.\s*$/.test(line)) {
      output.push(`${line} Add a point…`);
      index += 1;
      continue;
    }

    const cleaned = cleanInlineMarkdown(line)
      .replace(/\[Name\]|\[Topic\]/gi, title)
      .replace(/^What worked\?$/i, 'What worked well?')
      .replace(/^What needs adjustment\?$/i, 'What would you change next time?');
    if (cleaned) output.push(cleaned);
    index += 1;
  }

  let result = output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  result = result
    .replace(/^Date:\s*$/gm, `Date: ${longDate(date)}`)
    .replace(/^Week Of\s*$/gim, `WEEK OF\n${weekLabel(date)}`)
    .replace(/^Month\s*$/gim, `MONTH\n${monthLabel(date)}`)
    .replace(/^Today\s*$/gim, `TODAY\n${longDate(date)}`);

  if (!result) {
    return 'START HERE\nWrite anything you want to remember. You can change or remove this guidance at any time.';
  }
  return result;
}

function setupValue(values: TemplatePersonalizationValues, key: string, fallback = ''): string {
  return values[key]?.trim() || fallback;
}

function buildCvContent(values: TemplatePersonalizationValues, includeExamples: boolean): string {
  const name = setupValue(values, 'fullName', 'YOUR NAME');
  const role = setupValue(values, 'targetRole', 'Your Target Role');
  const email = setupValue(values, 'email', 'your.email@example.com');
  const phone = setupValue(values, 'phone', '+234 800 000 0000');
  const location = setupValue(values, 'location', 'City, Country');
  const years = setupValue(values, 'yearsExperience');
  const experiencePhrase = years ? `${years}+ years of experience` : 'solid professional experience';
  const example = (text: string) => includeExamples ? `Example — replace this with your real information: ${text}` : '';

  return `${name}
${role}
${location} · ${phone} · ${email}

PROFESSIONAL SUMMARY
Write 3–4 lines that quickly explain what you do, the experience you bring, and the value you create.
${example(`Results-focused ${role.toLowerCase()} with ${experiencePhrase} helping teams improve service, organize work, solve problems, and deliver dependable results. Known for clear communication, practical decision-making, and following work through from idea to completion.`)}

CORE SKILLS
Choose 6–10 skills that match the kind of work you want.
${example('Operations Management · Project Coordination · Customer Service · Team Leadership · Process Improvement · Reporting · Stakeholder Communication · Microsoft Office')}

WORK EXPERIENCE

MOST RECENT ROLE
Job Title — Company Name
City, Country · Month Year – Present
${example('Led day-to-day operations for a growing team, improving coordination between customer service, administration, and delivery functions.')}
${example('Introduced a clearer follow-up process that reduced missed actions and helped work move faster.')}
${example('Prepared weekly reports and worked with management to identify priorities, risks, and practical improvements.')}

PREVIOUS ROLE
Job Title — Company Name
City, Country · Month Year – Month Year
${example('Supported customers and internal teams while maintaining accurate records and resolving issues promptly.')}
${example('Helped improve routine processes by documenting common problems and suggesting simpler ways of working.')}

EDUCATION
Qualification — School or Institution
City, Country · Year
${includeExamples ? 'Example — replace this: B.Sc. Business Administration — University Name · 2022' : ''}

CERTIFICATIONS & TRAINING
Add only training that strengthens this application.
${example('Project Management Fundamentals · Customer Experience Training · Microsoft Excel')}

ADDITIONAL INFORMATION
Add languages, professional memberships, volunteer work, portfolio links, or other relevant information only when useful.

BEFORE YOU SEND THIS CV
☐ Replace every example with truthful information about you.
☐ Start achievement bullets with strong verbs such as Led, Improved, Created, Reduced, Delivered, Managed, or Supported.
☐ Add numbers where they are truthful and useful.
☐ Remove sections you do not need.
☐ Check spelling, phone number, email, dates, and company names.
☐ Keep the finished CV focused on the role you are applying for.`;
}

function buildCoverLetterContent(values: TemplatePersonalizationValues, includeExamples: boolean, date: Date): string {
  const name = setupValue(values, 'fullName', 'YOUR NAME');
  const email = setupValue(values, 'email', 'your.email@example.com');
  const job = setupValue(values, 'jobTitle', 'the advertised role');
  const company = setupValue(values, 'companyName', 'your organization');
  const strength = setupValue(values, 'strength', 'solving practical problems, communicating clearly, and helping teams deliver reliable results');
  const sample = includeExamples
    ? `I am writing to apply for the ${job} position at ${company}. My background has given me practical experience in ${strength}, and I would welcome the opportunity to bring that experience to your team.`
    : 'Write a short opening that names the role and explains why you are a strong fit.';

  return `${name}
${email}
${longDate(date)}

Dear Hiring Manager,

${sample}

WHY I AM A GOOD FIT
${includeExamples ? `Example — replace this: In my recent work, I have taken responsibility for important day-to-day priorities, coordinated with different people, and looked for practical ways to improve how work gets done. I am comfortable learning quickly, communicating with customers and colleagues, and taking ownership of results.` : 'Explain one or two relevant strengths and support them with a real example.'}

WHY THIS ROLE
${includeExamples ? `Example — replace this: I am especially interested in this opportunity because it combines responsibility, problem solving, and service. I would value the chance to contribute to ${company} while continuing to grow professionally.` : 'Explain briefly why this specific role or organization interests you.'}

Thank you for considering my application. I would welcome the opportunity to discuss how my experience could support your team.

Kind regards,
${name}

PERSONALIZE BEFORE SENDING
☐ Replace generic statements with a real achievement.
☐ Mention something specific about the company or role.
☐ Keep the final letter to roughly one page.
☐ Check the company name, job title, and contact details.`;
}

function replaceGuidedField(content: string, labels: string[], value: string): string {
  const cleanValue = value.trim();
  if (!cleanValue) return content;
  const lines = content.split('\n');
  const normalizedLabels = labels.map(label => label.trim().toLowerCase());
  for (let i = 0; i < lines.length; i += 1) {
    const normalized = lines[i].trim().replace(/:$/, '').toLowerCase();
    if (!normalizedLabels.includes(normalized)) continue;
    if (i + 1 < lines.length && lines[i + 1].trim() && !/^[A-Z][A-Z &/’'()-]{2,}$/.test(lines[i + 1].trim())) {
      lines[i + 1] = cleanValue;
    } else {
      lines.splice(i + 1, 0, cleanValue);
    }
    return lines.join('\n');
  }
  return content;
}

function prependPersonalizedDetails(template: NoteTemplate, content: string, values: TemplatePersonalizationValues): string {
  let personalized = content;
  const extras: string[] = [];

  if (template.id === 'tpl-meeting') {
    const topic = setupValue(values, 'meetingTopic');
    const attendees = setupValue(values, 'attendees');
    if (topic) extras.push(`Meeting topic: ${topic}`);
    if (attendees) personalized = replaceGuidedField(personalized, ['Attendees'], attendees);
  }

  if (template.id === 'tpl-project') {
    personalized = replaceGuidedField(personalized, ['Goal', 'Goals'], setupValue(values, 'projectGoal'));
    const deadline = setupValue(values, 'deadline');
    if (deadline) extras.push(`Target date: ${deadline}`);
  }

  if (template.id === 'tpl-travel-plan') {
    const destination = setupValue(values, 'destination');
    const dates = setupValue(values, 'travelDates');
    if (destination) personalized = replaceGuidedField(personalized, ['Destination'], destination);
    if (dates) extras.push(`Travel dates: ${dates}`);
  }

  if (template.id === 'tpl-budget-review') {
    const income = setupValue(values, 'income');
    const savingsGoal = setupValue(values, 'savingsGoal');
    if (income) extras.push(`Expected income: ${income}`);
    if (savingsGoal) extras.push(`Savings goal: ${savingsGoal}`);
  }

  return extras.length ? `QUICK DETAILS\n${extras.join('\n')}\n\n${personalized}` : personalized;
}

export function buildTemplateDraft(
  template: NoteTemplate,
  requestedTitle?: string,
  date = new Date(),
  values: TemplatePersonalizationValues = {},
  includeExamples = true,
): TemplateDraft {
  let title = requestedTitle?.trim() || defaultTemplateTitle(template, date);
  if (template.id === 'tpl-cv' && setupValue(values, 'fullName') && (!requestedTitle || /CV \/ Resume|^CV\b/i.test(requestedTitle))) {
    title = `${setupValue(values, 'fullName')} — CV`;
  }
  if (template.id === 'tpl-cover-letter' && setupValue(values, 'jobTitle') && (!requestedTitle || /^Cover Letter/i.test(requestedTitle))) {
    title = `${setupValue(values, 'jobTitle')} — Cover Letter`;
  }
  const checklist = template.id === 'tpl-todo' ? [] : template.checklist.map(item => ({ ...item }));
  let content: string;
  if (template.id === 'tpl-cv') content = buildCvContent(values, includeExamples);
  else if (template.id === 'tpl-cover-letter') content = buildCoverLetterContent(values, includeExamples, date);
  else content = prependPersonalizedDetails(template, buildFriendlyTemplateContent(template, title, date, includeExamples), values);
  return { title, content, type: template.type === 'checklist' ? 'checklist' : 'note', checklist };
}

export function getTemplatePreviewSections(
  template: NoteTemplate,
  date = new Date(),
  values: TemplatePersonalizationValues = {},
  includeExamples = true,
): Array<{ title: string; hint?: string }> {
  const content = buildTemplateDraft(template, defaultTemplateTitle(template, date), date, values, includeExamples).content;
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  const sections: Array<{ title: string; hint?: string }> = [];
  for (let i = 0; i < lines.length && sections.length < 5; i += 1) {
    const line = lines[i];
    const looksLikeHeading = line === line.toUpperCase() && /[A-Z]/.test(line) && line.length <= 42;
    if (!looksLikeHeading) continue;
    const next = lines[i + 1];
    sections.push({ title: titleCase(line), hint: next && next !== next.toUpperCase() ? next : undefined });
  }
  return sections.length ? sections : [
    { title: 'Start writing', hint: 'A clean structure you can change as you go.' },
    { title: 'Make it yours', hint: 'Nothing in a template is locked.' },
  ];
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

export interface TemplateSectionBlock {
  id: string;
  icon: string;
  name: string;
  description: string;
  content: string;
}

export const templateSectionBlocks: TemplateSectionBlock[] = [
  { id: 'summary', icon: '📝', name: 'Summary', description: 'A simple place to capture the main point.', content: '\n\nSUMMARY\nWrite the main point in a few clear sentences.\n' },
  { id: 'agenda', icon: '🗂️', name: 'Agenda', description: 'Topics to cover in a meeting or discussion.', content: '\n\nAGENDA\n• Add a topic…\n• Add another topic…\n' },
  { id: 'actions', icon: '✅', name: 'Action items', description: 'Clear next steps you can assign or date.', content: '\n\nACTION ITEMS\n☐ Add the next action…\n☐ Add another action…\n' },
  { id: 'decision', icon: '⚖️', name: 'Decision', description: 'Record what was decided and why.', content: '\n\nDECISION\nWhat was decided?\n\nWHY\nWhat led to this decision?\n' },
  { id: 'pros-cons', icon: '↔️', name: 'Pros & cons', description: 'Compare what looks good with what could be difficult.', content: '\n\nPROS\n• Add a benefit…\n\nCONS\n• Add a concern…\n' },
  { id: 'ideas', icon: '💡', name: 'Ideas', description: 'A quick space for possibilities and rough thoughts.', content: '\n\nIDEAS\n• Add an idea…\n• Add another idea…\n' },
  { id: 'questions', icon: '❓', name: 'Questions', description: 'Keep track of things that still need an answer.', content: '\n\nQUESTIONS\n• What still needs an answer?\n' },
  { id: 'resources', icon: '🔗', name: 'Resources', description: 'Collect useful links, people, files, or references.', content: '\n\nRESOURCES\n• Add a useful link, person, file, or reference…\n' },
  { id: 'reflection', icon: '🌿', name: 'Reflection', description: 'Pause and capture what you learned.', content: '\n\nREFLECTION\nWhat went well?\n\nWhat was difficult?\n\nWhat would you do differently next time?\n' },
];
