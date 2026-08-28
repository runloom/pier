/**
 * DocsShell reading prefs for the files canvas preview.
 *
 * Reuses the Markdown preview prefs store (same localStorage keys), so docs
 * canvases follow the global reading size and measure passively. Docs shells
 * carry their own chrome — no floating font-scale control on the canvas
 * preview (removed 2026-08-28). The store stays in the files plugin;
 * DocsShell itself must not import it.
 */
import type { CSSProperties } from "react";
import {
  type MarkdownMeasureMode,
  useMarkdownPreviewPrefsStore,
} from "../markdown/preview-preferences.ts";
import type { CanvasStageInfo } from "./canvas-stage.ts";

export function useCanvasReadingPrefs(input: {
  stageInfo: CanvasStageInfo;
  worldActive: boolean;
}): {
  measureMode: MarkdownMeasureMode;
  readingActive: boolean;
  shellStyle: CSSProperties | undefined;
} {
  const fontScale = useMarkdownPreviewPrefsStore((state) => state.fontScale);
  const measureMode = useMarkdownPreviewPrefsStore(
    (state) => state.measureMode
  );
  const readingActive =
    input.stageInfo.docs &&
    input.stageInfo.stage === "flow" &&
    !input.stageInfo.fill &&
    !input.worldActive;

  return {
    measureMode,
    readingActive,
    shellStyle: readingActive
      ? ({ "--md-scale": String(fontScale) } as CSSProperties)
      : undefined,
  };
}
