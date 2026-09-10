import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

interface FriendlyAiOutputProps {
  content: string;
  className?: string;
}

/**
 * Strips hidden reasoning / thinking tags from LLM responses
 * e.g., <think>...</think>, <thought>...</thought>, [thinking]...[/thinking]
 */
export function sanitizeAiText(raw: string): string {
  if (!raw) return '';
  let text = raw;
  // Remove full thinking tags
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  text = text.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '');
  // Remove orphaned closing or opening tags
  text = text.replace(/<\/?(?:think|thought)>/gi, '');
  return text.trim();
}

/**
 * Friendly AI Output Renderer
 * Safely renders markdown into clean visual elements without exposing raw symbols.
 * Headings, bold, lists, tables, and code blocks render beautifully.
 */
export default function FriendlyAiOutput({ content, className = '' }: FriendlyAiOutputProps) {
  const sanitized = sanitizeAiText(content);

  return (
    <div className={`friendly-ai-output text-sm leading-6 text-theme-primary select-text break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-3.5 mb-2 text-lg font-extrabold text-theme-primary tracking-tight">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1.5 text-base font-bold text-theme-primary tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2.5 mb-1 text-sm font-bold text-theme-primary">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-2 text-sm leading-6 text-theme-primary last:mb-0">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mb-2.5 list-disc pl-5 space-y-1 text-sm text-theme-primary">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2.5 list-decimal pl-5 space-y-1 text-sm text-theme-primary">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-6 text-theme-primary">
              {children}
            </li>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-theme-primary">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-theme-primary">
              {children}
            </em>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-4 border-indigo-500/40 pl-3 italic text-theme-secondary">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-xl border theme-border">
              <table className="min-w-full divide-y theme-divider text-xs">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[var(--input-bg)] text-theme-primary font-semibold">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-theme-secondary border-b theme-border">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-xs text-theme-secondary border-b theme-border last:border-b-0">
              {children}
            </td>
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const isInline = !codeClassName && typeof children === 'string' && !children.includes('\n');
            if (isInline) {
              return (
                <code
                  className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold bg-[var(--input-bg)] text-indigo-600 dark:text-indigo-400"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock language={match?.[1] || ''}>{String(children).replace(/\n$/, '')}</CodeBlock>;
          },
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border theme-border" style={{ backgroundColor: 'var(--card-bg)' }}>
      <div className="flex items-center justify-between border-b theme-divider px-3 py-1.5 bg-[var(--input-bg)]">
        <span className="font-mono text-[11px] font-bold uppercase text-theme-tertiary">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-theme-secondary hover:text-theme-primary theme-hover"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs text-theme-primary leading-5">
        <code>{children}</code>
      </pre>
    </div>
  );
}
