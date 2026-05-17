import { useMemo } from 'react';
import { useStore } from '@/store';
import { buildGraph, getBacklinks, getOutgoingNoteIds, noteDisplayTitle } from '@/utils/links';
import { GitBranch, Link2, Lock, Network, Search } from 'lucide-react';

const WIDTH = 840;
const HEIGHT = 460;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

export default function GraphView() {
  const { notes, selectNote } = useStore();
  const graphNotes = useMemo(
    () => notes.filter(note => !note.trashed && !note.archived),
    [notes]
  );
  const graph = useMemo(() => buildGraph(graphNotes), [graphNotes]);

  const positionedNodes = useMemo(() => {
    const radius = Math.min(WIDTH, HEIGHT) * 0.34;
    return graph.nodes.map((note, index) => {
      if (graph.nodes.length === 1) {
        return { note, x: CENTER_X, y: CENTER_Y };
      }
      const angle = (index / graph.nodes.length) * Math.PI * 2 - Math.PI / 2;
      const ringOffset = index % 2 === 0 ? 0 : -46;
      return {
        note,
        x: CENTER_X + Math.cos(angle) * (radius + ringOffset),
        y: CENTER_Y + Math.sin(angle) * (radius + ringOffset),
      };
    });
  }, [graph.nodes]);

  const nodeMap = new Map(positionedNodes.map(item => [item.note.id, item]));
  const connectedIds = new Set(graph.edges.flatMap(edge => [edge.from, edge.to]));
  const topLinked = graph.nodes
    .map(note => ({
      note,
      total: getOutgoingNoteIds(note, graph.nodes).length + getBacklinks(note.id, graph.nodes).length,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  return (
    <div className="flex-1 overflow-y-auto theme-bg">
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full accent-soft text-xs font-semibold mb-3">
              <Network className="w-3.5 h-3.5 no-transition" />
              Knowledge graph
            </div>
            <h2 className="text-2xl font-bold text-theme-primary">Backlinks & Graph</h2>
            <p className="text-sm text-theme-tertiary mt-1">
              Notes connect through manual links and [[wiki links]] in your content.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 min-w-[260px]">
            <Stat label="Notes" value={graph.nodes.length} />
            <Stat label="Links" value={graph.edges.length} />
            <Stat label="Linked" value={connectedIds.size} />
          </div>
        </div>

        {graph.nodes.length === 0 ? (
          <div className="rounded-xl theme-card border p-10 text-center">
            <GitBranch className="w-12 h-12 mx-auto text-theme-muted no-transition mb-3" />
            <h3 className="font-semibold text-theme-primary">No graph yet</h3>
            <p className="text-sm text-theme-tertiary mt-1">Create notes and link them with [[Note Title]].</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
            <div className="rounded-xl theme-card border p-3 md:p-5 overflow-hidden">
              <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                role="img"
                aria-label="Note graph"
                className="w-full min-h-[320px]"
              >
                <defs>
                  <radialGradient id="nodeGlow" cx="50%" cy="50%" r="65%">
                    <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="var(--accent-primary-hover)" stopOpacity="0.78" />
                  </radialGradient>
                </defs>
                {graph.edges.map(edge => {
                  const from = nodeMap.get(edge.from);
                  const to = nodeMap.get(edge.to);
                  if (!from || !to) return null;
                  return (
                    <line
                      key={`${edge.from}-${edge.to}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="var(--accent-primary)"
                      strokeOpacity="0.32"
                      strokeWidth="2"
                    />
                  );
                })}
                {positionedNodes.map(({ note, x, y }) => {
                  const degree = getOutgoingNoteIds(note, graph.nodes).length + getBacklinks(note.id, graph.nodes).length;
                  const size = Math.min(30, 16 + degree * 3);
                  return (
                    <g
                      key={note.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectNote(note.id)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') selectNote(note.id);
                      }}
                      className="cursor-pointer"
                    >
                      <circle cx={x} cy={y} r={size + 8} fill="var(--accent-primary)" opacity="0.08" />
                      <circle cx={x} cy={y} r={size} fill={note.encrypted ? 'var(--app-bg-subtle)' : 'url(#nodeGlow)'} stroke="var(--card-border)" strokeWidth="2" />
                      {note.encrypted && (
                        <text x={x} y={y + 5} textAnchor="middle" fontSize="15" fill="var(--text-tertiary)">lock</text>
                      )}
                      <text
                        x={x}
                        y={y + size + 20}
                        textAnchor="middle"
                        fontSize="13"
                        fontWeight="600"
                        fill="var(--text-primary)"
                      >
                        {noteDisplayTitle(note).slice(0, 22)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <aside className="space-y-4">
              <div className="rounded-xl theme-card border p-4">
                <h3 className="font-semibold text-theme-primary mb-3 flex items-center gap-2">
                  <Link2 className="w-4 h-4 no-transition accent-text" />
                  Most connected
                </h3>
                <div className="space-y-2">
                  {topLinked.map(({ note, total }) => (
                    <button
                      key={note.id}
                      onClick={() => selectNote(note.id)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg theme-hover text-left"
                    >
                      <div className="w-8 h-8 rounded-lg accent-soft flex items-center justify-center shrink-0">
                        {note.encrypted ? <Lock className="w-4 h-4 no-transition" /> : <GitBranch className="w-4 h-4 no-transition" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-theme-primary truncate">{noteDisplayTitle(note)}</p>
                        <p className="text-xs text-theme-tertiary">{total} connection{total === 1 ? '' : 's'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl theme-card border p-4">
                <h3 className="font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <Search className="w-4 h-4 no-transition accent-text" />
                  Link syntax
                </h3>
                <p className="text-sm text-theme-tertiary leading-relaxed">
                  Type a note title inside double brackets, like [[Project Plan]], and the graph will connect it automatically.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg theme-card border px-3 py-2 text-center">
      <p className="text-lg font-bold text-theme-primary">{value}</p>
      <p className="text-[11px] text-theme-tertiary">{label}</p>
    </div>
  );
}
