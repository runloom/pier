// @vitest-environment jsdom
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { FileCanvasPreview } from "@plugins/builtin/files/renderer/preview/canvas.tsx";
import {
  FILES_CANVAS_PREVIEW_SURFACE,
  isNativeTextEditContextTarget,
  selectCanvasPreviewContents,
} from "@plugins/builtin/files/renderer/preview/canvas-preview-surface.ts";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const t = (key: string, fallback?: string) => fallback ?? key;

describe("selectCanvasPreviewContents", () => {
  it("selects the compiled host, not comment overlay chrome", () => {
    const root = document.createElement("div");
    const shell = document.createElement("div");
    shell.setAttribute("data-pier-canvas-shell", "");
    const host = document.createElement("div");
    host.setAttribute("data-slot", "file-canvas-host");
    host.textContent = "hello canvas";
    const overlay = document.createElement("div");
    overlay.textContent = "3";
    shell.append(host, overlay);
    root.append(shell);
    document.body.append(root);

    expect(selectCanvasPreviewContents(root)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("hello canvas");
    root.remove();
  });
});

describe("FileCanvasPreview context menu", () => {
  it("pops the canvas preview surface with path metadata", async () => {
    const popup = vi.fn(async () => undefined);
    const registerSelectionSelectAllProvider = vi.fn(() => () => undefined);
    const compile = vi.fn(
      () =>
        new Promise(() => {
          /* pending so the preview shell still mounts */
        })
    );
    const context = {
      contextMenu: { popup, registerSelectionSelectAllProvider },
      dialogs: { alert: vi.fn(async () => undefined) },
      liveModules: {
        compile,
        getUrl: vi.fn(),
        onChanged: vi.fn(() => () => undefined),
        registerRoot: vi.fn(async () => undefined),
        unregisterRoot: vi.fn(async (rootId: string) => ({ rootId })),
      },
      notifications: { success: vi.fn() },
    } as unknown as RendererPluginContext;

    render(
      <FileCanvasPreview
        context={context}
        panelContext={{
          contextId: "ctx",
          projectRootPath: "/proj",
          source: "panel",
          updatedAt: 1,
          worktreeKey: "/proj",
        }}
        panelId="panel-1"
        path=".pier/canvases/smoke/hello.canvas.tsx"
        root="/proj"
        t={t}
      />
    );

    expect(registerSelectionSelectAllProvider).toHaveBeenCalledWith(
      "panel-1",
      expect.any(Function)
    );

    const preview = document.querySelector('[data-slot="file-canvas-preview"]');
    expect(preview).toBeTruthy();
    const openEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 12,
      clientY: 16,
    });
    await act(async () => {
      preview?.dispatchEvent(openEvent);
    });
    expect(openEvent.defaultPrevented).toBe(true);

    expect(popup).toHaveBeenCalledWith(
      FILES_CANVAS_PREVIEW_SURFACE,
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          path: ".pier/canvases/smoke/hello.canvas.tsx",
          projectRoot: "/proj",
          root: "/proj",
        }),
        sourcePanelId: "panel-1",
      })
    );
  });

  it("leaves native cut/copy on textarea targets", async () => {
    const popup = vi.fn(async () => undefined);
    const compile = vi.fn(
      () =>
        new Promise(() => {
          /* pending */
        })
    );
    const context = {
      contextMenu: {
        popup,
        registerSelectionSelectAllProvider: vi.fn(() => () => undefined),
      },
      dialogs: { alert: vi.fn(async () => undefined) },
      liveModules: {
        compile,
        getUrl: vi.fn(),
        onChanged: vi.fn(() => () => undefined),
        registerRoot: vi.fn(async () => undefined),
        unregisterRoot: vi.fn(async (rootId: string) => ({ rootId })),
      },
      notifications: { success: vi.fn() },
    } as unknown as RendererPluginContext;

    render(
      <FileCanvasPreview
        context={context}
        panelId="panel-1"
        path=".pier/canvases/smoke/hello.canvas.tsx"
        root="/proj"
        t={t}
      />
    );

    const preview = document.querySelector('[data-slot="file-canvas-preview"]');
    expect(preview).toBeTruthy();
    const textarea = document.createElement("textarea");
    preview?.append(textarea);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      textarea.dispatchEvent(event);
    });

    expect(popup).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(
      isNativeTextEditContextTarget({
        nativeEvent: event,
        target: textarea,
      })
    ).toBe(true);
  });
});
