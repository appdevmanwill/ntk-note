/** Emoji notebook icons remain backward-compatible with existing Firestore records and UI renderers. */
export const NOTEBOOK_ICONS = [
  { label: 'Notebook', icon: '📓' }, { label: 'Folder', icon: '📁' },
  { label: 'Keys', icon: '🔑' }, { label: 'Security', icon: '🔐' },
  { label: 'Email', icon: '✉️' }, { label: 'Office', icon: '🏢' },
  { label: 'Work', icon: '💼' }, { label: 'Cloud', icon: '☁️' },
  { label: 'Hosting', icon: '🖥️' }, { label: 'Upload', icon: '⬆️' },
  { label: 'Download', icon: '⬇️' }, { label: 'Links', icon: '🔗' },
  { label: 'Website', icon: '🌐' }, { label: 'Database', icon: '🗄️' },
  { label: 'Files', icon: '🗂️' }, { label: 'Documents', icon: '📄' },
  { label: 'Code', icon: '💻' }, { label: 'Money', icon: '💰' },
  { label: 'Banking', icon: '🏦' }, { label: 'Accounts', icon: '👤' },
  { label: 'People', icon: '👥' }, { label: 'Calendar', icon: '📅' },
  { label: 'Projects', icon: '📋' }, { label: 'Ideas', icon: '💡' },
  { label: 'Learning', icon: '📚' }, { label: 'Music', icon: '🎵' },
  { label: 'Photo', icon: '🖼️' }, { label: 'Travel', icon: '✈️' },
  { label: 'Home', icon: '🏠' }, { label: 'Favorite', icon: '⭐' },
  { label: 'Shopping', icon: '🛍️' }, { label: 'Health', icon: '❤️' },
] as const;

interface Props { value: string; onChange: (icon: string) => void }
export default function NotebookIconPicker({ value, onChange }: Props) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-theme-secondary">Choose a notebook icon</legend>
      <div className="grid grid-cols-5 sm:grid-cols-8 gap-1.5 max-h-48 overflow-y-auto p-1 rounded-xl border theme-border" role="group" aria-label="Notebook icon choices">
        {NOTEBOOK_ICONS.map(option => (
          <button key={option.label} type="button" title={option.label} aria-label={`${option.label} icon`}
            aria-pressed={value === option.icon} onClick={() => onChange(option.icon)}
            className={`min-h-11 flex flex-col items-center justify-center rounded-lg theme-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${value === option.icon ? 'ring-2 ring-indigo-500 theme-active' : ''}`}>
            <span aria-hidden="true" className="text-xl">{option.icon}</span>
            <span className="text-[9px] truncate max-w-full px-0.5 text-theme-tertiary">{option.label}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-theme-tertiary mt-1">Selected icon: <span aria-hidden="true">{value}</span>. Saved with this notebook across devices.</p>
    </fieldset>
  );
}
