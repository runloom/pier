import {
  type KeyboardEvent as ReactKeyboardEvent,
  type WheelEvent as ReactWheelEvent,
  useCallback,
} from "react";
import {
  cycleMarkdownFontScale,
  type MarkdownFontScale,
  writeMarkdownFontScale,
} from "./preview-preferences.ts";

export function useMarkdownPreviewZoom(fontScale: MarkdownFontScale): {
  applyFontScale: (next: MarkdownFontScale) => void;
  handlePreviewKeyDown: (
    event: ReactKeyboardEvent<HTMLDivElement>,
    onUnhandled: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  ) => void;
  handlePreviewWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
} {
  const applyFontScale = useCallback((next: MarkdownFontScale) => {
    writeMarkdownFontScale(next);
  }, []);

  const handlePreviewKeyDown = useCallback(
    (
      event: ReactKeyboardEvent<HTMLDivElement>,
      onUnhandled: (event: ReactKeyboardEvent<HTMLDivElement>) => void
    ) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !isPreviewEditableTarget(event.target)
      ) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          event.stopPropagation();
          applyFontScale(cycleMarkdownFontScale(fontScale, "in"));
          return;
        }
        if (event.key === "-" || event.key === "_") {
          event.preventDefault();
          event.stopPropagation();
          applyFontScale(cycleMarkdownFontScale(fontScale, "out"));
          return;
        }
        if (event.key === "0" && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          applyFontScale(1);
          return;
        }
      }
      onUnhandled(event);
    },
    [applyFontScale, fontScale]
  );

  const handlePreviewWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return;
      if (isPreviewEditableTarget(event.target)) return;
      event.preventDefault();
      applyFontScale(
        cycleMarkdownFontScale(fontScale, event.deltaY < 0 ? "in" : "out")
      );
    },
    [applyFontScale, fontScale]
  );

  return { applyFontScale, handlePreviewKeyDown, handlePreviewWheel };
}

function isPreviewEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='textbox']"
    )
  );
}
