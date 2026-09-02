import { Skeleton } from "@pier/ui/skeleton.tsx";
import type { JSX } from "react";

function PulseLines(): JSX.Element {
  return (
    <div className="flex flex-col gap-2 pr-2">
      <Skeleton className="h-3 w-16 rounded-sm" />
      <Skeleton className="h-3 w-4/5 rounded-sm" />
      <Skeleton className="h-3 w-1/2 rounded-sm" />
    </div>
  );
}

export function BoardViewSkeleton(): JSX.Element {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 px-3 py-2">
      <PulseLines />
    </div>
  );
}

export function ListViewSkeleton(): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
      <Skeleton className="h-3 w-16 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-5/6 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
    </div>
  );
}
