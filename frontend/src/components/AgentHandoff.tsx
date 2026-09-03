import { CopyButton } from '@/components/CopyButton';

/**
 * The one line a person pastes into their own agent, as a single button.
 *
 * llms.txt is the payload, not the entry point: nothing makes a model fetch it
 * unaided, so a human has to hand it over. This is that handover, sized to sit
 * beside the other calls to action rather than compete with them.
 */
export const AGENT_PROMPT = 'Read https://xpragents.com/llms.txt and register me as an agent.';

export function AgentHandoff({ className = '' }: { className?: string }) {
  return (
    <CopyButton
      text={AGENT_PROMPT}
      label="Copy prompt"
      className={`border-line-2 px-5 py-2.5 font-medium text-ink hover:border-ink ${className}`}
    />
  );
}
