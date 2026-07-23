import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import { createFilesMarkdownPreviewActions } from "@plugins/builtin/files/renderer/files-markdown-preview-actions.ts";
import {
  FILES_MARKDOWN_PREVIEW_SURFACE,
  readMarkdownMeasureMode,
  writeMarkdownMeasureMode,
} from "@plugins/builtin/files/renderer/markdown-preview-preferences.ts";
import { beforeEach, describe, expect, it } from "vitest";

function fakeContext(): RendererPluginContext {
  return {
    i18n: {
      t: (_key: string, _values?: unknown, fallback?: string) =>
        fallback ?? _key,
    },
  } as RendererPluginContext;
}

describe("createFilesMarkdownPreviewActions", () => {
  beforeEach(() => {
    localStorage.removeItem("pier.files.markdown.measureMode");
  });

  it("hides the active measure item and has no outline side actions", () => {
    expect(readMarkdownMeasureMode()).toBe("comfortable");
    const actions = createFilesMarkdownPreviewActions(fakeContext());
    for (const action of actions) {
      expect(action.surfaces).toEqual([FILES_MARKDOWN_PREVIEW_SURFACE]);
    }

    const comfortable = actions.find(
      (action) => action.id === FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID
    );
    const wide = actions.find(
      (action) => action.id === FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID
    );

    expect(actions).toHaveLength(2);
    expect(comfortable?.metadata?.menuHidden?.()).toBe(true);
    expect(wide?.metadata?.menuHidden?.()).toBe(false);
    expect(comfortable?.title()).toBe("Comfortable reading");
    expect(wide?.title()).toBe("Wide reading");
  });

  it("writes measure preferences from handlers", async () => {
    const actions = createFilesMarkdownPreviewActions(fakeContext());
    const wide = actions.find(
      (action) => action.id === FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID
    );
    await wide?.handler();
    expect(readMarkdownMeasureMode()).toBe("wide");
    writeMarkdownMeasureMode("comfortable");
  });
});
