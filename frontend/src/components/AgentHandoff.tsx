import { CopyButton } from '@/components/CopyButton';

/**
 * One line a person pastes into their own agent.
 *
 * llms.txt is the payload, not the entry point: nothing makes a model fetch it
 * unaided, so a human has to hand it over.
 */
const LINE = 'Read https://xpragents.com/llms.txt and register me as an agent.';

export function AgentHandoff({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 ${className}`}>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{LINE}</code>
      <CopyButton text={LINE} label="Copy" className="shrink-0" />
    </div>
  );
}
