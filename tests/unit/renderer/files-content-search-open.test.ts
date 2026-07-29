import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileEditorController } from "@plugins/builtin/files/renderer/file-editor-controller.ts";
import type { FileContentQueryItem } from "@shared/contracts/file-query.ts";
import { expect, it, vi } from "vitest";
import {
  documentOffsetAtLineChar,
  openContentSearchHit,
} from "../../../src/plugins/builtin/files/renderer/files-content-search-open.ts";

it("maps line+char onto LF-normalized document offsets", () => {
  const text = "first\nsecond\nthird";
  expect(documentOffsetAtLineChar(text, 1, 0)).toBe(0);
  expect(documentOffsetAtLineChar(text, 1, 2)).toBe(2);
  // line 2 starts after "first\n" (6)
  expect(documentOffsetAtLineChar(text, 2, 0)).toBe(6);
  expect(documentOffsetAtLineChar(text, 2, 3)).toBe(9);
  expect(documentOffsetAtLineChar(text, 3, 0)).toBe(13);
});

it("clamps past end of document", () => {
  const text = "ab\ncd";
  expect(documentOffsetAtLineChar(text, 99, 0)).toBe(text.length);
  expect(documentOffsetAtLineChar(text, 1, 100)).toBe(2);
});

it("activates source mode before revealing a hit in a preview or diff panel", () => {
  vi.useFakeTimers();
  const openInstance = vi.fn();
  const context = {
    panels: {
      listInstances: vi.fn(() => [
        {
          groupId: "group-1",
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
  const controller = {
    documentId: vi.fn(() => "document-1"),
    revealRange: vi.fn(() => false),
    showSourceMode,
  } as unknown as FileEditorController;

  openContentSearchHit({
    context,
    controller,
    hit: {
      line: 12,
      matchByteEnd: 3,
      matchByteStart: 1,
      matchCharEnd: 3,
      matchCharStart: 1,
      path: "src/main.ts",
      preview: "main",
      previewMatchEnd: 3,
      previewMatchStart: 1,
    } satisfies FileContentQueryItem,
    panelContext: null,
    root: "/repo",
  });

  expect(showSourceMode).toHaveBeenCalledWith("panel-1");
  expect(openInstance).toHaveBeenCalled();
  vi.clearAllTimers();
  vi.useRealTimers();
});
