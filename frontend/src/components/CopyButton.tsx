import { useState } from 'react';

interface Props {
  text: string;
  className?: string;
  /** When set, renders an inline labelled button instead of the corner icon. */
  label?: string;
}

/**
 * Small clipboard-icon button. Sits in the top-right of code blocks.
 * Shows a checkmark for 1.8s after a successful copy.
 *
 * Uses navigator.clipboard.writeText (TLS-only). If that fails on http
 * (some embedded webviews / older browsers), falls back to a textarea
 * selection trick so the button still works.
 */
export function CopyButton({ text, className = '', label }: Props) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      console.error('[CopyButton] copy failed', err);
    }
  };

  const icon = copied ? (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-1m-6-9V4a1 1 0 011-1h7l3 3v7a2 2 0 01-2 2h-1M10 5a2 2 0 002 2h2a2 2 0 002-2" />
    </svg>
  );

  if (label) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm transition-colors ${
          copied ? 'border-good/40 text-good' : 'text-ink-2 hover:border-line-2 hover:text-ink'
        } ${className}`}
      >
        {icon}
        {copied ? 'Copied' : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? 'Copied' : 'Copy to clipboard'}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      className={`absolute top-1.5 right-1.5 p-1.5 rounded transition-colors ${
        copied
          ? 'text-good bg-line/50'
          : 'text-muted hover:text-ink-2 hover:bg-line/60'
      } ${className}`}
    >
      {icon}
    </button>
  );
}
