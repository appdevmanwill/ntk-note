import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

interface Props {
  onInsert: (markdown: string) => void;
  onClose: () => void;
}

export default function TableEditor({ onInsert, onClose }: Props) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [headers, setHeaders] = useState(['Header 1', 'Header 2', 'Header 3']);
  const [cells, setCells] = useState<string[][]>([
    ['', '', ''],
    ['', '', ''],
  ]);

  const addColumn = () => {
    setCols(cols + 1);
    setHeaders([...headers, `Header ${cols + 1}`]);
    setCells(cells.map(row => [...row, '']));
  };

  const removeColumn = (idx: number) => {
    if (cols <= 1) return;
    setCols(cols - 1);
    setHeaders(headers.filter((_, i) => i !== idx));
    setCells(cells.map(row => row.filter((_, i) => i !== idx)));
  };

  const addRow = () => {
    setRows(rows + 1);
    setCells([...cells, Array(cols).fill('')]);
  };

  const removeRow = (idx: number) => {
    if (rows <= 2) return;
    setRows(rows - 1);
    setCells(cells.filter((_, i) => i !== idx));
  };

  const updateHeader = (idx: number, value: string) => {
    const newHeaders = [...headers];
    newHeaders[idx] = value;
    setHeaders(newHeaders);
  };

  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    const newCells = cells.map((row, ri) =>
      ri === rowIdx ? row.map((cell, ci) => (ci === colIdx ? value : cell)) : row
    );
    setCells(newCells);
  };

  const generateMarkdown = () => {
    const headerRow = `| ${headers.join(' | ')} |`;
    const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = cells.map(row => `| ${row.join(' | ')} |`).join('\n');
    return `${headerRow}\n${separatorRow}\n${dataRows}`;
  };

  const handleInsert = () => {
    onInsert(generateMarkdown());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl theme-card rounded-2xl border overflow-hidden animate-scale-in">
        <div className="flex items-center justify-between px-4 py-3 border-b theme-divider">
          <h3 className="font-semibold text-theme-primary">Insert Table</h3>
          <button onClick={onClose} className="p-1 rounded-lg theme-hover text-theme-tertiary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {headers.map((header, i) => (
                  <th key={i} className="relative group">
                    <input
                      type="text"
                      value={header}
                      onChange={e => updateHeader(i, e.target.value)}
                      className="w-full px-2 py-1.5 text-sm font-semibold theme-input border focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    {cols > 1 && (
                      <button
                        onClick={() => removeColumn(i)}
                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </th>
                ))}
                <th className="w-10">
                  <button
                    onClick={addColumn}
                    className="p-1 rounded theme-hover text-theme-tertiary"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {cells.map((row, ri) => (
                <tr key={ri} className="group">
                  {row.map((cell, ci) => (
                    <td key={ci}>
                      <input
                        type="text"
                        value={cell}
                        onChange={e => updateCell(ri, ci, e.target.value)}
                        placeholder="..."
                        className="w-full px-2 py-1.5 text-sm theme-input border placeholder:text-theme-muted focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </td>
                  ))}
                  <td className="w-10">
                    {rows > 2 && (
                      <button
                        onClick={() => removeRow(ri)}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={addRow}
            className="mt-2 flex items-center gap-1 px-2 py-1 text-xs text-theme-tertiary hover:text-indigo-500 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add row
          </button>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t theme-divider theme-bg-subtle">
          <p className="text-xs text-theme-tertiary">{cols} columns × {rows - 1} rows</p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-theme-secondary theme-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleInsert}
              className="px-4 py-2 rounded-lg text-sm font-medium accent-button"
            >
              Insert Table
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
