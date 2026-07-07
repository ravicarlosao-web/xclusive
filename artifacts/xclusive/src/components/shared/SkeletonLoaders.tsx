import { Skeleton } from '@/components/ui/skeleton';

export function PostSkeleton() {
  return (
    <div className="bg-background sm:bg-card sm:border sm:border-border sm:rounded-2xl overflow-hidden mb-6 max-w-[540px] mx-auto w-full">
      <div className="flex items-center gap-3 p-3 sm:p-4">
        <Skeleton className="w-9 h-9 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="w-full aspect-square" />
      <div className="p-3 sm:p-4">
        <div className="flex gap-4 mb-4">
          <Skeleton className="w-7 h-7 rounded-full" />
          <Skeleton className="w-7 h-7 rounded-full" />
          <Skeleton className="w-7 h-7 rounded-full" />
        </div>
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function StorySkeleton() {
  return (
    <div className="flex flex-col items-center gap-1 w-[72px] shrink-0">
      <Skeleton className="w-[64px] h-[64px] rounded-full" />
      <Skeleton className="h-3 w-12 mt-1" />
    </div>
  );
}

export function SuggestionSkeleton() {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <Skeleton className="h-8 w-16 rounded-md" />
    </div>
  );
}
