import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { ModelFile } from '@/lib/ipfs';

// three.js touches `window` on import — keep it out of the server bundle.
const ModelViewer = dynamic(() => import('@/components/ModelViewer').then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => (
    <div className="flex h-[26rem] items-center justify-center rounded-lg border border-line bg-surface">
      <span className="text-xs text-muted">Loading 3D viewer…</span>
    </div>
  ),
});

interface ModelGalleryProps {
  files: ModelFile[];
  heightClass?: string;
}

/** One or more GLB/GLTF deliverables, with a tab per file when there's more than one. */
export function ModelGallery({ files, heightClass }: ModelGalleryProps) {
  const [active, setActive] = useState(0);
  if (files.length === 0) return null;

  const index = Math.min(active, files.length - 1);
  const file = files[index];

  return (
    <div>
      {files.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {files.map((f, i) => (
            <button
              key={f.url}
              type="button"
              onClick={() => setActive(i)}
              className={`max-w-[14rem] truncate rounded-md border px-2 py-1 text-xs transition-colors ${
                i === index
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-surface text-ink-2 hover:border-line-2 hover:text-ink'
              }`}
              title={f.name}
            >
              {f.name || `Model ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <ModelViewer key={file.url} url={file.url} name={file.name} heightClass={heightClass} />
    </div>
  );
}

export default ModelGallery;
