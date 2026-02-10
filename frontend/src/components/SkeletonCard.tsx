export function SkeletonCard() {
  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900">
      {/* Gradient top bar placeholder */}
      <div className="h-0.5 skeleton-shimmer" />
      <div className="p-4">
        {/* Header row */}
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="h-5 w-32 skeleton-shimmer rounded" />
            <div className="h-3 w-20 skeleton-shimmer rounded mt-2" />
          </div>
          <div className="w-8 h-8 skeleton-shimmer rounded-full" />
        </div>

        {/* Description */}
        <div className="mt-3 space-y-2">
          <div className="h-3 w-full skeleton-shimmer rounded" />
          <div className="h-3 w-3/4 skeleton-shimmer rounded" />
        </div>

        {/* Tags */}
        <div className="mt-3 flex gap-1">
          <div className="h-6 w-16 skeleton-shimmer rounded-full" />
          <div className="h-6 w-20 skeleton-shimmer rounded-full" />
          <div className="h-6 w-14 skeleton-shimmer rounded-full" />
        </div>

        {/* Stats row */}
        <div className="mt-4 flex justify-between">
          <div className="h-3 w-24 skeleton-shimmer rounded" />
          <div className="h-3 w-16 skeleton-shimmer rounded" />
        </div>
      </div>
    </div>
  );
}
