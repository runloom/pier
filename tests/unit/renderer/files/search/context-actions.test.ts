import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  FILES_SEARCH_COPY_PATH_COMMAND_ID,
  FILES_SEARCH_COPY_RELATIVE_PATH_COMMAND_ID,
  FILES_SEARCH_PANEL_ID,
} from "@plugins/builtin/files/manifest.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import {
  createFilesSearchResultActions,
  registerFilesSearchLiveHit,
} from "@plugins/builtin/files/renderer/search/context-actions.ts";
import type { FileContentQueryItem } from "@shared/contracts/file/query.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const HIT: FileContentQueryItem = {
  line: 4,
  matchByteEnd: 5,
  matchByteStart: 1,
  matchCharEnd: 5,
  matchCharStart: 1,
  path: "src/main.ts",
  preview: "main()",
  previewMatchEnd: 4,
  previewMatchStart: 0,
};

function makeContext() {
  const info = vi.fn();
  const success = vi.fn();
  const context = {
    i18n: {
      t: vi.fn(
        (_key: string, _values?: unknown, fallback?: string) => fallback ?? ""
      ),
    },
    notifications: { info, success },
    panels: {
      getActiveInstanceId: vi.fn((componentId: string) =>
        componentId === FILES_SEARCH_PANEL_ID ? "search-1" : null
      ),
    },
  } as unknown as RendererPluginContext;
  return { context, info, success };
}

function actionById(
  actions: ReturnType<typeof createFilesSearchResultActions>,
  id: string
) {
  const action = actions.find((candidate) => candidate.id === id);
  if (!action) {
    throw new Error(`expected ${id}`);
  }
  return action;
}

describe("files search copy path", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    "clipboard"
  );

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(
        globalThis.navigator,
        "clipboard",
        originalClipboard
      );
    }
  });

  it("copies the live selected hit when the shortcut has no menu metadata", async () => {
    const { context, success } = makeContext();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async (text: string) => text),
      },
    });
    const dispose = registerFilesSearchLiveHit("search-1", () => ({
      ...HIT,
      root: "/repo",
      projectRoot: "/repo",
    }));
    const actions = createFilesSearchResultActions(
      context,
      {} as FileEditorController
    );

    await actionById(actions, FILES_SEARCH_COPY_PATH_COMMAND_ID).handler({
      sourcePanelId: "search-1",
    });
    await actionById(
      actions,
      FILES_SEARCH_COPY_RELATIVE_PATH_COMMAND_ID
    ).handler({
      sourcePanelId: "search-1",
    });

    expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(
      1,
      "/repo/src/main.ts"
    );
    expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(
      2,
      "src/main.ts"
    );
    expect(success).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("asks the user to select a result when nothing is active", async () => {
    const { context, info } = makeContext();
    const dispose = registerFilesSearchLiveHit("search-1", () => null);
    const actions = createFilesSearchResultActions(
      context,
      {} as FileEditorController
    );

    await actionById(actions, FILES_SEARCH_COPY_PATH_COMMAND_ID).handler({
      sourcePanelId: "search-1",
    });

    expect(info).toHaveBeenCalledWith("Select a search result first.");
    dispose();
  });
});
