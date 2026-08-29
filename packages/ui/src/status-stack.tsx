import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { alertVariants } from "./alert.tsx";
import { Button } from "./button.tsx";
import { StatusIcon, type StatusIconKind } from "./status-icon.tsx";
import { cn } from "./utils.ts";

export type StatusStackTone = "destructive" | "warning" | "info" | "default";

export interface StatusStackItem {
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  body?: ReactNode;
  description?: string;
  dismissible?: boolean;
  id: string;
  onDismiss?: () => void;
  title: string;
  tone: StatusStackTone;
}

const TONE_RANK: Record<StatusStackTone, number> = {
  destructive: 0,
  warning: 1,
  info: 2,
  default: 3,
};

const TONE_STATUS_ICON: Record<StatusStackTone, StatusIconKind | null> = {
  default: null,
  info: "info",
  warning: "warning",
  destructive: "error",
};

export function sortStatusStackItems(
  items: readonly StatusStackItem[]
): StatusStackItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone];
      return rank === 0 ? a.index - b.index : rank;
    })
    .map((x) => x.item);
}

export function statusStackShellTone(
  items: readonly StatusStackItem[]
): StatusStackTone {
  let best: StatusStackTone = "default";
  let bestRank = TONE_RANK.default;
  for (const item of items) {
    const rank = TONE_RANK[item.tone];
    if (rank < bestRank) {
      best = item.tone;
      bestRank = rank;
    }
  }
  return best;
}

function StatusStackItemRow({
  item,
  dismissLabel,
}: {
  item: StatusStackItem;
  dismissLabel: string;
}) {
  const iconKind = TONE_STATUS_ICON[item.tone];
  const showDismiss = item.dismissible === true;

  return (
    <div
      className={cn(
        "relative grid w-full gap-0.5 text-left text-foreground text-sm leading-5",
        iconKind
          ? "grid-cols-[auto_1fr] items-start gap-x-2.5 *:[data-slot=status-icon]:self-start"
          : null,
        // Reserve corner only for dismiss; action lives in its own footer row.
        showDismiss ? "pr-10" : null
      )}
      data-slot="status-stack-item"
      data-tone={item.tone}
    >
      {iconKind ? <StatusIcon kind={iconKind} size="md" /> : null}
      <div
        className={cn(
          "min-w-0 font-medium text-foreground",
          iconKind ? "col-start-2" : null
        )}
      >
        {item.title}
      </div>
      {item.description ? (
        <div
          className={cn(
            "min-w-0 whitespace-pre-wrap text-pretty text-muted-foreground text-sm",
            iconKind ? "col-start-2" : null
          )}
        >
          {item.description}
        </div>
      ) : null}
      {item.body ? (
        <div className={cn("min-w-0", iconKind ? "col-start-2" : null)}>
          {item.body}
        </div>
      ) : null}
      {item.action ? (
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center justify-end gap-2",
            iconKind ? "col-start-2" : null
          )}
          data-slot="status-stack-item-action"
        >
          <Button
            disabled={item.action.disabled}
            onClick={item.action.onClick}
            size="sm"
            type="button"
            variant="outline"
          >
            {item.action.label}
          </Button>
        </div>
      ) : null}
      {showDismiss ? (
        <div className="absolute top-0 right-0">
          <Button
            aria-label={dismissLabel}
            onClick={item.onDismiss}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function StatusStack({
  items,
  className,
  "data-testid": dataTestId,
  dismissLabel = "Dismiss",
}: {
  items: readonly StatusStackItem[];
  className?: string;
  "data-testid"?: string;
  /** aria-label for dismiss buttons; caller supplies i18n */
  dismissLabel?: string;
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  const sorted = sortStatusStackItems(items);
  const shellTone = statusStackShellTone(sorted);

  return (
    <section
      className={cn(
        alertVariants({
          variant: shellTone === "default" ? "default" : shellTone,
        }),
        // Override single-alert grid: stack is a vertical list of items.
        "grid-cols-1 gap-3 has-[[data-slot=status-icon]]:grid-cols-1 has-[[data-slot=status-icon]]:gap-x-0",
        className
      )}
      data-shell-tone={shellTone}
      data-slot="status-stack"
      data-testid={dataTestId}
    >
      {sorted.map((item) => (
        <StatusStackItemRow
          dismissLabel={dismissLabel}
          item={item}
          key={item.id}
        />
      ))}
    </section>
  );
}
