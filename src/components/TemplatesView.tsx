import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, FileText, Search, Sparkles, X } from 'lucide-react';
import { useStore } from '@/store';
import type { NoteTemplate } from '@/types';
import {
  TEMPLATE_CATEGORIES,
  defaultTemplateTitle,
  buildTemplateDraft,
  getTemplateExperience,
  getTemplatePreviewSections,
  getTemplateSetupDefaults,
  getTemplateSetupFields,
  type TemplateCategory,
  type TemplatePersonalizationValues,
} from '@/utils/templateExperience';

const FEATURED_TEMPLATE_IDS = new Set([
  'tpl-cv',
  'tpl-meeting',
  'tpl-project',
  'tpl-todo',
  'tpl-journal',
  'tpl-weekly',
  'tpl-brainstorm',
]);

type CategoryFilter = 'All' | TemplateCategory;

export default function TemplatesView() {
  const { templates, createFromTemplate, createNote, profile } = useStore();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [selectedTemplate, setSelectedTemplate] = useState<NoteTemplate | null>(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return templates.filter(template => {
      const experience = getTemplateExperience(template);
      const matchesCategory = category === 'All' || experience.category === category;
      if (!matchesCategory) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        template.name,
        experience.friendlyDescription,
        experience.bestFor,
        experience.category,
        ...template.tags,
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [templates, query, category]);

  const featuredTemplates = useMemo(
    () => templates.filter(template => FEATURED_TEMPLATE_IDS.has(template.id)),
    [templates],
  );

  const openTemplate = (template: NoteTemplate) => {
    setSelectedTemplate(template);
    if (template.id === 'tpl-cv' && profile.name && profile.name !== 'User') setNoteTitle(`${profile.name} — CV`);
    else setNoteTitle(defaultTemplateTitle(template));
  };

  const closeTemplate = () => {
    if (creating) return;
    setSelectedTemplate(null);
    setNoteTitle('');
  };

  const useTemplate = async (values: TemplatePersonalizationValues = {}, includeExamples = true) => {
    if (!selectedTemplate || creating) return;
    setCreating(true);
    try {
      await createFromTemplate(selectedTemplate.id, { title: noteTitle, values, includeExamples });
      setSelectedTemplate(null);
      setNoteTitle('');
    } finally {
      setCreating(false);
    }
  };

  const startBlank = async () => {
    await createNote({ title: '', content: '', type: 'note' });
  };

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--app-bg)' }}>
      <div className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6 md:py-7">
        <header className="mb-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold accent-text">
                <Sparkles className="h-4 w-4 no-transition" />
                Easy starting points
              </div>
              <h1 className="text-2xl font-bold text-theme-primary md:text-3xl">What would you like to create?</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-theme-tertiary md:text-base">
                Choose a template, see what it will give you, name your note, and start writing. Nothing in a template is locked.
              </p>
            </div>
            <button
              type="button"
              onClick={startBlank}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border theme-border px-4 py-2.5 text-sm font-semibold text-theme-primary theme-hover"
            >
              <FileText className="h-4 w-4 no-transition" />
              Start with a blank note
            </button>
          </div>

          <div className="mt-5 grid gap-3 rounded-2xl border theme-card p-4 sm:grid-cols-3">
            <TemplateStep number="1" title="Choose" text="Pick what you want to make." />
            <TemplateStep number="2" title="Preview" text="See the structure before creating anything." />
            <TemplateStep number="3" title="Personalize" text="Give it a useful name and edit it your way." />
          </div>
        </header>

        <div className="sticky top-0 z-20 -mx-4 mb-6 border-y theme-divider px-4 py-3 backdrop-blur md:-mx-6 md:px-6" style={{ backgroundColor: 'color-mix(in srgb, var(--app-bg) 92%, transparent)' }}>
          <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center">
            <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border theme-border theme-input px-3">
              <Search className="h-4 w-4 shrink-0 text-theme-tertiary no-transition" />
              <span className="sr-only">Search templates</span>
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-theme-primary outline-none placeholder:text-theme-muted"
                placeholder="Search by purpose — meeting, project, journal, study…"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="rounded-lg p-1 text-theme-tertiary theme-hover"
                  aria-label="Clear template search"
                >
                  <X className="h-4 w-4 no-transition" />
                </button>
              )}
            </label>

            <div className="flex gap-2 overflow-x-auto pb-1 lg:max-w-[62%]" aria-label="Template categories">
              {(['All', ...TEMPLATE_CATEGORIES] as CategoryFilter[]).map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`min-h-10 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors ${
                    category === item ? 'accent-bg text-white' : 'theme-card theme-hover text-theme-secondary'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        {category === 'All' && !query.trim() && (
          <section className="mb-8">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-theme-primary">Good places to start</h2>
                <p className="mt-1 text-sm text-theme-tertiary">Simple templates that work for everyday notes.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {featuredTemplates.map(template => (
                <TemplateCard key={template.id} template={template} onOpen={openTemplate} featured />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3">
            <h2 className="text-lg font-bold text-theme-primary">
              {query.trim() ? 'Search results' : category === 'All' ? 'All templates' : category}
            </h2>
            <p className="mt-1 text-sm text-theme-tertiary">
              {filteredTemplates.length} template{filteredTemplates.length === 1 ? '' : 's'} available
            </p>
          </div>

          {filteredTemplates.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredTemplates.map(template => (
                <TemplateCard key={template.id} template={template} onOpen={openTemplate} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed theme-border px-6 py-14 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--input-bg)' }}>
                <Search className="h-5 w-5 text-theme-tertiary no-transition" />
              </div>
              <h3 className="font-semibold text-theme-primary">No template matches that search</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-theme-tertiary">Try a simpler word such as “meeting”, “plan”, “study”, or choose another category.</p>
              <button
                type="button"
                onClick={() => { setQuery(''); setCategory('All'); }}
                className="mt-4 rounded-lg px-3 py-2 text-sm font-semibold accent-text theme-hover"
              >
                Show all templates
              </button>
            </div>
          )}
        </section>
      </div>

      {selectedTemplate && (
        <TemplatePreviewDialog
          template={selectedTemplate}
          title={noteTitle}
          creating={creating}
          profile={profile}
          onTitleChange={setNoteTitle}
          onClose={closeTemplate}
          onCreate={useTemplate}
        />
      )}
    </div>
  );
}

function TemplateCard({ template, onOpen, featured = false }: { template: NoteTemplate; onOpen: (template: NoteTemplate) => void; featured?: boolean }) {
  const experience = getTemplateExperience(template);
  return (
    <button
      type="button"
      onClick={() => onOpen(template)}
      className={`group flex min-h-[190px] w-full flex-col rounded-2xl border theme-card p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg ${featured ? 'sm:min-h-[205px] sm:p-5' : ''}`}
      aria-label={`Preview ${template.name} template`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl text-xl" style={{ backgroundColor: 'var(--input-bg)' }}>
          {experience.icon}
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-theme-tertiary" style={{ backgroundColor: 'var(--input-bg)' }}>
          {experience.category}
        </span>
      </div>
      <h3 className="font-bold text-theme-primary group-hover:accent-text">{template.name}</h3>
      <p className="mt-1.5 line-clamp-3 text-sm leading-5 text-theme-tertiary">{experience.friendlyDescription}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs">
        <span className="truncate text-theme-muted">Best for: {experience.bestFor}</span>
        <span className="flex shrink-0 items-center gap-1 font-semibold accent-text">
          Preview <ArrowRight className="h-3.5 w-3.5 no-transition transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function TemplatePreviewDialog({
  template,
  title,
  creating,
  profile,
  onTitleChange,
  onClose,
  onCreate,
}: {
  template: NoteTemplate;
  title: string;
  creating: boolean;
  profile: { name: string; email: string };
  onTitleChange: (title: string) => void;
  onClose: () => void;
  onCreate: (values: TemplatePersonalizationValues, includeExamples: boolean) => void;
}) {
  const experience = getTemplateExperience(template);
  const setupFields = getTemplateSetupFields(template);
  const [values, setValues] = useState<TemplatePersonalizationValues>(() => getTemplateSetupDefaults(template, profile));
  const [includeExamples, setIncludeExamples] = useState(true);
  const previewSections = getTemplatePreviewSections(template, new Date(), values, includeExamples);
  const liveDraft = buildTemplateDraft(template, title, new Date(), values, includeExamples);
  const requiredMissing = setupFields.some(field => field.required && !values[field.key]?.trim());
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setValues(getTemplateSetupDefaults(template, profile));
    setIncludeExamples(true);
  }, [template.id, profile.name, profile.email]);

  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => titleInputRef.current?.focus(), 50);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.hasAttribute('hidden'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      previousActive?.focus();
    };
  }, []);

  const setField = (key: string, next: string) => {
    setValues(current => ({ ...current, [key]: next }));
    if (template.id === 'tpl-cv' && key === 'fullName' && next.trim() && /CV|Resume/i.test(title)) onTitleChange(`${next.trim()} — CV`);
    if (template.id === 'tpl-cover-letter' && key === 'jobTitle' && next.trim() && /^Cover Letter/i.test(title)) onTitleChange(`${next.trim()} — Cover Letter`);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-preview-title"
        className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl border theme-card shadow-2xl sm:max-h-[92vh] sm:rounded-3xl"
        style={{ backgroundColor: 'var(--card-bg)' }}
      >
        <div className="flex items-start justify-between gap-4 border-b theme-divider px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl" style={{ backgroundColor: 'var(--input-bg)' }}>{experience.icon}</div>
            <div className="min-w-0">
              <div className="mb-1 text-xs font-semibold accent-text">{experience.category}</div>
              <h2 id="template-preview-title" className="text-xl font-bold text-theme-primary sm:text-2xl">{template.name}</h2>
              <p className="mt-1 text-sm text-theme-tertiary">{experience.friendlyDescription}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={creating} className="rounded-xl p-2 text-theme-tertiary theme-hover disabled:opacity-50" aria-label="Close template preview"><X className="h-5 w-5 no-transition" /></button>
        </div>

        <div className="grid flex-1 overflow-y-auto xl:grid-cols-[0.82fr_1.18fr]">
          <section className="border-b theme-divider p-5 sm:p-6 xl:border-b-0 xl:border-r">
            <div className="mb-4">
              <h3 className="font-bold text-theme-primary">What you are getting</h3>
              <p className="mt-1 text-sm leading-6 text-theme-tertiary">This is a real starting document, not an empty technical skeleton. Sample wording is clearly marked so you can replace it with truthful information about you.</p>
            </div>

            <div className="space-y-2.5">
              {previewSections.map((section, index) => (
                <div key={`${section.title}-${index}`} className="rounded-xl border theme-border p-3.5" style={{ backgroundColor: 'var(--app-bg-subtle)' }}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold accent-soft accent-text">{index + 1}</div>
                    <div><p className="text-sm font-semibold text-theme-primary">{section.title}</p>{section.hint && <p className="mt-1 text-xs leading-5 text-theme-tertiary">{section.hint}</p>}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border theme-border p-3.5">
              <div className="flex gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 accent-text no-transition" />
                <div>
                  <p className="text-sm font-semibold text-theme-primary">Beginner friendly by default</p>
                  <p className="mt-1 text-xs leading-5 text-theme-tertiary">Dates are filled automatically where useful, profile name/email can be filled when available, and you can remove anything you do not need.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="p-5 sm:p-6">
            <div className="rounded-2xl border theme-border p-4" style={{ backgroundColor: 'var(--app-bg-subtle)' }}>
              <div className="mb-4 flex items-center gap-2"><Sparkles className="h-4 w-4 accent-text no-transition" /><h3 className="font-bold text-theme-primary">Personalize before creating</h3></div>

              <label className="block">
                <span className="text-sm font-semibold text-theme-secondary">Document title</span>
                <input ref={titleInputRef} value={title} onChange={event => onTitleChange(event.target.value)} placeholder={experience.titlePlaceholder} className="mt-2 min-h-11 w-full rounded-xl border theme-border theme-input px-3.5 text-sm text-theme-primary outline-none focus:ring-2 focus:ring-indigo-500/30" />
              </label>

              {setupFields.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {setupFields.map(field => (
                    <label key={field.key} className={field.type === 'textarea' ? 'block sm:col-span-2' : 'block'}>
                      <span className="text-sm font-semibold text-theme-secondary">{field.label}{field.required ? ' *' : ''}</span>
                      {field.type === 'textarea' ? (
                        <textarea value={values[field.key] || ''} onChange={event => setField(field.key, event.target.value)} placeholder={field.placeholder} rows={3} className="mt-1.5 w-full rounded-xl border theme-border theme-input px-3.5 py-2.5 text-sm text-theme-primary outline-none focus:ring-2 focus:ring-indigo-500/30" />
                      ) : (
                        <input type={field.type || 'text'} value={values[field.key] || ''} onChange={event => setField(field.key, event.target.value)} placeholder={field.placeholder} className="mt-1.5 min-h-11 w-full rounded-xl border theme-border theme-input px-3.5 text-sm text-theme-primary outline-none focus:ring-2 focus:ring-indigo-500/30" />
                      )}
                      {field.helper && <span className="mt-1 block text-xs leading-5 text-theme-tertiary">{field.helper}</span>}
                    </label>
                  ))}
                </div>
              )}

              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border theme-border p-3.5">
                <input type="checkbox" checked={includeExamples} onChange={event => setIncludeExamples(event.target.checked)} className="mt-1 h-4 w-4 accent-range" />
                <span><span className="block text-sm font-semibold text-theme-primary">Include sample wording I can edit</span><span className="mt-0.5 block text-xs leading-5 text-theme-tertiary">Recommended for beginners. Examples are marked “replace this” so you know what good content can look like without mistaking it for your real information.</span></span>
              </label>

              <div className="mt-4 rounded-xl border theme-border p-3.5" style={{ backgroundColor: 'var(--card-bg)' }}>
                <div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-wide text-theme-muted">Live example</p><span className="text-[11px] text-theme-tertiary">This is how your note will start</span></div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-theme-secondary">{liveDraft.content.split('\n').slice(0, 22).join('\n')}</pre>
              </div>

              {requiredMissing && <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-400">Complete the required fields marked with * before creating this document.</p>}

              <button type="button" onClick={() => onCreate(values, includeExamples)} disabled={creating || !title.trim() || requiredMissing} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl accent-bg px-4 text-sm font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50">
                {creating ? 'Creating your document…' : `Create ${template.name}`}{!creating && <ArrowRight className="h-4 w-4 no-transition" />}
              </button>
              <p className="mt-3 text-center text-xs leading-5 text-theme-muted">The new document starts private. You can edit every word, delete sections, or change the format after creation.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function TemplateStep({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold accent-soft accent-text">{number}</span>
      <div>
        <p className="text-sm font-semibold text-theme-primary">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-theme-tertiary">{text}</p>
      </div>
    </div>
  );
}
