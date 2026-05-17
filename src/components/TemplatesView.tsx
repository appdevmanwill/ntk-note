import { useStore } from '@/store';
import { noteThemes } from '@/utils/noteThemes';

export default function TemplatesView() {
  const { templates, createFromTemplate } = useStore();

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: 'var(--app-bg)' }}>
      <h2 className="text-xl font-bold text-theme-primary mb-1">Templates</h2>
      <p className="text-sm text-theme-tertiary mb-6">Start with a pre-made template to save time</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map(tpl => (
          <button
            key={tpl.id}
            onClick={() => createFromTemplate(tpl.id)}
            className="text-left p-5 rounded-xl border theme-card hover:-translate-y-0.5 transition-all group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-lg font-bold text-theme-primary">{tpl.icon}</div>
              {tpl.theme && (
                <span
                  className="h-6 w-12 rounded-md border"
                  style={{
                    background: noteThemes[tpl.theme].preview,
                    borderColor: 'var(--card-border)',
                  }}
                />
              )}
            </div>
            <h3 className="font-semibold text-theme-primary group-hover:text-indigo-500 transition-colors">
              {tpl.name}
            </h3>
            <p className="text-sm text-theme-tertiary mt-1">{tpl.description}</p>
            <div className="flex items-center gap-1.5 mt-3">
              <span
                className="text-xs px-2 py-0.5 rounded-full capitalize"
                style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text-tertiary)' }}
              >
                {tpl.type}
              </span>
              {tpl.tags.map(tag => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
