"use client";

import { Maximize2 } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "./button.tsx";

/** Top-right overlay control for images / diagrams / graphs. */
export function MediaFullscreenButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className="absolute top-2 right-2 z-10 bg-background/90 shadow-sm"
      data-no-source-jump=""
      data-slot="media-fullscreen-button"
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick();
      }}
      size="icon-xs"
      type="button"
      variant="outline"
    >
      <Maximize2 data-icon="inline-start" />
    </Button>
  );
}
