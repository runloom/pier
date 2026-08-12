import type { EditorView } from "@codemirror/view";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/editor/controller.ts";
import {
  absolutePathForFilesLspEditorView,
  getFilesLspEditorView,
  openFilesLspAbsolutePath,
  registerFilesLspEditorView,
  registerFilesLspNavigationDeps,
  resetFilesLspNavigationForTests,
  rootPathForFilesLspEditorView,
} from "@plugins/builtin/files/renderer/lsp/navigation.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("files LSP navigation", () => {
  afterEach(() => {
    resetFilesLspNavigationForTests();
    vi.useRealTimers();
  });

  it("reverse-looks up absolute path and root without an LSP connection", () => {
    const view = { focus: vi.fn() } as unknown as EditorView;
    const unregister = registerFilesLspEditorView(
      "/repo/src/renderer/app/globals.css",
      view,
      "/repo"
    );
    expect(absolutePathForFilesLspEditorView(view)).toBe(
      "/repo/src/renderer/app/globals.css"
    );
    expect(rootPathForFilesLspEditorView(view)).toBe("/repo");
    unregister();
    expect(absolutePathForFilesLspEditorView(view)).toBeNull();
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

  it("always opens the disk panel (activates tab + tree reveal) even when view exists", async () => {
    vi.useFakeTimers();
    const openInEditor = vi.fn(() => true);
    const context = {
      files: { openInEditor },
      panels: {
        listInstances: vi.fn(() => [
          {
            id: "panel-1",
            params: {
              source: { kind: "disk", path: "src/main.ts", root: "/repo" },
            },
          },
        ]),
      },
    } as unknown as RendererPluginContext;
    const showSourceMode = vi.fn();
    const controller = { showSourceMode } as unknown as FileEditorController;
    const unregisterDeps = registerFilesLspNavigationDeps({
      context,
      controller,
    });

    const view = { focus: vi.fn() } as unknown as EditorView;
    const unregisterView = registerFilesLspEditorView(
      "/repo/src/main.ts",
      view
    );

    const opening = openFilesLspAbsolutePath("/repo/src/main.ts", "/repo");
    await vi.advanceTimersByTimeAsync(0);
    const resolved = await opening;

    expect(openInEditor).toHaveBeenCalledWith({
      path: "src/main.ts",
      root: "/repo",
    });
    expect(showSourceMode).toHaveBeenCalledWith("panel-1");
    expect(resolved).toBe(view);
    expect(view.focus).toHaveBeenCalled();

    unregisterView();
    unregisterDeps();
  });

  it("activates source mode and opens disk path for a cold panel", async () => {
    vi.useFakeTimers();
    const openInEditor = vi.fn(() => true);
    const listInstances = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValue([
        {
          id: "panel-new",
          params: {
            source: { kind: "disk", path: "src/main.ts", root: "/repo" },
          },
        },
      ]);
    const context = {
      files: { openInEditor },
      panels: { listInstances },
    } as unknown as RendererPluginContext;
    const showSourceMode = vi.fn();
    const controller = { showSourceMode } as unknown as FileEditorController;
    const unregisterDeps = registerFilesLspNavigationDeps({
      context,
      controller,
    });

    const opening = openFilesLspAbsolutePath("/repo/src/main.ts", "/repo");

    expect(openInEditor).toHaveBeenCalledWith({
      path: "src/main.ts",
      root: "/repo",
    });

    const view = { focus: vi.fn() } as unknown as EditorView;
    const unregisterView = registerFilesLspEditorView(
      "/repo/src/main.ts",
      view
    );
    await vi.advanceTimersByTimeAsync(50);
    await expect(opening).resolves.toBe(view);
    expect(showSourceMode).toHaveBeenCalledWith("panel-new");

    unregisterView();
    unregisterDeps();
  });
});
