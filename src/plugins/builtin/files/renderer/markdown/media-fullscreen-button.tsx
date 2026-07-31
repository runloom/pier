import { Button } from "@pier/ui/button.tsx";
import { Maximize2 } from "lucide-react";
import type { MouseEvent } from "react";

/** Top-right overlay control for Markdown images / diagrams. */
export function MarkdownMediaFullscreenButton({
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
