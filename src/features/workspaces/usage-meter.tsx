import { cn } from "@/lib/utils";

interface UsageMeterProps {
  count: number;
  limit: number;
}

/** "3 / 5 workspaces" with one pip per slot (a bar for large quotas). The limit comes from the API. */
export function UsageMeter({ count, limit }: UsageMeterProps) {
  const full = count >= limit;
  return (
    <div className="flex items-center gap-3">
      {limit <= 12 ? (
        <div aria-hidden className="flex gap-1">
          {Array.from({ length: limit }, (_, index) => (
            <span
              key={index}
              className={cn(
                "h-1.5 w-3.5 rounded-full transition-colors duration-200",
                index < count ? "bg-primary" : "bg-foreground/12",
              )}
            />
          ))}
        </div>
      ) : (
        <div aria-hidden className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/12">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${Math.min(100, (count / limit) * 100)}%` }}
          />
        </div>
      )}
      <p className="text-sm whitespace-nowrap text-muted-foreground">
        <span
          data-testid="workspace-usage"
          data-count={count}
          data-limit={limit}
          className={cn("font-medium tabular-nums", full ? "text-primary" : "text-foreground")}
        >
          {count} / {limit}
        </span>{" "}
        workspaces
      </p>
    </div>
  );
}
