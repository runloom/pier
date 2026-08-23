import type { MouseEvent, ReactNode } from "react";
import { MediaFullscreenButton } from "../image-preview/media-fullscreen-button.tsx";
import { isPlainSurfaceClick } from "../media/surface-open.ts";
import { cn } from "../utils.ts";

export function MermaidShell({
  "aria-label": ariaLabel,
  children,
  className,
  expandLabel,
  keyboardSelectable,
  onOpenFullscreen,
  showExpand,
  surfaceClassName,
}: {
  "aria-label": string;
  children: ReactNode;
  className?: string | undefined;
  expandLabel: string;
  keyboardSelectable: boolean;
  onOpenFullscreen?: (() => void) | undefined;
  showExpand: boolean;
  surfaceClassName?: string | undefined;
}) {
  const openFromSurface = (event: MouseEvent<HTMLDivElement>): void => {
    // Whole-card click opens fullscreen preview; the shared guard keeps
    // node buttons, content-slot controls, links, and finished text
    // selections from triggering it.
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
        surfaceClassName,
        className
      )}
      data-presentation="card"
      data-slot="mermaid"
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
        data-slot="mermaid-root"
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
      data-slot="mermaid-root"
      role="img"
    >
      {surface}
    </div>
  );
}

export function MermaidEmpty({
  "aria-label": ariaLabel,
  isStage,
  text,
  className,
}: {
  "aria-label": string;
  isStage: boolean;
  text: string;
  className?: string | undefined;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn(
        "grid min-h-48 place-items-center bg-background text-muted-foreground text-sm",
        !isStage && "rounded-lg border border-dashed bg-muted/30",
        className
      )}
      data-slot="mermaid"
      role="img"
    >
      {text}
    </div>
  );
}
