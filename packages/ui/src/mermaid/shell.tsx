import type { ReactNode } from "react";
import { MediaFullscreenButton } from "../image-preview/media-fullscreen-button.tsx";
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
  const surface = (
    <div
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-lg border bg-background",
        surfaceClassName,
        className
      )}
      data-presentation="card"
      data-slot="mermaid"
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
      data-slot="mermaid"
      role="img"
    >
      {text}
    </div>
  );
}
