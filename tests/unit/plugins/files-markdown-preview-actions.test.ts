import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
  FILES_MARKDOWN_TOC_LEFT_COMMAND_ID,
  FILES_MARKDOWN_TOC_RIGHT_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import { createFilesMarkdownPreviewActions } from "@plugins/builtin/files/renderer/files-markdown-preview-actions.ts";
import {
  FILES_MARKDOWN_PREVIEW_SURFACE,
  readMarkdownMeasureMode,
  readMarkdownTocSide,
  writeMarkdownMeasureMode,
  writeMarkdownTocSide,
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
    localStorage.removeItem("pier.files.markdown.tocSide");
  });

  it("defaults toc to right and hides the active measure/side items", () => {
    expect(readMarkdownTocSide()).toBe("right");
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
    const left = actions.find(
      (action) => action.id === FILES_MARKDOWN_TOC_LEFT_COMMAND_ID
    );
    const right = actions.find(
      (action) => action.id === FILES_MARKDOWN_TOC_RIGHT_COMMAND_ID
    );

    expect(comfortable?.metadata?.menuHidden?.()).toBe(true);
    expect(wide?.metadata?.menuHidden?.()).toBe(false);
    expect(comfortable?.title()).toBe("Comfortable reading");
    expect(wide?.title()).toBe("Wide reading");
    expect(left?.title()).toBe("Move outline left");
    expect(right?.title()).toBe("Move outline right");
    expect(
      left?.metadata?.menuHidden?.({ metadata: { hasHeadings: true } })
    ).toBe(false);
    expect(
      right?.metadata?.menuHidden?.({ metadata: { hasHeadings: true } })
    ).toBe(true);
    expect(
      left?.metadata?.menuHidden?.({ metadata: { hasHeadings: false } })
    ).toBe(true);
  });

  it("writes measure and toc preferences from handlers", async () => {
    const actions = createFilesMarkdownPreviewActions(fakeContext());
    const wide = actions.find(
      (action) => action.id === FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID
    );
    const left = actions.find(
      (action) => action.id === FILES_MARKDOWN_TOC_LEFT_COMMAND_ID
    );
    await wide?.handler();
    await left?.handler();
    expect(readMarkdownMeasureMode()).toBe("wide");
    expect(readMarkdownTocSide()).toBe("left");
    writeMarkdownMeasureMode("comfortable");
    writeMarkdownTocSide("right");
  });
});
