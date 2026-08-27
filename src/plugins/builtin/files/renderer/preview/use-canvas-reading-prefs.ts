/**
 * DocsShell reading chrome for the files canvas preview.
 *
 * Reuses the Markdown preview prefs store (same localStorage keys). The store
 * stays in the files plugin; DocsShell itself must not import it.
 */
import type { CSSProperties } from "react";
import { createElement } from "react";
import type { FilesTranslate } from "../i18n.ts";
import { MarkdownPreviewFontScaleControl } from "../markdown/preview-font-scale.tsx";
import {
  type MarkdownFontScale,
  type MarkdownMeasureMode,
  useMarkdownPreviewPrefsStore,
} from "../markdown/preview-preferences.ts";
import type { CanvasStageInfo } from "./canvas-stage.ts";

function zoomLabels(t: FilesTranslate): {
  reset: string;
  zoomIn: string;
  zoomOut: string;
} {
  return {
    reset: t("filePanel.markdown.zoom.reset", "Reset text size"),
    zoomIn: t("filePanel.markdown.zoom.in", "Increase text size"),
    zoomOut: t("filePanel.markdown.zoom.out", "Decrease text size"),
  };
}

export function useCanvasReadingPrefs(input: {
  stageInfo: CanvasStageInfo;
  t: FilesTranslate;
  worldActive: boolean;
}): {
  fontScale: MarkdownFontScale;
  measureMode: MarkdownMeasureMode;
  readingActive: boolean;
  setFontScale: (scale: MarkdownFontScale) => void;
  shellStyle: CSSProperties | undefined;
  zoomLabels: ReturnType<typeof zoomLabels>;
} {
  const fontScale = useMarkdownPreviewPrefsStore((state) => state.fontScale);
  const measureMode = useMarkdownPreviewPrefsStore(
    (state) => state.measureMode
  );
  const setFontScale = useMarkdownPreviewPrefsStore(
    (state) => state.setFontScale
  );
  const readingActive =
    input.stageInfo.docs &&
    input.stageInfo.stage === "flow" &&
    !input.stageInfo.fill &&
    !input.worldActive;

  return {
    fontScale,
    measureMode,
    readingActive,
    setFontScale,
    shellStyle: readingActive
      ? ({ "--md-scale": String(fontScale) } as CSSProperties)
      : undefined,
    zoomLabels: zoomLabels(input.t),
  };
}

export function CanvasReadingChrome({
  fontScale,
  readingActive,
  setFontScale,
  zoomLabels,
}: ReturnType<typeof useCanvasReadingPrefs>) {
  if (!readingActive) {
    return null;
  }
  return createElement(MarkdownPreviewFontScaleControl, {
    fontScale,
    labels: zoomLabels,
    onChange: setFontScale,
  });
}
