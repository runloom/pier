import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID,
  FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID,
  FILES_MARKDOWN_JUMP_TO_SOURCE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
  FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
} from "@plugins/builtin/files/manifest.ts";
import {
  createFilesMarkdownPreviewActions,
  type MarkdownPreviewJumpController,
} from "@plugins/builtin/files/renderer/markdown/preview-actions.ts";
import {
  FILES_MARKDOWN_PREVIEW_SURFACE,
  readMarkdownMeasureMode,
  readMarkdownReadingAppearance,
  writeMarkdownMeasureMode,
  writeMarkdownReadingAppearance,
} from "@plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import { FILES_CANVAS_PREVIEW_SURFACE } from "@plugins/builtin/files/renderer/preview/canvas-preview-surface.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

function fakeContext(): RendererPluginContext {
  return {
    i18n: {
      t: (_key: string, _values?: unknown, fallback?: string) =>
        fallback ?? _key,
    },
  } as RendererPluginContext;
}

function fakeController() {
  const revealOffset =
    vi.fn<
      (editorSessionId: string, offset: number, documentId?: string) => void
    >();
  const setPanelMode = vi.fn<(panelId: string, mode: "source") => void>();
  return {
    revealOffset,
    setPanelMode,
  } satisfies MarkdownPreviewJumpController;
}

describe("createFilesMarkdownPreviewActions", () => {
  beforeEach(() => {
    localStorage.removeItem("pier.files.markdown.measureMode");
    localStorage.removeItem("pier.files.markdown.readingAppearance");
    writeMarkdownMeasureMode("comfortable");
    writeMarkdownReadingAppearance("auto");
  });

  it("hides the active measure and appearance items", () => {
    expect(readMarkdownMeasureMode()).toBe("comfortable");
    expect(readMarkdownReadingAppearance()).toBe("auto");
    const actions = createFilesMarkdownPreviewActions(
      fakeContext(),
      fakeController()
    );
    const measureSurfaces = [
      FILES_MARKDOWN_PREVIEW_SURFACE,
      FILES_CANVAS_PREVIEW_SURFACE,
    ];
    for (const action of actions) {
      if (
        action.id === FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID ||
        action.id === FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID
      ) {
        expect(action.surfaces).toEqual(measureSurfaces);
        continue;
      }
      expect(action.surfaces).toEqual([FILES_MARKDOWN_PREVIEW_SURFACE]);
    }

    const comfortable = actions.find(
      (action) => action.id === FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID
    );
    const wide = actions.find(
      (action) => action.id === FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID
    );
    const auto = actions.find(
      (action) => action.id === FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID
    );
    const light = actions.find(
      (action) => action.id === FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID
    );
    const dark = actions.find(
      (action) => action.id === FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID
    );

    expect(actions).toHaveLength(6);
    expect(comfortable?.metadata?.menuHidden?.()).toBe(true);
    expect(wide?.metadata?.menuHidden?.()).toBe(false);
    expect(auto?.metadata?.menuHidden?.()).toBe(true);
    expect(light?.metadata?.menuHidden?.()).toBe(false);
    expect(dark?.metadata?.menuHidden?.()).toBe(false);
    expect(comfortable?.title()).toBe("Comfortable reading");
    expect(wide?.title()).toBe("Wide reading");
    expect(auto?.title()).toBe("Match app appearance");
    expect(light?.title()).toBe("Light reading");
    expect(dark?.title()).toBe("Dark reading");
  });

  it("writes measure preferences from handlers", async () => {
    const actions = createFilesMarkdownPreviewActions(
      fakeContext(),
      fakeController()
    );
    const wide = actions.find(
      (action) => action.id === FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID
    );
    await wide?.handler();
    expect(readMarkdownMeasureMode()).toBe("wide");
    writeMarkdownMeasureMode("comfortable");
  });

  it("writes reading appearance preferences from handlers", async () => {
    const actions = createFilesMarkdownPreviewActions(
      fakeContext(),
      fakeController()
    );
    const light = actions.find(
      (action) => action.id === FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID
    );
    await light?.handler();
    expect(readMarkdownReadingAppearance()).toBe("light");

    const next = createFilesMarkdownPreviewActions(
      fakeContext(),
      fakeController()
    );
    expect(
      next
        .find(
          (action) => action.id === FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID
        )
        ?.metadata?.menuHidden?.()
    ).toBe(true);
    expect(
      next
        .find(
          (action) => action.id === FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID
        )
        ?.metadata?.menuHidden?.()
    ).toBe(false);

    writeMarkdownReadingAppearance("auto");
  });

  it("jump-to-source is hidden without a block target and jumps with one", async () => {
    const controller = fakeController();
    const actions = createFilesMarkdownPreviewActions(
      fakeContext(),
      controller
    );
    const jump = actions.find(
      (action) => action.id === FILES_MARKDOWN_JUMP_TO_SOURCE_COMMAND_ID
    );
    expect(jump?.title()).toBe("Jump to source");
    // 字典序分段：跳转排在偏好组（1_reading / 2_appearance）之前。
    expect(jump?.metadata?.group).toBe("0_jump");
    // 无 invocation / 无块 offset / 无面板 / 非法 offset → 隐藏。
    expect(jump?.metadata?.menuHidden?.()).toBe(true);
    expect(
      jump?.metadata?.menuHidden?.({
        metadata: { editorSessionId: "es-1", sourceOffset: 12 },
      })
    ).toBe(true);
    expect(
      jump?.metadata?.menuHidden?.({
        metadata: { editorSessionId: "es-1", sourceOffset: -1 },
        sourcePanelId: "panel-1",
      })
    ).toBe(true);
    const invocation = {
      metadata: {
        documentId: "doc-1",
        editorSessionId: "es-1",
        sourceOffset: 12,
      },
      sourcePanelId: "panel-1",
    };
    expect(jump?.metadata?.menuHidden?.(invocation)).toBe(false);
    await jump?.handler(invocation);
    expect(controller.setPanelMode).toHaveBeenCalledWith("panel-1", "source");
    expect(controller.revealOffset).toHaveBeenCalledWith("es-1", 12, "doc-1");
  });
});
