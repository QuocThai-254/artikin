import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard skeleton while the server loads the list. Screen readers hear the status text; the
 * skeleton is decorative. No `aria-busy`: on a live region it can hold back the announcement,
 * and the whole skeleton is replaced when loading ends.
 */
export default function WorkspacesLoading() {
  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-5 pt-8 pb-16 sm:px-8 sm:pt-12"
    >
      <span className="sr-only">Loading workspaces…</span>
      <div aria-hidden>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="grid gap-2.5">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex items-center gap-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
              <Skeleton className="aspect-[16/10] rounded-none" />
              <div className="grid gap-2 p-3.5">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
