import type { EditorView } from "@codemirror/view";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import {
  getFilesLspEditorView,
  openFilesLspAbsolutePath,
  registerFilesLspEditorView,
  registerFilesLspNavigationDeps,
  resetFilesLspNavigationForTests,
} from "@plugins/builtin/files/renderer/lsp/navigation.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("files LSP navigation", () => {
  afterEach(() => {
    resetFilesLspNavigationForTests();
    vi.useRealTimers();
  });

  it("keeps another registered view when one URI is mounted twice", () => {
    const first = { focus: vi.fn() } as unknown as EditorView;
    const second = { focus: vi.fn() } as unknown as EditorView;
    const unregisterFirst = registerFilesLspEditorView(
      "/repo/src/main.ts",
      first
    );
    const unregisterSecond = registerFilesLspEditorView(
      "/repo/src/main.ts",
      second
    );

    expect(getFilesLspEditorView("/repo/src/main.ts")).toBe(first);

    unregisterSecond();

    expect(getFilesLspEditorView("/repo/src/main.ts")).toBe(first);

    unregisterFirst();

    expect(getFilesLspEditorView("/repo/src/main.ts")).toBeNull();
  });

  it("activates source mode before waiting for an existing preview or diff panel", async () => {
    vi.useFakeTimers();
    const openInstance = vi.fn();
    const context = {
      panels: {
        listInstances: vi.fn(() => [
          {
            id: "panel-1",
            params: {
              source: { kind: "disk", path: "src/main.ts", root: "/repo" },
            },
          },
        ]),
        openInstance,
      },
    } as unknown as RendererPluginContext;
    const showSourceMode = vi.fn();
    const controller = { showSourceMode } as unknown as FileEditorController;
    const unregisterDeps = registerFilesLspNavigationDeps({
      context,
      controller,
    });

    const opening = openFilesLspAbsolutePath("/repo/src/main.ts", "/repo");

    expect(showSourceMode).toHaveBeenCalledWith("panel-1");
    expect(openInstance).toHaveBeenCalled();

    const view = { focus: vi.fn() } as unknown as EditorView;
    const unregisterView = registerFilesLspEditorView(
      "/repo/src/main.ts",
      view
    );
    await vi.advanceTimersByTimeAsync(50);
    await expect(opening).resolves.toBe(view);

    unregisterView();
    unregisterDeps();
  });
});
