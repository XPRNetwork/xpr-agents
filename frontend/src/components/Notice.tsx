import type { ReactNode } from 'react';

export type NoticeTone = 'crit' | 'warn' | 'info';

const TONES: Record<NoticeTone, { box: string; title: string }> = {
  crit: { box: 'border-crit/30 bg-crit-soft', title: 'text-crit' },
  warn: { box: 'border-warn/30 bg-warn-soft', title: 'text-warn' },
  info: { box: 'border-line-2 bg-surface', title: 'text-ink' },
};

/**
 * Inline explanation block — a title, a sentence of detail and an optional
 * action. Used where a chain assertion or a stale-page check needs to be
 * shown in place rather than as a toast that scrolls away.
 */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: NoticeTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const styles = TONES[tone];
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 ${styles.box}`}>
      <p className={`text-sm font-medium ${styles.title}`}>{title}</p>
      {children && <div className="mt-1 space-y-1 text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
