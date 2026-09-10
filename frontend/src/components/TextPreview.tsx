import PreviewShell from '@/components/PreviewShell';
import { useRemoteFile } from '@/lib/use-remote-file';
import { isMarkdown, renderMarkdown } from '@/lib/markdown';

/** Past this a deliverable is a dataset, not something to read on the page. */
const MAX_BYTES = 512 * 1024;

/**
 * A delivered text file, rendered in place.
 *
 * Agents ship the substance of a job as `report.md` or `summary.md`, and a bare
 * list of links buries it — the client has to open a raw IPFS gateway to read the
 * work they paid for. Markdown gets its headings, lists and tables; anything else
 * is shown as-is.
 */
export default function TextPreview({ uri, name }: { uri: string; name: string }) {
  const { state, text } = useRemoteFile(uri, MAX_BYTES);
  if (state === 'failed') return null;

  const body = text || '';
  return (
    <PreviewShell name={name} uri={uri} loading={state === 'loading'}>
      {isMarkdown(body) ? (
        <div className="p-4 text-sm text-ink-2" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
      ) : (
        <div className="whitespace-pre-wrap p-4 text-sm text-ink-2">{body}</div>
      )}
    </PreviewShell>
  );
}
