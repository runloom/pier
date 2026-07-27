/**
 * Bind editor minimap setting and code-font appearance to live CM sessions.
 */
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FILES_EDITOR_MINIMAP_SETTING_KEY } from "../settings.ts";
import type { FileEditorViewCoordinator } from "./file-editor-view-coordinator.ts";

export function readMinimapEnabled(
  context: Pick<RendererPluginContext, "configuration">
): boolean {
  return (
    context.configuration.get<boolean>(FILES_EDITOR_MINIMAP_SETTING_KEY) !==
    false
  );
}

export function bindMinimapSetting(input: {
  context: Pick<RendererPluginContext, "configuration">;
  onEnabled: (enabled: boolean) => void;
  views: FileEditorViewCoordinator;
}): () => void {
  return input.context.configuration.onDidChange((event) => {
    if (!event.affectsConfiguration(FILES_EDITOR_MINIMAP_SETTING_KEY)) {
      return;
    }
    const enabled = readMinimapEnabled(input.context);
    input.onEnabled(enabled);
    for (const session of input.views.values()) {
      session.setMinimapEnabled(enabled);
    }
  });
}

export function bindCodeFontAppearance(input: {
  context: Pick<RendererPluginContext, "appearance">;
  getLast: () => { family: string; size: string };
  setLast: (family: string, size: string) => void;
  views: FileEditorViewCoordinator;
}): () => void {
  // CodeMirror theme uses CSS vars for mono family / code size; CM6 caches
  // line geometry until requestMeasure after external style changes.
  return input.context.appearance.onDidChange((next) => {
    const { codeFontFamily, codeFontSize } = next.typography;
    const last = input.getLast();
    if (codeFontFamily === last.family && codeFontSize === last.size) {
      return;
    }
    input.setLast(codeFontFamily, codeFontSize);
    input.views.requestMeasureAll();
  });
}
