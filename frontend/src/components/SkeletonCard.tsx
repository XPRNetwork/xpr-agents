export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-line bg-canvas p-5" aria-hidden="true">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 skeleton-shimmer rounded-full" />
        <div className="flex-1">
          <div className="h-4 w-32 skeleton-shimmer rounded" />
          <div className="mt-2 h-3 w-20 skeleton-shimmer rounded" />
        </div>
        <div className="h-4 w-6 skeleton-shimmer rounded" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full skeleton-shimmer rounded" />
        <div className="h-3 w-3/4 skeleton-shimmer rounded" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-16 skeleton-shimmer rounded-md" />
        <div className="h-5 w-20 skeleton-shimmer rounded-md" />
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <div className="h-[5px] w-full skeleton-shimmer rounded-[2px]" />
        <div className="mt-2 flex justify-between">
          <div className="h-3 w-16 skeleton-shimmer rounded" />
          <div className="h-3 w-20 skeleton-shimmer rounded" />
        </div>
      </div>
    </div>
  );
}
