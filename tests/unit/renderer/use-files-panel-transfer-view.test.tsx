import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEditorController } from "../../../src/plugins/builtin/files/renderer/file-editor-controller.ts";
import {
  clearFilesPanelTransferViewSeedsForTests,
  peekFilesPanelViewSeed,
  readFilesPanelViewMode,
  seedFilesPanelView,
  subscribeFilesPanelViewSeed,
} from "../../../src/plugins/builtin/files/renderer/files-panel-transfer-state.ts";
import { useFilesPanelTransferView } from "../../../src/plugins/builtin/files/renderer/use-files-panel-transfer-view.ts";

const controller = {
  documentId: (source: { documentId?: string; id?: string; kind: string }) => {
    if (source.kind === "untitled") {
      return source.id ?? "untitled";
    }
    return source.documentId ?? "doc-disk";
  },
} as unknown as FileEditorController;

describe("useFilesPanelTransferView", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key);
      },
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
  });

  afterEach(() => {
    clearFilesPanelTransferViewSeedsForTests();
    vi.unstubAllGlobals();
  });

  it("initializes from an existing transfer seed as preview", () => {
    seedFilesPanelView({
      documentId: "doc-1",
      panelId: "panel-target",
      view: { mode: "preview" },
    });

    const { result } = renderHook(() =>
      useFilesPanelTransferView({
        controller,
        language: "markdown",
        panelSessionId: "panel-target",
        stableSource: {
          documentId: "doc-1",
          kind: "disk",
          path: "README.md",
          root: "/repo",
        },
      })
    );

    expect(result.current.mode).toBe("preview");
    expect(readFilesPanelViewMode("panel-target")).toBe("preview");
    expect(peekFilesPanelViewSeed({ panelId: "panel-target" })?.mode).toBe(
      "preview"
    );
  });

  it("applies a late transfer seed after mount", async () => {
    const { result } = renderHook(() =>
      useFilesPanelTransferView({
        controller,
        language: "markdown",
        panelSessionId: "panel-late",
        stableSource: {
          documentId: "doc-late",
          kind: "disk",
          path: "notes.md",
          root: "/repo",
        },
      })
    );

    expect(result.current.mode).toBe("source");

    act(() => {
      seedFilesPanelView({
        documentId: "doc-late",
        panelId: "panel-late",
        view: { mode: "preview" },
      });
    });

    await waitFor(() => {
      expect(result.current.mode).toBe("preview");
    });
    expect(readFilesPanelViewMode("panel-late")).toBe("preview");
  });

  it("does not remember default source over a pending preview seed", () => {
    seedFilesPanelView({
      panelId: "panel-race",
      view: { mode: "preview" },
    });

    const { result } = renderHook(() =>
      useFilesPanelTransferView({
        controller,
        language: "markdown",
        panelSessionId: "panel-race",
        stableSource: null,
      })
    );

    expect(result.current.mode).toBe("preview");
    expect(readFilesPanelViewMode("panel-race")).toBe("preview");
  });

  it("notifies subscribers when a view seed is written", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFilesPanelViewSeed(listener);
    seedFilesPanelView({
      documentId: "doc-sub",
      panelId: "panel-sub",
      view: { mode: "preview" },
    });
    expect(listener).toHaveBeenCalledWith({
      documentId: "doc-sub",
      panelId: "panel-sub",
      view: { mode: "preview" },
    });
    unsubscribe();
  });
});
