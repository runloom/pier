import type { MouseEvent, ReactNode } from "react";
import { MediaFullscreenButton } from "../image-preview/media-fullscreen-button.tsx";
import { isPlainSurfaceClick } from "../media/surface-open.ts";
import { cn } from "../utils.ts";

export function FlowGraphShell({
  "aria-label": ariaLabel,
  children,
  className,
  expandLabel,
  keyboardSelectable,
  onOpenFullscreen,
  showExpand,
}: {
  "aria-label": string;
  children: ReactNode;
  className?: string | undefined;
  expandLabel: string;
  keyboardSelectable: boolean;
  onOpenFullscreen?: (() => void) | undefined;
  showExpand: boolean;
}) {
  const openFromSurface = (event: MouseEvent<HTMLDivElement>): void => {
    if (!isPlainSurfaceClick(event.target)) {
      return;
    }
    onOpenFullscreen?.();
  };
  const surface = (
    // biome-ignore lint/a11y/noStaticElementInteractions: redundant pointer shortcut; keyboard path is the visible expand button
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: redundant pointer shortcut; keyboard path is the visible expand button
    // biome-ignore lint/a11y/useKeyWithClickEvents: redundant pointer shortcut; keyboard path is the visible expand button
    <div
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-lg border bg-background",
        showExpand && "cursor-zoom-in",
        className
      )}
      data-presentation="card"
      data-slot="flow-graph"
      onClick={showExpand ? openFromSurface : undefined}
    >
      {children}
      {showExpand ? (
        <MediaFullscreenButton
          label={expandLabel}
          onClick={() => onOpenFullscreen?.()}
        />
      ) : null}
    </div>
  );
  if (keyboardSelectable) {
    return (
      <div
        aria-label={ariaLabel}
        className="min-w-0"
        data-slot="flow-graph-root"
        role="application"
      >
        {surface}
      </div>
    );
  }
  return (
    <div
      aria-label={ariaLabel}
      className="min-w-0"
      data-slot="flow-graph-root"
      role="img"
    >
      {surface}
    </div>
  );
}

export function FlowGraphEmpty({
  "aria-label": ariaLabel,
  className,
  isStage,
  text,
}: {
  "aria-label": string;
  className?: string | undefined;
  isStage: boolean;
  text: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "grid min-h-48 place-items-center bg-background text-muted-foreground text-sm",
        !isStage && "rounded-lg border border-dashed bg-muted/30",
        className
      )}
      data-slot="flow-graph"
      role="img"
    >
      {text}
    </div>
  );
}
