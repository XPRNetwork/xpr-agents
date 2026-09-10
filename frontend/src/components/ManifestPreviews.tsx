import CsvPreview from '@/components/CsvPreview';
import JsonPreview from '@/components/JsonPreview';
import TextPreview from '@/components/TextPreview';
import { previewableFilesFromManifest, type ManifestFile } from '@/lib/ipfs';

/**
 * Inline previews for the files in a delivery manifest.
 *
 * The manifest branch used to preview only the leading image or PDF, so a track,
 * a dataset or a JSON payload delivered alongside it was reduced to a link. Each
 * file that has a renderer now gets one, in the order the agent listed them —
 * which is the order they wanted the client to read.
 *
 * Images, 3D models and PDFs are deliberately absent: the page places those itself,
 * above this, so the cover and the model viewer stay at the top.
 */
export default function ManifestPreviews({ files }: { files: ManifestFile[] }) {
  const previews = previewableFilesFromManifest(files);
  if (previews.length === 0) return null;

  return (
    <div className="space-y-4">
      {previews.map(file => {
        switch (file.kind) {
          case 'text':
            return <TextPreview key={file.uri} uri={file.uri} name={file.name} />;
          case 'json':
            return <JsonPreview key={file.uri} uri={file.uri} name={file.name} />;
          case 'csv':
            return <CsvPreview key={file.uri} uri={file.uri} name={file.name} />;
          case 'audio':
            return (
              <div key={file.uri} className="rounded-md border border-line bg-surface p-3">
                <p className="mb-2 truncate font-mono text-xs text-muted">{file.name}</p>
                <audio src={file.uri} controls preload="metadata" className="w-full" />
              </div>
            );
          case 'video':
            return (
              <div key={file.uri} className="rounded-md border border-line bg-surface p-3">
                <p className="mb-2 truncate font-mono text-xs text-muted">{file.name}</p>
                <video src={file.uri} controls preload="metadata" className="max-h-[32rem] w-full rounded" />
              </div>
            );
        }
      })}
    </div>
  );
}
