import { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

interface Props {
  /**
   * The text the copy button will put on the clipboard. Pass the raw
   * command string (without UI-only prompts like `$ ` or syntax
   * highlighting) so paste-and-run works.
   */
  copyText: string;
  /**
   * What's rendered inside the block. Usually the same as copyText or
   * a slightly prettier version (multi-line layout, syntax hints).
   */
  children: ReactNode;
  className?: string;
  /**
   * If true, render the children as inline `<code>` text with no
   * background — for single short commands. Default false (block).
   */
  inline?: boolean;
}

/**
 * Code block with a copy button in the top-right corner.
 * Wraps the existing `bg-surface-2` styling so existing pages can
 * swap in-place with no design change.
 */
export function CodeBlock({ copyText, children, className = '', inline = false }: Props) {
  if (inline) {
    return (
      <span className={`relative inline-flex items-center gap-1.5 ${className}`}>
        <code className="text-ink-2 bg-surface-2 px-2 py-0.5 rounded text-xs">{children}</code>
        <span className="relative inline-block w-6 h-6">
          <CopyButton text={copyText} className="!top-0 !right-0 !p-1" />
        </span>
      </span>
    );
  }
  return (
    <div
      className={`relative bg-surface-2 text-ink-2 text-xs p-3 pr-10 rounded-lg overflow-x-auto ${className}`}
    >
      {children}
      <CopyButton text={copyText} />
    </div>
  );
}
