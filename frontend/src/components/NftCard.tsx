import { NftAsset, getNftImageUrl, getNftMarketplaceUrl } from '@/lib/registry';

interface NftCardProps {
  asset: NftAsset;
  compact?: boolean;
}

export function NftCard({ asset, compact }: NftCardProps) {
  const imageUrl = getNftImageUrl(asset.image);
  const marketplaceUrl = getNftMarketplaceUrl(asset.collection_name, asset.template_id);

  return (
    <a
      href={marketplaceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-xl border border-zinc-800 bg-zinc-900 hover:border-purple-500/50 transition-all overflow-hidden group ${
        compact ? '' : ''
      }`}
    >
      {/* Image */}
      <div className={`bg-zinc-800 overflow-hidden ${compact ? 'h-36' : 'h-48'}`}>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={asset.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}
        <div className={`${imageUrl ? 'hidden' : ''} w-full h-full flex items-center justify-center text-zinc-600`}>
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      </div>

      {/* Info */}
      <div className={compact ? 'p-3' : 'p-4'}>
        <h4 className={`font-semibold text-white group-hover:text-purple-400 transition-colors truncate ${
          compact ? 'text-sm' : 'text-base'
        }`}>
          {asset.name}
        </h4>
        <div className="flex justify-between items-center mt-1">
          <span className="text-xs text-zinc-500 truncate">{asset.collection_name}</span>
          <span className="text-xs text-zinc-600 font-mono">#{asset.asset_id}</span>
        </div>
      </div>
    </a>
  );
}
