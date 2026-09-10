import { useMemo, useState } from 'react';
import PreviewShell from '@/components/PreviewShell';
import { useRemoteFile } from '@/lib/use-remote-file';

const MAX_BYTES = 1024 * 1024;
/** Objects and arrays start open to this depth; deeper ones are collapsed. */
const OPEN_DEPTH = 2;

/** "73 items" / "12 keys" — how big a branch is, without opening it. */
function countLabel(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  const keys = Object.keys(value as object);
  return `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`;
}

function summarise(value: unknown): string {
  return `${Array.isArray(value) ? '[]' : '{}'} ${countLabel(value)}`;
}

/** A leaf value, coloured by type so numbers and strings are distinguishable at a glance. */
function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted">null</span>;
  switch (typeof value) {
    case 'number':
    case 'bigint':
      return <span className="text-accent">{String(value)}</span>;
    case 'boolean':
      return <span className="text-warn">{String(value)}</span>;
    default:
      return <span className="text-good break-all">&quot;{String(value)}&quot;</span>;
  }
}

function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const branch = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < OPEN_DEPTH);

  const label = name !== undefined ? <span className="text-ink">{name}</span> : null;

  if (!branch) {
    return (
      <div className="flex gap-2 py-[1px]">
        {label}
        {label && <span className="text-muted">:</span>}
        <Scalar value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div className="py-[1px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 text-left hover:text-ink"
      >
        <span className="w-3 shrink-0 text-muted">{open ? '▾' : '▸'}</span>
        {label}
        {label && <span className="text-muted">:</span>}
        <span className="text-muted">{summarise(value)}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-line pl-3">
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A delivered JSON file, as a collapsible tree.
 *
 * JSON is the second most common thing agents deliver and it had no preview at
 * all — the machine-readable half of a report was a filename and a link. A tree
 * beats a pretty-printed blob here because these files are wide: a client wants
 * to see the top-level shape first and open only the branch they care about.
 *
 * Values come from an agent, so nothing is interpreted — keys and values render
 * as text, never as markup.
 */
export default function JsonPreview({ uri, name }: { uri: string; name: string }) {
  const { state, text } = useRemoteFile(uri, MAX_BYTES);
  const parsed = useMemo(() => {
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }, [text]);

  if (state === 'failed') return null;
  // Not valid JSON despite the type: show the bytes rather than claim a shape.
  if (state === 'ready' && parsed === undefined) {
    return (
      <PreviewShell name={name} uri={uri}>
        <div className="whitespace-pre-wrap p-4 font-mono text-xs text-ink-2">{text}</div>
      </PreviewShell>
    );
  }

  const meta = parsed !== null && typeof parsed === 'object' ? countLabel(parsed) : undefined;

  return (
    <PreviewShell name={name} uri={uri} loading={state === 'loading'} meta={meta}>
      <div className="p-4 font-mono text-xs text-ink-2">
        {parsed !== undefined && <Node value={parsed} depth={0} />}
      </div>
    </PreviewShell>
  );
}
